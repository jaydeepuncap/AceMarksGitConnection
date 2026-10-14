/**
 * Everything needed to work on one store: its settings, repository and
 * authenticated Shopify / GitHub clients. Built for the store of the current
 * request, or for another store of the group during a roll-out.
 */
import type { Shop } from '../../drizzle/schema';
import type { AppSettings, CommitFile } from '../../shared/api-types';
import type { Env } from '../env';
import { cached, cacheKeys } from '../lib/cache';
import { createAdminClientForShop, createGithubClientForShop, resolveRepositoryFor, type RepositoryTarget } from '../lib/clients';
import { getSettings, type Database } from '../lib/database';
import type { GitHubClient } from '../lib/github-client';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import type { ShopifyGraphqlClient } from '../lib/shopify-graphql';

export interface ShopRuntime {
  env: Env;
  db: Database;
  shop: Shop;
  logger: Logger;
  settings: AppSettings;
  repo: RepositoryTarget | null;
  /** Lazily created clients (a restore never needs GitHub, an overview may not need Shopify). */
  admin(): Promise<ShopifyGraphqlClient>;
  github(): Promise<GitHubClient>;
  fetchImpl?: typeof fetch;
}

export async function loadShopRuntime(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  opts: { sessionToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<ShopRuntime> {
  const settings = await getSettings(db, shop.id);
  let adminPromise: Promise<ShopifyGraphqlClient> | null = null;
  let githubPromise: ReturnType<typeof createGithubClientForShop> | null = null;
  const github = () => (githubPromise ??= createGithubClientForShop(env, db, shop, logger, { fetchImpl: opts.fetchImpl }));

  // The repository comes from settings; a connection's verified repository is only a fallback.
  let repo = resolveRepositoryFor(env, settings, null);
  if (!repo) {
    try {
      repo = resolveRepositoryFor(env, settings, (await github()).connection);
    } catch {
      repo = null;
    }
  }

  return {
    env,
    db,
    shop,
    logger,
    settings,
    repo,
    fetchImpl: opts.fetchImpl,
    admin: () =>
      (adminPromise ??= createAdminClientForShop(env, db, shop, logger, {
        sessionToken: opts.sessionToken,
        fetchImpl: opts.fetchImpl,
      })),
    github: async () => (await github()).client,
  };
}

export function requireRepo(rt: ShopRuntime): RepositoryTarget {
  if (!rt.repo) throw new ApiError(400, 'SETUP_INCOMPLETE', 'Choose the master repository in Settings first');
  return rt.repo;
}

/** The branch updates come from: the configured branch, else the repository's default branch. */
export async function resolveBranch(rt: ShopRuntime): Promise<string> {
  const repo = requireRepo(rt);
  if (repo.branch) return repo.branch;
  const github = await rt.github();
  const info = await cached(
    rt.env.KV,
    `cache:${rt.shop.id}:gh:${repo.fullName}:default-branch`,
    600,
    () => github.getRepository(repo.owner, repo.repo),
    rt.logger,
  );
  return info.defaultBranch;
}

/** Changed files of one commit (immutable, cached for a day). */
export async function commitFilesCached(rt: ShopRuntime, sha: string): Promise<{ files: CommitFile[]; truncated: boolean }> {
  const repo = requireRepo(rt);
  const github = await rt.github();
  return cached(
    rt.env.KV,
    cacheKeys.commitFiles(rt.shop.id, repo.fullName, sha),
    86_400,
    async () => {
      const result = await github.getAllCommitFiles(repo.owner, repo.repo, sha);
      return { files: result.files, truncated: result.truncated };
    },
    rt.logger,
  );
}

/**
 * Number of commits on `ref` after `sinceSha` (capped at `max`), cached briefly.
 * `found` is false when `sinceSha` is not in the history of `ref`.
 */
export async function countAfter(
  rt: ShopRuntime,
  ref: string,
  sinceSha: string,
  max = 300,
): Promise<{ count: number; more: boolean; found: boolean }> {
  const repo = requireRepo(rt);
  const github = await rt.github();
  return cached(
    rt.env.KV,
    `cache:${rt.shop.id}:gh:${repo.fullName}:after:${ref}:${sinceSha}:${max}`,
    60,
    async () => {
      const walk = await github.listCommitsUntil(repo.owner, repo.repo, ref, sinceSha, max);
      return { count: walk.commits.length, more: !walk.found && walk.hasMore, found: walk.found };
    },
    rt.logger,
  );
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
