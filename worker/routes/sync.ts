/**
 * Preview-first theme synchronization.
 *
 *   POST /api/sync/preview            plan only; persists the plan (status "previewed", 30 min TTL)
 *   POST /api/sync                    { syncId, confirm: true, confirmLiveTheme?, confirmThemeName? }
 *                                     executes exactly the previewed plan in the background (202)
 *   GET  /api/sync/history            ?page&perPage&status&includePreviews
 *   GET  /api/sync/history/:id        run + per-file operations
 *   POST /api/sync/history/:id/retry  re-runs failed/pending operations (idempotent writes)
 */
import { Hono, type Context } from 'hono';
import type { Paginated, SyncChecks, SyncPreview, SyncRun, SyncRunDetail } from '../../shared/api-types';
import type { SyncHistoryRow } from '../../drizzle/schema';
import type { AppEnv } from '../env';
import { adminClient, githubClient, resolveRepository } from '../lib/clients';
import {
  findActiveSyncForTheme,
  getDb,
  getSettings,
  getSyncRun,
  listSyncOperations,
  listSyncRuns,
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
  parseOrThrow,
  readJsonBody,
  retrySyncSchema,
  syncPreviewSchema,
  uuidSchema,
} from '../lib/validators';
import { rateLimit } from '../middleware/error-handler';
import { dispatchSync, STALE_RUN_MS } from '../sync/dispatch';
import { buildSyncPreview } from '../sync/planner';

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
async function assertWriteAllowed(
  c: Context<AppEnv>,
  run: SyncHistoryRow,
  confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string },
): Promise<{ isLive: boolean }> {
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
    // The branch is needed to know the theme's last synced commit on it.
    const branch =
      body.branch ?? target.defaultBranch ?? (await github.getRepository(target.owner, target.repo)).defaultBranch;

    const preview = await buildSyncPreview(
      { db, github, admin: await adminClient(c), logger: c.get('logger') },
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

    const { isLive } = await assertWriteAllowed(c, run, body);

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
    return ok<SyncRunDetail>(c, { ...toSyncRunDto(run), operations: operations.map(toSyncOperationDto) });
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

    const { isLive } = await assertWriteAllowed(c, run, body);
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
  });
