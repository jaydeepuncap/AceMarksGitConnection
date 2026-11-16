/**
 * Preview-first theme synchronization.
 *
 *   POST /api/sync/preview            plan only; persists the plan (status "previewed", 30 min TTL)
 *   POST /api/sync                    { syncId, confirm: true, confirmLiveTheme?, confirmThemeName? }
 *                                     executes exactly the previewed plan in the background (202)
 *   GET  /api/sync/history            ?page&perPage&status&includePreviews
 *   GET  /api/sync/history/:id        run + per-file operations
 *   GET  /api/sync/last               ?themeId&branch  the latest sync with a recorded result (or null)
 *   POST /api/sync/history/:id/retry  re-runs failed/pending operations (idempotent writes)
 *   POST /api/sync/history/:id/restore puts the theme back as it was before an incomplete update
 */
import { Hono, type Context } from 'hono';
import type { Paginated, SyncChecks, SyncPreview, SyncRun, SyncRunDetail } from '../../shared/api-types';
import type { SyncHistoryRow } from '../../drizzle/schema';
import type { AppEnv } from '../env';
import { adminClient, githubClient, resolveRepository } from '../lib/clients';
import {
  claimRestore,
  findActiveSyncForTheme,
  getActiveMappingForTheme,
  latestCompletedRun,
  type Database,
  getDb,
  getSettings,
  getSyncRun,
  listSyncOperations,
  listSyncRuns,
  mergeRunOptions,
  resetFailedOperations,
  toSyncOperationDto,
  toSyncRunDto,
  transitionSyncRun,
} from '../lib/database';
import { ApiError, ok } from '../lib/response';
import { getTheme } from '../lib/shopify-graphql';
import {
  confirmSyncSchema,
  historyQuerySchema,
  lastSyncQuerySchema,
  parseOrThrow,
  readJsonBody,
  retrySyncSchema,
  splitRepository,
  syncPreviewSchema,
  uuidSchema,
} from '../lib/validators';
import { rateLimit } from '../middleware/error-handler';
import { dispatchSync, STALE_RUN_MS } from '../sync/dispatch';
import { buildSyncPreview } from '../sync/planner';
import { restoreBackup } from '../sync/restore';

const syncLimiter = rateLimit({
  binding: 'SYNC_RATE_LIMITER',
  limit: 10,
  periodSeconds: 60,
  key: (c) => c.get('auth').shopDomain,
});

/**
 * Live-theme guard: the theme is re-read from Shopify now (it may have been
 * published since the preview). Modifying the live theme requires
 * confirmLiveTheme=true AND the exact theme name typed by the user.
 */
/**
 * A theme only receives syncs from the repository branch it is mapped to
 * (Theme mapping page). Checked when previewing and again before writing.
 */
async function assertMapped(db: Database, shopId: string, themeId: string, repository: string, branch: string | null) {
  const mapping = await getActiveMappingForTheme(db, shopId, themeId);
  if (!mapping) {
    throw new ApiError(
      409,
      'MAPPING_REQUIRED',
      `This theme is not mapped to a branch yet. Map ${branch ?? 'a branch'} to it on the Theme mapping page first.`,
    );
  }
  if (mapping.repository.toLowerCase() !== repository.toLowerCase() || mapping.branch !== branch) {
    throw new ApiError(
      409,
      'MAPPING_CONFLICT',
      `${mapping.themeName} is mapped to ${mapping.repository} · ${mapping.branch}, not ${repository} · ${branch ?? '(no branch)'}.`,
      { details: { mappingId: mapping.id, branch: mapping.branch } },
    );
  }
  return mapping;
}

async function assertWriteAllowed(
  c: Context<AppEnv>,
  run: SyncHistoryRow,
  confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string },
  opts: { revalidateSource?: boolean } = {},
): Promise<{ isLive: boolean }> {
  if (opts.revalidateSource) {
    // The mapping, repository access and branch are checked again right before writing.
    await assertMapped(getDb(c.env.DB), run.shopId, run.themeId, run.repository, run.branch);
    const { client } = await githubClient(c);
    const { owner, repo } = splitRepository(run.repository);
    await client.verifyRepositoryAccess(owner, repo);
    if (run.branch) await client.getBranch(owner, repo, run.branch);
  }
  const theme = await getTheme(await adminClient(c), run.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The target theme no longer exists in this store');
  if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `A ${theme.role} theme cannot be modified`);
  if (theme.isLive) {
    if (confirmation.confirmLiveTheme !== true || confirmation.confirmThemeName !== theme.name) {
      throw new ApiError(
        422,
        'LIVE_THEME_CONFIRMATION_REQUIRED',
        `"${theme.name}" is your live theme. Confirm by setting confirmLiveTheme and typing the theme name exactly.`,
        { details: { themeName: theme.name } },
      );
    }
  }
  const active = await findActiveSyncForTheme(getDb(c.env.DB), run.shopId, run.themeId, run.id);
  if (active) {
    throw new ApiError(409, 'CONFLICT', 'Another sync is already running for this theme', {
      details: { syncId: active.id },
    });
  }
  return { isLive: theme.isLive };
}

