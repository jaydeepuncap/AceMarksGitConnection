/**
 * Updates: list, plan (checks + review), confirm, retry, restore, history.
 *
 *   GET  /api/updates                 ?line&ref&page   updates (commits) with NEW / CURRENT markers
 *   POST /api/updates/plan            { kind, targetSha, themeId?, line? }  checks + review, nothing changes
 *   POST /api/updates/baseline        { line, sha }   record the update a theme already runs
 *   GET  /api/updates/publish-options Staging-verified update + Live theme choices
 *   GET  /api/updates/:id             run with per-file status (the UI polls this)
 *   POST /api/updates/:id/confirm     { acceptDirectEdits? }
 *   POST /api/updates/:id/retry       retry failed files only
 *   POST /api/updates/:id/rerun       plan the same update again (fresh checks)
 *   POST /api/updates/:id/restore     plan putting the backup back
 *   POST /api/updates/:id/cancel      drop a plan that was not confirmed
 *   GET  /api/history                 ?page&perPage&line&themeId&status
 */
import { Hono, type Context } from 'hono';
import type {
  ShopifyTheme,
  ThemeRef,
  Paginated,
  PublishOptionsResponse,
  ThemeLine,
  UpdateListItem,
  UpdateRun,
  UpdateRunDetail,
  UpdatesResponse,
} from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached } from '../lib/cache';
import {
  appliedCommits,
  countOperations,
  verifiedCommits,
  createRun,
  findActiveSyncForTheme,
  getSyncRun,
  getThemeState,
  getThemeStates,
  listHistory,
  listSyncOperations,
  toSyncedUpdate,
  transitionSyncRun,
  upsertThemeState,
} from '../lib/database';
import { ApiError, ok } from '../lib/response';
import {
  baselineSchema,
  confirmUpdateSchema,
  createPlanSchema,
  historyQuerySchema,
  parseOrThrow,
  readJsonBody,
  updatesQuerySchema,
  uuidSchema,
} from '../lib/validators';
import { rateLimit } from '../middleware/error-handler';
import { dispatchSync, STALE_RUN_MS } from '../sync/dispatch';
import { lineForTheme, planRestore, planRun, toIncludedFiles, type RunOptions } from '../sync/plan';
import { getTheme } from '../lib/shopify-graphql';
import { cancelRun, confirmRun, describeRun, retryRun, toUpdateFile, toUpdateRun } from '../sync/runs';
import { commitFilesCached, countAfter, mapLimit, requireRepo, resolveBranch, type ShopRuntime } from '../sync/runtime';
import { dispatchCtx, importThemeMarker, requestActor, requestRuntime, themesFor } from './helpers';

const writeLimiter = rateLimit({
  binding: 'SYNC_RATE_LIMITER',
  limit: 10,
  periodSeconds: 60,
  key: (c) => c.get('auth').shopDomain,
});

function lineTheme(rt: ShopRuntime, line: ThemeLine) {
  const theme = line === 'staging' ? rt.settings.stagingTheme : rt.settings.liveTheme;
  if (!theme) {
    throw new ApiError(400, 'SETUP_INCOMPLETE', `Pick the ${line === 'staging' ? 'Staging' : 'Live'} theme in Settings first`);
  }
  return theme;
}

async function loadRun(c: Context<AppEnv>) {
  const id = parseOrThrow(uuidSchema, c.req.param('id'));
  const run = await getSyncRun((await requestRuntime(c)).db, c.get('auth').shop.id, id);
  if (!run) throw new ApiError(404, 'NOT_FOUND', 'Update not found');
  return run;
}

