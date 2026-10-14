/**
 * Commit history and changed files. Every per-commit endpoint takes the full
 * 40-character SHA, which is the single source of truth for later syncs.
 *
 *   GET /api/commits              ?repository&branch&path&page&perPage
 *   GET /api/commits/:sha         ?repository
 *   GET /api/commits/:sha/files   ?repository&page&perPage   (up to 3000 files per commit)
 */
import { Hono } from 'hono';
import type { CommitDetail, CommitFile, CommitFilesResponse, CommitListItem, CommitsResponse } from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached, cacheKeys } from '../lib/cache';
import { adminClient, githubClient, resolveRepository } from '../lib/clients';
import { getDb, getSettings, syncedCommits, toLastSynced } from '../lib/database';
import { GITHUB_MAX_COMMIT_FILES } from '../lib/github-client';
import { ok } from '../lib/response';
import {
  commitFilesQuerySchema,
  commitQuerySchema,
  commitShaSchema,
  commitsQuerySchema,
  parseOrThrow,
} from '../lib/validators';
import { annotateCommitFiles } from '../sync/planner';
import { resolveLastSynced } from '../sync/theme-state';

export const commitsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const query = parseOrThrow(commitsQuerySchema, c.req.query());
    const { client, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection, query.repository);
    const ref = query.branch ?? target.defaultBranch ?? undefined;
    const result = await client.listCommits(target.owner, target.repo, {
      ref,
      path: query.path,
      page: query.page,
      perPage: query.perPage,
    });
    const items: CommitListItem[] = result.items.map((commit) => ({ ...commit, syncStatus: null }));
    const response: CommitsResponse = {
      items,
      page: query.page,
      perPage: query.perPage,
      hasNextPage: result.hasNextPage,
      lastSynced: null,
      waiting: 0,
      waitingMore: false,
    };
    if (!query.themeId) return ok<CommitsResponse>(c, response);

    // Where the theme stands on this branch: New / Last synced / Added.
    const { shop } = c.get('auth');
    const db = getDb(c.env.DB);
    const branch = ref ?? (await client.getRepository(target.owner, target.repo)).defaultBranch;
    // A duplicated theme has no row yet: its assets/theme-sync.json says where it stands.
    const last = await resolveLastSynced(
      { db, admin: await adminClient(c), kv: c.env.KV, logger: c.get('logger') },
      { shopId: shop.id, themeId: query.themeId, branch, repository: target.fullName },
    );
    response.lastSynced = toLastSynced(last);
    let lastIndex: number | null = null;
    if (last) {
      const walk = await cached(
        c.env.KV,
        `cache:${shop.id}:gh:${target.fullName}:after:${branch}:${last.commitSha}`,
        60,
        async () => {
          const w = await client.listCommitsUntil(target.owner, target.repo, branch, last.commitSha, 300);
          return { count: w.commits.length, found: w.found, more: !w.found && w.hasMore };
        },
        c.get('logger'),
      );
      response.waiting = walk.count;
      response.waitingMore = walk.more;
      if (walk.found) lastIndex = walk.count;
    }
    const synced = await syncedCommits(db, shop.id, query.themeId, branch, items.map((i) => i.sha));
    const offset = (query.page - 1) * query.perPage;
    items.forEach((item, i) => {
      const position = offset + i;
      if (lastIndex !== null) {
        item.syncStatus = position < lastIndex ? (synced.has(item.sha) ? 'added' : 'new') : position === lastIndex ? 'last_synced' : 'added';
      } else {
        item.syncStatus = synced.has(item.sha) ? 'added' : last ? 'new' : null;
      }
    });
    return ok<CommitsResponse>(c, response);
  })
  .get('/:sha', async (c) => {
    const sha = parseOrThrow(commitShaSchema, c.req.param('sha'));
    const query = parseOrThrow(commitQuerySchema, c.req.query());
    const { client, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection, query.repository);
    // Commits are immutable, so the per-SHA result can be cached for a day.
    const detail = await cached<CommitDetail>(
      c.env.KV,
      `${cacheKeys.commitFiles(c.get('auth').shop.id, target.fullName, sha)}:detail`,
      86_400,
      () => client.getCommit(target.owner, target.repo, sha),
      c.get('logger'),
    );
    return ok(c, detail);
  })
  .get('/:sha/files', async (c) => {
    const sha = parseOrThrow(commitShaSchema, c.req.param('sha'));
    const query = parseOrThrow(commitFilesQuerySchema, c.req.query());
    const { shop } = c.get('auth');
    const { client, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection, query.repository);

    const all = await cached<{ files: CommitFile[]; truncated: boolean }>(
      c.env.KV,
      cacheKeys.commitFiles(shop.id, target.fullName, sha),
      86_400,
      async () => {
        const result = await client.getAllCommitFiles(target.owner, target.repo, sha);
        return { files: result.files, truncated: result.truncated };
      },
      c.get('logger'),
    );

    const settings = await getSettings(getDb(c.env.DB), shop.id);
    const start = (query.page - 1) * query.perPage;
    const pageItems = all.files.slice(start, start + query.perPage);
    return ok<CommitFilesResponse>(c, {
      items: annotateCommitFiles(pageItems, settings.syncPreferences),
      page: query.page,
      perPage: query.perPage,
      hasNextPage: start + query.perPage < all.files.length,
      maxFilesListed: GITHUB_MAX_COMMIT_FILES,
    });
  });