export const syncRoutes = new Hono<AppEnv>()
  .post('/preview', syncLimiter, async (c) => {
    const { shop, userId } = c.get('auth');
    const body = parseOrThrow(syncPreviewSchema, await readJsonBody(c.req.raw, 512 * 1024));
    const db = getDb(c.env.DB);
    const settings = await getSettings(db, shop.id);
    const { client: github, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection, body.repository);
    // The branch the theme is mapped to, unless the request names one (which must match).
    const mapped = await getActiveMappingForTheme(db, shop.id, body.themeId);
    const branch =
      body.branch ??
      mapped?.branch ??
      target.defaultBranch ??
      (await github.getRepository(target.owner, target.repo)).defaultBranch;
    await assertMapped(db, shop.id, body.themeId, target.fullName, branch);

    const preview = await buildSyncPreview(
      { db, github, admin: await adminClient(c), kv: c.env.KV, logger: c.get('logger') },
      {
        shopId: shop.id,
        userId,
        owner: target.owner,
        repo: target.repo,
        branch,
        commitSha: body.commitSha,
        themeId: body.themeId,
        strategy: body.strategy ?? settings.syncPreferences.strategy,
        allowDeletes: body.allowDeletes ?? settings.syncPreferences.allowDeletes,
        preferences: settings.syncPreferences,
        includePaths: body.includePaths,
        commitShas: body.commitShas,
      },
    );
    return ok<SyncPreview>(c, preview, 'Preview generated. No changes were made to the theme.', 201);
  })
  .post('/', syncLimiter, async (c) => {
    const { shop, userId } = c.get('auth');
    const body = parseOrThrow(confirmSyncSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);

    const run = await getSyncRun(db, shop.id, body.syncId);
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Preview not found');
    if (run.status !== 'previewed') {
      throw new ApiError(409, 'CONFLICT', `This preview was already ${run.status}`, {
        details: { run: toSyncRunDto(run) },
      });
    }
    if (!run.previewExpiresAt || run.previewExpiresAt.getTime() < Date.now()) {
      await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'expired');
      throw new ApiError(410, 'PREVIEW_EXPIRED', 'This preview expired. Generate a new preview.');
    }

    // Step 3 results: code errors block the sync; direct edits need an explicit "replace".
    const checks = (run.options as { checks?: SyncChecks } | null)?.checks;
    if (checks?.code.status === 'failed') {
      throw new ApiError(422, 'CODE_ERRORS', 'The code check found errors. Ask your developer to fix them and choose the new commit.', {
        details: { issues: checks.code.issues },
      });
    }
    if (checks?.directEdits.status === 'warning' && body.acceptDirectEdits !== true) {
      throw new ApiError(
        422,
        'DIRECT_EDITS_FOUND',
        'Some files were edited directly in Shopify since the last sync. Confirm that they may be replaced.',
        { details: { files: checks.directEdits.files } },
      );
    }

    const { isLive } = await assertWriteAllowed(c, run, body, { revalidateSource: true });

    // Atomic previewed → queued: a double-submit cannot start two runs.
    const queued = await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'queued', {
      attempt: 1,
      options: { ...(run.options as object), confirmedLive: isLive, confirmedBy: userId },
    });
    if (!queued) throw new ApiError(409, 'CONFLICT', 'This preview was confirmed by another request');

    const mode = await dispatchSync(c.env, c.executionCtx, { syncId: run.id, shopId: shop.id }, c.get('logger'));
    c.get('logger').info('sync.confirmed', { syncId: run.id, mode, live: isLive });
    return ok<SyncRun>(c, toSyncRunDto(queued), 'Sync started', 202);
  })
  .get('/history', async (c) => {
    const query = parseOrThrow(historyQuerySchema, c.req.query());
    const { rows, hasNextPage } = await listSyncRuns(getDb(c.env.DB), c.get('auth').shop.id, query);
    return ok<Paginated<SyncRun>>(c, {
      items: rows.map(toSyncRunDto),
      page: query.page,
      perPage: query.perPage,
      hasNextPage,
    });
  })
  .get('/last', async (c) => {
    // Only a sync that produced a recorded result counts (never a queued or running job).
    const query = parseOrThrow(lastSyncQuerySchema, c.req.query());
    const run = await latestCompletedRun(getDb(c.env.DB), c.get('auth').shop.id, query.themeId, query.branch ?? null);
    return ok<SyncRun | null>(c, run ? toSyncRunDto(run) : null);
  })
  .get('/history/:id', async (c) => {
    const id = parseOrThrow(uuidSchema, c.req.param('id'));
    const { shop } = c.get('auth');
    const db = getDb(c.env.DB);
    const run = await getSyncRun(db, shop.id, id);
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Sync not found');

    // Fallback mode (no queue): resume a stalled run when the UI polls it.
    if (
      !c.env.SYNC_QUEUE &&
      (run.status === 'queued' || run.status === 'running') &&
      Date.now() - run.updatedAt.getTime() > STALE_RUN_MS
    ) {
      await transitionSyncRun(db, shop.id, id, ['queued', 'running'], run.status, {});
      await dispatchSync(c.env, c.executionCtx, { syncId: id, shopId: shop.id }, c.get('logger'));
    }

    const operations = await listSyncOperations(db, shop.id, id);
    const dto = toSyncRunDto(run);
    if (run.status === 'queued' || run.status === 'running') {
      // Live progress straight from the files, not the last saved counters.
      dto.filesSucceeded = operations.filter((op) => op.status === 'succeeded').length;
      dto.filesFailed = operations.filter((op) => op.status === 'failed').length;
      dto.filesSkipped = operations.filter((op) => op.status === 'skipped').length;
    }
    return ok<SyncRunDetail>(c, { ...dto, operations: operations.map(toSyncOperationDto) });
  })
  .post('/history/:id/retry', syncLimiter, async (c) => {
    const id = parseOrThrow(uuidSchema, c.req.param('id'));
    const body = parseOrThrow(retrySyncSchema, await readJsonBody(c.req.raw));
    const { shop, userId } = c.get('auth');
    const db = getDb(c.env.DB);
    const run = await getSyncRun(db, shop.id, id);
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Sync not found');
    if (run.status !== 'failed' && run.status !== 'partially_failed') {
      throw new ApiError(409, 'CONFLICT', `A ${run.status} sync cannot be retried`);
    }
    if (!toSyncRunDto(run).canRetry) {
      throw new ApiError(409, 'CONFLICT', 'The backup of this update was restored; run the full update again instead');
    }

    const { isLive } = await assertWriteAllowed(c, run, body, { revalidateSource: true });
    const reset = await resetFailedOperations(db, shop.id, id);
    const queued = await transitionSyncRun(db, shop.id, id, ['failed', 'partially_failed'], 'queued', {
      attempt: run.attempt + 1,
      completedAt: null,
      errorDetails: null,
      options: { ...(run.options as object), confirmedLive: isLive, confirmedBy: userId },
    });
    if (!queued) throw new ApiError(409, 'CONFLICT', 'This sync changed state; refresh and try again');

    await dispatchSync(c.env, c.executionCtx, { syncId: id, shopId: shop.id }, c.get('logger'));
    c.get('logger').info('sync.retried', { syncId: id, resetOperations: reset, attempt: queued.attempt });
    return ok<SyncRun>(c, toSyncRunDto(queued), `Retrying ${reset} failed file(s)`, 202);
  })
  .post('/history/:id/restore', syncLimiter, async (c) => {
    const id = parseOrThrow(uuidSchema, c.req.param('id'));
    const body = parseOrThrow(retrySyncSchema, await readJsonBody(c.req.raw));
    const { shop, userId } = c.get('auth');
    const db = getDb(c.env.DB);
    const run = await getSyncRun(db, shop.id, id);
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'Sync not found');
    if (!toSyncRunDto(run).canRestore) {
      throw new ApiError(409, 'CONFLICT', 'Only an incomplete update with a backup can be restored');
    }
    await assertWriteAllowed(c, run, body);
    const claimed = await claimRestore(db, shop.id, id);
    if (!claimed) throw new ApiError(409, 'CONFLICT', 'This backup is already being restored; refresh in a moment');

    let result;
    try {
      result = await restoreBackup({ db, admin: await adminClient(c), kv: c.env.KV, logger: c.get('logger') }, claimed);
    } catch (err) {
      await mergeRunOptions(db, shop.id, id, { restoring: null });
      throw err;
    }
    const complete = result.failed.length === 0;
    await mergeRunOptions(db, shop.id, id, {
      restoring: null,
      ...(complete
        ? { restoredAt: new Date().toISOString(), restoredFiles: result.restored + result.removed, restoredBy: userId }
        : { restoreFailed: result.failed.slice(0, 50) }),
    });
    const updated = (await getSyncRun(db, shop.id, id))!;
    if (!complete) {
      throw new ApiError(
        502,
        'SHOPIFY_ERROR',
        `${result.failed.length} file(s) could not be restored (${result.failed[0]!.path}: ${result.failed[0]!.message}). Try again.`,
        { details: { failed: result.failed.slice(0, 50) } },
      );
    }
    return ok<SyncRun>(
      c,
      toSyncRunDto(updated),
      `Backup restored: ${result.restored} file(s) put back, ${result.removed} new file(s) removed`,
    );
  });