async function respondRun(c: Context<AppEnv>, rt: ShopRuntime, runId: string, message?: string, status: 201 | 202 | 200 = 200) {
  const row = await getSyncRun(rt.db, rt.shop.id, runId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Update not found');
  const run = await describeRun(rt.db, row, rt.shop.shopDomain, rt.settings.stagingTheme?.id ?? null);
  return ok<UpdateRun>(c, run, message, status);
}

export const updatesRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const query = parseOrThrow(updatesQuerySchema, c.req.query());
    const rt = await requestRuntime(c);
    const repo = requireRepo(rt);
    const github = await rt.github();
    const branch = query.branch ?? (await resolveBranch(rt));
    let shopifyTheme: ShopifyTheme | null = null;
    let theme: ThemeRef | null;
    let line: ThemeLine = query.line;
    if (query.themeId) {
      shopifyTheme = await getTheme(await rt.admin(), query.themeId);
      if (!shopifyTheme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
      theme = { id: shopifyTheme.id, name: shopifyTheme.name };
      line = lineForTheme(rt.settings, shopifyTheme);
    } else {
      theme = query.line === 'staging' ? rt.settings.stagingTheme : query.line === 'live' ? rt.settings.liveTheme : null;
    }
    if (theme) await importThemeMarker(rt, theme.id);
    const current = theme ? toSyncedUpdate(await getThemeState(rt.db, rt.shop.id, theme.id)) : null;

    const fromCurrent = query.ref === 'current' && !!current;
    const ref = fromCurrent ? current.sha : branch;
    const page = await cached(
      rt.env.KV,
      `cache:${rt.shop.id}:gh:${repo.fullName}:commits:${ref}:${query.page}:${query.perPage}`,
      fromCurrent ? 3600 : 60,
      () => github.listCommits(repo.owner, repo.repo, { ref, page: query.page, perPage: query.perPage }),
      rt.logger,
    );

    // Position of the theme's current update in the branch history.
    let waiting = 0;
    let waitingMore = false;
    let currentIndex: number | null = fromCurrent ? 0 : null;
    if (!fromCurrent && current) {
      const walk = await countAfter(rt, branch, current.sha);
      waiting = walk.count;
      waitingMore = walk.more;
      currentIndex = walk.found ? walk.count : null;
    }

    const offset = (query.page - 1) * query.perPage;
    const items: UpdateListItem[] = page.items.map((commit, i) => {
      const g = offset + i;
      const state = currentIndex === null ? 'new' : g < currentIndex ? 'new' : g === currentIndex ? 'current' : 'older';
      return { ...commit, state, counts: null, applied: false, verified: false };
    });
    const verified = await verifiedCommits(rt.db, rt.shop.id, items.map((i) => i.sha));
    for (const item of items) item.verified = verified.has(item.sha);
    if (theme) {
      const applied = await appliedCommits(rt.db, rt.shop.id, theme.id, items.map((i) => i.sha));
      for (const item of items) item.applied = applied.has(item.sha) || item.sha === current?.sha;
    }
    // File counts (+a ~m -r) for waiting updates and the current one.
    await mapLimit(
      items.filter((item) => item.state !== 'older'),
      5,
      async (item) => {
        try {
          const files = toIncludedFiles((await commitFilesCached(rt, item.sha)).files, rt.settings.preferences).filter(
            (f) => !f.ignored,
          );
          item.counts = {
            added: files.filter((f) => f.change === 'added').length,
            modified: files.filter((f) => f.change === 'modified').length,
            removed: files.filter((f) => f.change === 'removed').length,
          };
        } catch {
          item.counts = null;
        }
      },
    );

    return ok<UpdatesResponse>(c, {
      line,
      shopifyTheme,
      theme,
      repository: repo.fullName,
      branch,
      current,
      currentFound: currentIndex !== null,
      waiting,
      waitingMore,
      items,
      page: query.page,
      hasNextPage: page.hasNextPage,
    });
  })
  .post('/plan', writeLimiter, async (c) => {
    const body = parseOrThrow(createPlanSchema, await readJsonBody(c.req.raw));
    const rt = await requestRuntime(c);
    let line: ThemeLine;
    let themeId: string;
    if (body.kind === 'publish') {
      line = 'live';
      // Default: the Live theme from Settings, else the published theme.
      const published = (await themesFor(rt)).find((t) => t.isLive);
      const target = body.themeId ?? rt.settings.liveTheme?.id ?? published?.id;
      if (!target) throw new ApiError(400, 'SETUP_INCOMPLETE', 'This store has no published theme to publish to');
      themeId = target;
    } else if (body.themeId) {
      // Any theme of the store, chosen on its theme page.
      themeId = body.themeId;
      const theme = await getTheme(await rt.admin(), themeId);
      if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
      line = lineForTheme(rt.settings, theme);
    } else if (body.kind === 'update') {
      line = 'staging';
      themeId = lineTheme(rt, 'staging').id;
    } else {
      line = body.line === 'live' ? 'live' : 'staging';
      themeId = lineTheme(rt, line).id;
    }
    await importThemeMarker(rt, themeId);
    const run = await planRun(rt, {
      kind: body.kind,
      line,
      themeId,
      targetSha: body.targetSha,
      branch: body.branch ?? null,
      userId: requestActor(c).userId,
    });
    return respondRun(c, rt, run.id, 'Checks complete. Nothing has changed in the theme yet.', 201);
  })
  .post('/baseline', writeLimiter, async (c) => {
    const body = parseOrThrow(baselineSchema, await readJsonBody(c.req.raw));
    const rt = await requestRuntime(c);
    let theme: ThemeRef;
    let line: ThemeLine = body.line;
    let role = body.line === 'live' ? 'MAIN' : 'UNPUBLISHED';
    if (body.themeId) {
      const found = await getTheme(await rt.admin(), body.themeId);
      if (!found) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
      theme = { id: found.id, name: found.name };
      line = lineForTheme(rt.settings, found);
      role = found.role;
    } else {
      theme = lineTheme(rt, body.line);
    }
    const state = await getThemeState(rt.db, rt.shop.id, theme.id);
    if (state?.lastSyncedSha) {
      throw new ApiError(409, 'CONFLICT', 'This theme already has a last synced update. Use an update or "Go back" instead.');
    }
    if (await findActiveSyncForTheme(rt.db, rt.shop.id, theme.id)) {
      throw new ApiError(409, 'UPDATE_IN_PROGRESS', 'An update is running on this theme');
    }
    const repo = requireRepo(rt);
    const commit = await (await rt.github()).getCommitPage(repo.owner, repo.repo, body.sha, 1, 1);
    if (commit.commit.sha.toLowerCase() !== body.sha) throw new ApiError(404, 'GITHUB_NOT_FOUND', 'Update not found in the repository');
    const now = new Date();
    const id = crypto.randomUUID();
    const options: RunOptions = {
      direction: 'none',
      totals: { added: 0, updated: 0, removed: 0, protectedUntouched: 0, skipped: 0 },
      warnings: ['Recorded which update this theme already runs. No theme files were changed.'],
    };
    await createRun(
      rt.db,
      rt.shop.id,
      {
        id,
        repository: repo.fullName,
        branch: body.branch ?? (await resolveBranch(rt).catch(() => repo.branch)),
        commitSha: body.sha,
        commitMessage: commit.commit.commit.message.slice(0, 1000),
        themeId: theme.id,
        themeName: theme.name,
        themeRole: role,
        strategy: 'commit_changes',
        kind: 'baseline',
        line,
        options,
        initiatedBy: requestActor(c).userId,
        confirmedAt: now,
        startedAt: now,
        completedAt: now,
      },
      [],
      'succeeded',
    );
    await upsertThemeState(rt.db, rt.shop.id, theme.id, {
      lastSyncedSha: body.sha,
      lastSyncedMessage: commit.commit.commit.message.slice(0, 1000),
      lastSyncedAt: now,
      lastSyncId: id,
      verifiedOnStagingAt: null,
    });
    return respondRun(c, rt, id, 'Recorded. No theme files were changed.', 201);
  })
  .get('/publish-options', async (c) => {
    const rt = await requestRuntime(c);
    const stagingId = rt.settings.stagingTheme?.id ?? null;
    if (stagingId) await importThemeMarker(rt, stagingId);
    const stagingState = stagingId ? await getThemeState(rt.db, rt.shop.id, stagingId) : undefined;
    const update = toSyncedUpdate(stagingState);
    const themes = (await themesFor(rt)).filter((t) => t.id !== stagingId && t.writable);
    const states = await getThemeStates(rt.db, rt.shop.id, themes.map((t) => t.id));
    const configuredLive = rt.settings.liveTheme?.id ?? null;

    let reason: string | null = null;
    if (!stagingId) reason = 'Pick the Staging theme in Settings first.';
    else if (!update) reason = 'Staging has not received an update yet.';
    else if (!stagingState?.verifiedOnStagingAt) reason = 'The update on Staging did not fully complete, so it cannot be published.';
    else if (stagingId && (await findActiveSyncForTheme(rt.db, rt.shop.id, stagingId))) reason = 'Staging is being updated right now.';

    return ok<PublishOptionsResponse>(c, {
      update,
      verified: reason === null,
      reason,
      themes: themes.map((theme) => ({
        theme,
        lastSynced: toSyncedUpdate(states.get(theme.id)),
        isConfiguredLive: theme.id === configuredLive,
      })),
      defaultThemeId:
        (configuredLive && themes.some((t) => t.id === configuredLive) ? configuredLive : null) ??
        themes.find((t) => t.isLive)?.id ??
        null,
    });
  })
  .get('/:id', async (c) => {
    const run = await loadRun(c);
    const rt = await requestRuntime(c);
    // Without a queue: resume a stalled run when the UI polls it.
    if (
      !c.env.SYNC_QUEUE &&
      (run.status === 'queued' || run.status === 'running') &&
      Date.now() - run.updatedAt.getTime() > STALE_RUN_MS
    ) {
      await transitionSyncRun(rt.db, rt.shop.id, run.id, ['queued', 'running'], run.status, {});
      await dispatchSync(c.env, c.executionCtx, { syncId: run.id, shopId: rt.shop.id }, c.get('logger'));
    }
    const summary = await describeRun(rt.db, run, rt.shop.shopDomain, rt.settings.stagingTheme?.id ?? null);
    const files = (await listSyncOperations(rt.db, rt.shop.id, run.id))
      .filter((op) => op.contentSource !== 'marker')
      .map(toUpdateFile);
    return ok<UpdateRunDetail>(c, { ...summary, files });
  })
  .post('/:id/confirm', writeLimiter, async (c) => {
    const run = await loadRun(c);
    const body = parseOrThrow(confirmUpdateSchema, await readJsonBody(c.req.raw));
    const rt = await requestRuntime(c);
    await confirmRun(rt, dispatchCtx(c), run, body, requestActor(c));
    return respondRun(c, rt, run.id, 'Backup started; the theme is being updated', 202);
  })
  .post('/:id/retry', writeLimiter, async (c) => {
    const run = await loadRun(c);
    const rt = await requestRuntime(c);
    await retryRun(rt, dispatchCtx(c), run);
    return respondRun(c, rt, run.id, 'Retrying the failed files', 202);
  })
  .post('/:id/rerun', writeLimiter, async (c) => {
    const run = await loadRun(c);
    if (!['failed', 'partially_failed'].includes(run.status) || !['update', 'publish', 'rollback'].includes(run.kind)) {
      throw new ApiError(409, 'CONFLICT', 'Only an incomplete update can be run again');
    }
    const rt = await requestRuntime(c);
    const plan = await planRun(rt, {
      kind: run.kind as 'update' | 'publish' | 'rollback',
      line: run.line,
      themeId: run.themeId,
      targetSha: run.commitSha,
      userId: requestActor(c).userId,
    });
    return respondRun(c, rt, plan.id, 'Checks complete. Review the update again.', 201);
  })
  .post('/:id/restore', writeLimiter, async (c) => {
    const run = await loadRun(c);
    const rt = await requestRuntime(c);
    const plan = await planRestore(rt, run, requestActor(c).userId);
    return respondRun(c, rt, plan.id, 'Review what the restore puts back.', 201);
  })
  .post('/:id/cancel', async (c) => {
    const run = await loadRun(c);
    const rt = await requestRuntime(c);
    await cancelRun(rt.db, run);
    return respondRun(c, rt, run.id, 'Update cancelled. Nothing changed.');
  });

export const historyRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const query = parseOrThrow(historyQuerySchema, c.req.query());
  const rt = await requestRuntime(c);
  const { rows, hasNextPage } = await listHistory(rt.db, rt.shop.id, query);
  const items = await Promise.all(
    rows.map(async (row) => toUpdateRun(row, await countOperations(rt.db, rt.shop.id, row.id), rt.shop.shopDomain)),
  );
  return ok<Paginated<UpdateRun>>(c, { items, page: query.page, perPage: query.perPage, hasNextPage });
});
