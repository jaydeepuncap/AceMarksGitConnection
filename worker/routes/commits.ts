/**
 * Commit history and changed files. Every per-commit endpoint takes the full
 * 40-character SHA, which is the single source of truth for later syncs.
 *
 *   GET /api/commits              ?repository&branch&path&page&perPage
 *   GET /api/commits/:sha         ?repository
 *   GET /api/commits/:sha/files   ?repository&page&perPage   (up to 3000 files per commit)
 */
import { Hono } from 'hono';
import type { CommitDetail, CommitFile, CommitFilesResponse, CommitListItem, Paginated } from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached, cacheKeys } from '../lib/cache';
import { githubClient, resolveRepository } from '../lib/clients';
import { getDb, getSettings } from '../lib/database';
import { GITHUB_MAX_COMMIT_FILES } from '../lib/github-client';
import { ok } from '../lib/response';
import {
  commitFilesQuerySchema,
  commitQuerySchema,
  commitShaSchema,
  commitsQuerySchema,
  parseOrThrow,
} from '../lib/validators';
import { annotateCommitFiles } from '../sync/plan';
import { mapLimit } from '../sync/runtime';

export const commitsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const query = parseOrThrow(commitsQuerySchema, c.req.query());
    const { client, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection, query.repository);
    const ref = query.branch ?? target.branch ?? undefined;
    const result = await client.listCommits(target.owner, target.repo, {
      ref,
      path: query.path,
      page: query.page,
      perPage: query.perPage,
    });
    const items: CommitListItem[] = result.items.map((commit) => ({ ...commit, fileStats: null }));
    if (query.withFiles) {
      // Per-commit file lists are immutable and cached for a day.
      await mapLimit(items, 5, async (item) => {
        try {
          const files = await cached<{ files: CommitFile[]; truncated: boolean }>(
            c.env.KV,
            cacheKeys.commitFiles(c.get('auth').shop.id, target.fullName, item.sha),
            86_400,
            async () => {
              const all = await client.getAllCommitFiles(target.owner, target.repo, item.sha);
              return { files: all.files, truncated: all.truncated };
            },
            c.get('logger'),
          );
          const count = (status: string) => files.files.filter((f) => f.status === status).length;
          item.fileStats = {
            total: files.files.length,
            added: count('added') + count('copied'),
            modified: count('modified') + count('changed'),
            renamed: count('renamed'),
            removed: count('removed'),
            truncated: files.truncated,
          };
        } catch {
          item.fileStats = null;
        }
      });
    }
    return ok<Paginated<CommitListItem>>(c, { items, hasNextPage: result.hasNextPage, page: query.page, perPage: query.perPage });
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
      items: annotateCommitFiles(pageItems, settings.preferences),
      page: query.page,
      perPage: query.perPage,
      hasNextPage: start + query.perPage < all.files.length,
      maxFilesListed: GITHUB_MAX_COMMIT_FILES,
    });
  });
