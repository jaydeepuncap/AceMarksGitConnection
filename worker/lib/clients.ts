/**
 * Factories that build authenticated upstream clients for a shop. Used by both
 * HTTP routes (with a session token available) and the queue consumer (without).
 */
import type { Context } from 'hono';
import type { GithubConnection, Shop } from '../../drizzle/schema';
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
  shopifyAppForShop,
  storeOfflineToken,
} from './sessions';
import type { ShopifyAppCredentials } from './shopify-apps';
import { ShopifyGraphqlClient } from './shopify-graphql';
import { splitRepository } from './validators';

export const githubTokenAad = (shopDomain: string) => `github-token:${shopDomain}`;

export async function createAdminClientForShop(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  opts: { sessionToken?: string; app?: ShopifyAppCredentials; fetchImpl?: typeof fetch } = {},
): Promise<ShopifyGraphqlClient> {
  let accessToken: string;
  try {
    accessToken = await getOfflineAccessToken(env, db, shop, logger, opts.fetchImpl);
  } catch (err) {
    if (!(err instanceof ShopifyReauthRequiredError) || !opts.sessionToken) throw err;
    // Embedded request: silently re-authorize with token exchange.
    // The session token was verified against `opts.app`, so that app owns the new token.
    const app = opts.app ?? shopifyAppForShop(env, shop);
    const exchanged = await exchangeSessionToken(app, shop.shopDomain, opts.sessionToken, logger, opts.fetchImpl);
    await storeOfflineToken(env, db, shop.shopDomain, exchanged, app);
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

export async function createGithubClientForShop(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ client: GitHubClient; connection: GithubConnection }> {
  const connection = await getGithubConnection(db, shop.id);
  if (!connection) {
    throw new ApiError(400, 'GITHUB_NOT_CONNECTED', 'Connect a GitHub account in Settings first');
  }
  const token = await decryptSecret(env, connection.tokenEncrypted, githubTokenAad(shop.shopDomain));
  return {
    client: new GitHubClient({ token, baseUrl: env.GITHUB_API_BASE_URL, logger, fetchImpl: opts.fetchImpl }),
    connection,
  };
}

// ---------------------------------------------------------------------------
// Route-level helpers (Hono context)
// ---------------------------------------------------------------------------
export function adminClient(c: Context<AppEnv>): Promise<ShopifyGraphqlClient> {
  const { shop, sessionToken, app } = c.get('auth');
  return createAdminClientForShop(c.env, getDb(c.env.DB), shop, c.get('logger'), { sessionToken, app });
}

export function githubClient(c: Context<AppEnv>) {
  return createGithubClientForShop(c.env, getDb(c.env.DB), c.get('auth').shop, c.get('logger'));
}

/**
 * Resolves which repository a request targets: explicit `owner/name`, else the
 * shop's default repository, else the connection's verified repository.
 */
export async function resolveRepository(
  c: Context<AppEnv>,
  connection: GithubConnection,
  explicit?: string,
): Promise<{ owner: string; repo: string; fullName: string; defaultBranch: string | null }> {
  if (explicit) return { ...splitRepository(explicit), fullName: explicit, defaultBranch: null };
  const settings = await getSettings(getDb(c.env.DB), c.get('auth').shop.id);
  if (settings.defaultRepository) {
    return {
      ...splitRepository(settings.defaultRepository),
      fullName: settings.defaultRepository,
      defaultBranch: settings.defaultBranch,
    };
  }
  if (connection.repoOwner && connection.repoName) {
    return {
      owner: connection.repoOwner,
      repo: connection.repoName,
      fullName: `${connection.repoOwner}/${connection.repoName}`,
      defaultBranch: connection.defaultBranch,
    };
  }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Select a repository first (Settings → Repository)');
}
