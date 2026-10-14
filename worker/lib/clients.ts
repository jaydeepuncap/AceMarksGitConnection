/**
 * Factories that build authenticated upstream clients for a shop. Used by both
 * HTTP routes (with a session token available) and the queue consumer (without).
 */
import type { Context } from 'hono';
import type { GithubConnection, Shop } from '../../drizzle/schema';
import type { AppSettings } from '../../shared/api-types';
import type { AppEnv, Env } from '../env';
import { decryptSecret } from './crypto';
import { getDb, getGithubConnection, getSettings, type Database } from './database';
import { GitHubClient } from './github-client';
import type { Logger } from './logger';
import { ApiError } from './response';
import {
  exchangeSessionToken,
  getOfflineAccessToken,
  ShopifyReauthRequiredError,
  storeOfflineToken,
} from './sessions';
import { ShopifyGraphqlClient } from './shopify-graphql';
import { splitRepository } from './validators';

export const githubTokenAad = (shopDomain: string) => `github-token:${shopDomain}`;

export async function createAdminClientForShop(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  opts: { sessionToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<ShopifyGraphqlClient> {
  let accessToken: string;
  try {
    accessToken = await getOfflineAccessToken(env, db, shop, logger, opts.fetchImpl);
  } catch (err) {
    if (!(err instanceof ShopifyReauthRequiredError) || !opts.sessionToken) throw err;
    // Embedded request: silently re-authorize with token exchange.
    const exchanged = await exchangeSessionToken(env, shop.shopDomain, opts.sessionToken, logger, opts.fetchImpl);
    await storeOfflineToken(env, db, shop.shopDomain, exchanged);
    accessToken = exchanged.access_token;
  }
  return new ShopifyGraphqlClient({
    shopDomain: shop.shopDomain,
    accessToken,
    apiVersion: env.SHOPIFY_API_VERSION,
    logger,
    fetchImpl: opts.fetchImpl,
  });
}

export interface GithubAccess {
  client: GitHubClient;
  /** The store's own connection, or null when the Worker's shared GITHUB_TOKEN is used. */
  connection: GithubConnection | null;
}

export async function createGithubClientForShop(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GithubAccess> {
  const connection = await getGithubConnection(db, shop.id);
  let token: string;
  if (connection) {
    token = await decryptSecret(env, connection.tokenEncrypted, githubTokenAad(shop.shopDomain));
  } else if (env.GITHUB_TOKEN?.trim()) {
    token = env.GITHUB_TOKEN.trim();
  } else {
    throw new ApiError(400, 'GITHUB_NOT_CONNECTED', 'Connect GitHub in Settings first');
  }
  return {
    client: new GitHubClient({ token, baseUrl: env.GITHUB_API_BASE_URL, logger, fetchImpl: opts.fetchImpl }),
    connection: connection ?? null,
  };
}

export interface RepositoryTarget {
  owner: string;
  repo: string;
  fullName: string;
  branch: string | null;
}

/**
 * The repository a store works from: its own setting, else the Worker's
 * MASTER_REPOSITORY, else the repository verified with its GitHub connection.
 */
export function resolveRepositoryFor(
  env: Env,
  settings: AppSettings,
  connection: GithubConnection | null,
): RepositoryTarget | null {
  const configured = settings.repository ?? env.MASTER_REPOSITORY?.trim() ?? null;
  if (configured) {
    return {
      ...splitRepository(configured),
      fullName: configured,
      branch: settings.branch ?? (settings.repository ? null : env.MASTER_BRANCH?.trim() || null),
    };
  }
  if (connection?.repoOwner && connection.repoName) {
    return {
      owner: connection.repoOwner,
      repo: connection.repoName,
      fullName: `${connection.repoOwner}/${connection.repoName}`,
      branch: connection.defaultBranch,
    };
  }
  return null;
}

export function requireRepository(target: RepositoryTarget | null): RepositoryTarget {
  if (!target) throw new ApiError(400, 'SETUP_INCOMPLETE', 'Choose the master repository in Settings first');
  return target;
}

// ---------------------------------------------------------------------------
// Route-level helpers (Hono context)
// ---------------------------------------------------------------------------
export function adminClient(c: Context<AppEnv>): Promise<ShopifyGraphqlClient> {
  const { shop, sessionToken } = c.get('auth');
  return createAdminClientForShop(c.env, getDb(c.env.DB), shop, c.get('logger'), { sessionToken });
}

export function githubClient(c: Context<AppEnv>) {
  return createGithubClientForShop(c.env, getDb(c.env.DB), c.get('auth').shop, c.get('logger'));
}

/** Repository for a request: an explicit `owner/name`, else the store's repository. */
export async function resolveRepository(
  c: Context<AppEnv>,
  connection: GithubConnection | null,
  explicit?: string,
): Promise<RepositoryTarget> {
  if (explicit) return { ...splitRepository(explicit), fullName: explicit, branch: null };
  const settings = await getSettings(getDb(c.env.DB), c.get('auth').shop.id);
  return requireRepository(resolveRepositoryFor(c.env, settings, connection));
}
