/**
 * Executes a confirmed sync in bounded chunks with durable, retry-safe state.
 *
 * State lives in D1 (sync_history + sync_operations), not in memory, so any
 * chunk can crash or time out and the next chunk resumes from the remaining
 * `pending` operations. Writes are idempotent: an upsert always writes the
 * content of the same blob from the same commit SHA, and deleting a file that is
 * already gone counts as success. Re-delivered queue messages therefore cannot
 * corrupt a theme.
 *
 * Per chunk: up to 50 operations (Shopify's per-mutation file limit), with an
 * additional ~4 MB request-body budget per upsert mutation.
 */
import type { SyncStatus } from '../../drizzle/schema';
import type { Env } from '../env';
import { createAdminClientForShop, createGithubClientForShop } from '../lib/clients';
import { gitBlobSha, bytesToBase64 } from '../lib/crypto';
import {
  addBackedUp,
  countOperations,
  listLastSyncedForTheme,
  saveLastSynced,
  findShopById,
  getDb,
  getSyncRun,
  listPendingOperations,
  transitionSyncRun,
  updateOperations,
  type Database,
} from '../lib/database';
import type { GitHubClient } from '../lib/github-client';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import {
  THEME_WRITE_BATCH_LIMIT,
  deleteThemeFiles,
  getTheme,
  upsertThemeFiles,
  waitForJob,
  type ShopifyGraphqlClient,
  getThemeFileBodies,
  type ThemeFileBody,
} from '../lib/shopify-graphql';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import { checkThemeFile } from './code-check';
import { buildThemeSyncMarker, fetchThemeSyncMarker, type ThemeSyncMarker } from './theme-state';
import { splitRepository } from '../lib/validators';
import { MAX_FILE_BYTES } from './planner';
import type { SyncHistoryRow, SyncOperationRow } from '../../drizzle/schema';

const MAX_OPERATION_ATTEMPTS = 3;
const MAX_UPSERT_PAYLOAD_BYTES = 4 * 1024 * 1024;

export interface ChunkResult {
  done: boolean;
  /** Suggested delay before the next chunk (rate limits). */
  retryAfterSeconds?: number;
}

export interface ExecutorOptions {
  /** Absolute time (ms) after which no new batch is started. */
  deadline: number;
  fetchImpl?: typeof fetch;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); // keep a BOM byte-for-byte

/** UTF-8 text is sent as TEXT; anything else (images, fonts) as BASE64. */
export function encodeBody(bytes: Uint8Array): ThemeFileBody {
  try {
    return { type: 'TEXT', value: textDecoder.decode(bytes) };
  } catch {
    return { type: 'BASE64', value: bytesToBase64(bytes) };
  }
}

function isTransient(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 429 || err.status >= 500 || err.code === 'UPSTREAM_TIMEOUT' || err.code === 'SHOPIFY_THROTTLED')
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function failOrRetry(db: Database, shopId: string, ops: SyncOperationRow[], err: unknown) {
  const message = errorMessage(err).slice(0, 1000);
  const transient = isTransient(err);
  const exhausted = ops.filter((op) => !transient || op.attempts + 1 >= MAX_OPERATION_ATTEMPTS);
  const retry = ops.filter((op) => !exhausted.includes(op));
  await updateOperations(db, shopId, exhausted.map((o) => o.id), { status: 'failed', error: message, incrementAttempts: true });
  await updateOperations(db, shopId, retry.map((o) => o.id), { error: message, incrementAttempts: true });
}

async function fetchVerifiedContent(
  github: GitHubClient,
  repository: string,
  commitSha: string,
  op: SyncOperationRow,
): Promise<Uint8Array> {
  const { owner, repo } = splitRepository(repository);
  const sourcePath = op.sourcePath ?? op.path;
  // Exact commit: Contents API with ref=<full SHA>, never a branch name.
  const bytes = await github.getFileAtCommit(owner, repo, sourcePath, commitSha);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ApiError(422, 'VALIDATION_ERROR', `File is ${bytes.byteLength} bytes; the sync limit is ${MAX_FILE_BYTES}`);
  }
  // Step 3 again for every file: code with errors never reaches Shopify.
  const issues = checkThemeFile(op.path, bytes);
  if (issues.length > 0) {
    const first = issues[0]!;
    throw new ApiError(422, 'CODE_ERRORS', `Code error${first.line ? ` on line ${first.line}` : ''}: ${first.message}`);
  }
  if (op.blobSha) {
    const actual = await gitBlobSha(bytes);
    if (actual !== op.blobSha) {
      throw new ApiError(
        409,
        'CONFLICT',
        `Integrity check failed: content of ${sourcePath} does not match blob ${op.blobSha.slice(0, 7)} at ${commitSha.slice(0, 7)}`,
      );
    }
  }
  return bytes;
}

export const BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;
export const backupKey = (shopId: string, syncId: string, path: string) => `backup:${shopId}:${syncId}:${path}`;

/**
 * Saves the theme's current version of `paths` before they change (or records
 * that a file did not exist). A retry never overwrites an existing backup, so
 * the backup always holds the theme as it was before this sync.
 */
async function backupFiles(
  ctx: { db: Database; shopId: string; admin: ShopifyGraphqlClient; kv: KVNamespace; fetchImpl?: typeof fetch },
  run: { id: string; themeId: string },
  paths: string[],
): Promise<void> {
  const missing: string[] = [];
  for (const path of paths) {
    if ((await ctx.kv.get(backupKey(ctx.shopId, run.id, path))) === null) missing.push(path);
  }
  if (missing.length === 0) return;
  const bodies = await getThemeFileBodies(ctx.admin, run.themeId, missing, ctx.fetchImpl);
  for (const path of missing) {
    const body = bodies.get(path);
    await ctx.kv.put(backupKey(ctx.shopId, run.id, path), JSON.stringify(body ? { path, ...body } : { path, absent: true }), {
      expirationTtl: BACKUP_TTL_SECONDS,
    });
  }
  await addBackedUp(ctx.db, ctx.shopId, run.id, missing.length);
}

async function processUpserts(
  ctx: { db: Database; shopId: string; github: GitHubClient; admin: ShopifyGraphqlClient; logger: Logger; kv: KVNamespace; fetchImpl?: typeof fetch },
  run: { id: string; repository: string; commitSha: string; themeId: string },
  ops: SyncOperationRow[],
): Promise<void> {
  const { db, shopId, github, admin, logger } = ctx;
  const ready: { op: SyncOperationRow; body: ThemeFileBody; bytes: number }[] = [];

  for (const op of ops) {
    try {
      const bytes = await fetchVerifiedContent(github, run.repository, run.commitSha, op);
      ready.push({ op, body: encodeBody(bytes), bytes: bytes.byteLength });
    } catch (err) {
      // Rate limits abort the chunk so the dispatcher can back off; nothing was written.
      if (err instanceof ApiError && err.code === 'GITHUB_RATE_LIMITED') throw err;
      logger.warn('sync.fetch_failed', { path: op.path, error: errorMessage(err) });
      await failOrRetry(db, shopId, [op], err);
    }
  }

  // Group into mutation batches bounded by file count and payload size.
  const batches: (typeof ready)[] = [];
  let current: typeof ready = [];
  let size = 0;
  for (const item of ready) {
    const encoded = item.body.type === 'BASE64' ? Math.ceil((item.bytes * 4) / 3) : item.bytes;
    if (current.length > 0 && (current.length >= THEME_WRITE_BATCH_LIMIT || size + encoded > MAX_UPSERT_PAYLOAD_BYTES)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += encoded;
  }
  if (current.length > 0) batches.push(current);

  for (const batch of batches) {
    const batchOps = batch.map((b) => b.op);
    try {
      // Step 5: the theme's current version of these files is saved first.
      await backupFiles(ctx, run, batchOps.map((o) => o.path));
      const result = await upsertThemeFiles(
        admin,
        run.themeId,
        batch.map((b) => ({ filename: b.op.path, body: b.body })),
      );
      if (result.jobId && !result.jobDone) {
        const finished = await waitForJob(admin, result.jobId);
        if (!finished) {
          // Accepted but still processing: retry later; re-upserting the same content is harmless.
          await failOrRetry(
            db,
            shopId,
            batchOps,
            new ApiError(504, 'UPSTREAM_TIMEOUT', 'Shopify did not finish processing these files in time'),
          );
          continue;
        }
      }
      const byName = new Map(batchOps.map((o) => [o.path, o]));
      await updateOperations(
        db,
        shopId,
        result.succeeded.map((n) => byName.get(n)?.id).filter((id): id is string => !!id),
        { status: 'succeeded', error: null, incrementAttempts: true },
      );
      for (const failure of result.failed) {
        const op = byName.get(failure.filename);
        if (op) {
          await updateOperations(db, shopId, [op.id], {
            status: 'failed',
            error: `${failure.code ?? 'ERROR'}: ${failure.message}`.slice(0, 1000),
            incrementAttempts: true,
          });
        }
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'THEME_WRITE_NOT_PERMITTED' || err.code === 'SHOPIFY_REAUTH_REQUIRED')) {
        throw err;
      }
      logger.warn('sync.upsert_batch_failed', { files: batchOps.length, error: errorMessage(err) });
      await failOrRetry(db, shopId, batchOps, err);
    }
  }
}

async function processDeletes(
  ctx: { db: Database; shopId: string; admin: ShopifyGraphqlClient; logger: Logger; kv: KVNamespace; fetchImpl?: typeof fetch },
  run: { id: string; themeId: string },
  ops: SyncOperationRow[],
): Promise<void> {
  const { db, shopId, admin, logger } = ctx;
  const themeId = run.themeId;
  try {
    await backupFiles(ctx, run, ops.map((o) => o.path));
    const result = await deleteThemeFiles(admin, themeId, ops.map((o) => o.path));
    const byName = new Map(ops.map((o) => [o.path, o]));
    await updateOperations(
      db,
      shopId,
      result.succeeded.map((n) => byName.get(n)?.id).filter((id): id is string => !!id),
      { status: 'succeeded', error: null, incrementAttempts: true },
    );
    for (const failure of result.failed) {
      const op = byName.get(failure.filename);
      if (op) {
        await updateOperations(db, shopId, [op.id], {
          status: 'failed',
          error: `${failure.code ?? 'ERROR'}: ${failure.message}`.slice(0, 1000),
          incrementAttempts: true,
        });
      }
    }
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'THEME_WRITE_NOT_PERMITTED' || err.code === 'SHOPIFY_REAUTH_REQUIRED')) {
      throw err;
    }
    logger.warn('sync.delete_batch_failed', { files: ops.length, error: errorMessage(err) });
    await failOrRetry(db, shopId, ops, err);
  }
}

/** Updates the run's file counters while it is running (the status is not changed). */
async function saveProgress(db: Database, shopId: string, syncId: string): Promise<void> {
  const counts = await countOperations(db, shopId, syncId);
  await transitionSyncRun(db, shopId, syncId, ['running'], 'running', {
    filesSucceeded: counts.succeeded,
    filesFailed: counts.failed,
    filesSkipped: counts.skipped,
  });
}

/** Recomputes counters and, when nothing is pending, the final status. */
export async function finalizeIfComplete(db: Database, shopId: string, syncId: string): Promise<SyncStatus | null> {
  const counts = await countOperations(db, shopId, syncId);
  const progress = {
    filesSucceeded: counts.succeeded,
    filesFailed: counts.failed,
    filesSkipped: counts.skipped,
  };
  if (counts.pending > 0) {
    await transitionSyncRun(db, shopId, syncId, ['running'], 'running', progress);
    return null;
  }
  const status: SyncStatus =
    counts.failed === 0 ? 'succeeded' : counts.succeeded > 0 ? 'partially_failed' : 'failed';
  await transitionSyncRun(db, shopId, syncId, ['running', 'queued'], status, {
    ...progress,
    completedAt: new Date(),
    errorDetails:
      counts.failed > 0 ? { code: 'FILES_FAILED', message: `${counts.failed} file(s) failed to sync` } : null,
  });
  return status;
}

/**
 * After every file succeeded: the commit becomes the theme's last synced commit
 * for the run's branch, and assets/theme-sync.json is written into the theme as
 * the very last step with the last synced commit of every branch (a duplicated
 * theme keeps it). Never fails the run.
 */
async function recordLastSynced(db: Database, admin: ShopifyGraphqlClient, run: SyncHistoryRow, logger: Logger): Promise<void> {
  const syncedAt = new Date();
  try {
    if (run.branch) {
      await saveLastSynced(db, run.shopId, {
        themeId: run.themeId,
        branch: run.branch,
        commitSha: run.commitSha,
        commitMessage: run.commitMessage,
        syncId: run.id,
        syncedAt,
      });
    }
    // The file keeps the last synced commit of every branch, not only this sync.
    let previous: ThemeSyncMarker | null = null;
    try {
      previous = await fetchThemeSyncMarker(admin, run.themeId);
    } catch (err) {
      logger.warn('sync.marker_read_failed', { error: errorMessage(err) });
    }
    const marker = buildThemeSyncMarker({
      previous,
      rows: await listLastSyncedForTheme(db, run.shopId, run.themeId),
      sync: {
        commitSha: run.commitSha,
        message: run.commitMessage,
        repository: run.repository,
        branch: run.branch,
        themeName: run.themeName,
        syncedOn: syncedAt.toISOString(),
        syncId: run.id,
      },
    });
    await upsertThemeFiles(admin, run.themeId, [
      { filename: THEME_SYNC_MARKER_PATH, body: { type: 'TEXT', value: `${JSON.stringify(marker, null, 2)}\n` } },
    ]);
  } catch (err) {
    logger.warn('sync.last_synced_record_failed', { error: errorMessage(err) });
  }
}

async function failRun(db: Database, shopId: string, syncId: string, code: string, message: string) {
  const counts = await countOperations(db, shopId, syncId);
  await transitionSyncRun(db, shopId, syncId, ['queued', 'running'], 'failed', {
    filesSucceeded: counts.succeeded,
    filesFailed: counts.failed,
    filesSkipped: counts.skipped,
    completedAt: new Date(),
    errorDetails: { code, message },
  });
}

/**
 * Processes pending operations of one sync until none remain or the deadline
 * passes. Safe to call concurrently or repeatedly for the same sync.
 */
export async function processSyncChunk(
  env: Env,
  message: { syncId: string; shopId: string },
  baseLogger: Logger,
  options: ExecutorOptions,
): Promise<ChunkResult> {
  const db = getDb(env.DB);
  const { syncId, shopId } = message;
  const logger = baseLogger.child({ syncId, shopId });

  const run = await getSyncRun(db, shopId, syncId);
  if (!run || !['queued', 'running'].includes(run.status)) return { done: true };

  const shop = await findShopById(db, shopId);
  if (!shop || shop.status !== 'installed') {
    await failRun(db, shopId, syncId, 'SHOP_UNINSTALLED', 'The app is no longer installed on this store');
    return { done: true };
  }

  await transitionSyncRun(db, shopId, syncId, ['queued', 'running'], 'running', {
    startedAt: run.startedAt ?? new Date(),
  });

  let admin: ShopifyGraphqlClient;
  let github: GitHubClient;
  try {
    admin = await createAdminClientForShop(env, db, shop, logger, { fetchImpl: options.fetchImpl });
    ({ client: github } = await createGithubClientForShop(env, db, shop, logger, { fetchImpl: options.fetchImpl }));

    // The theme must still exist in this shop and be writable; a theme published
    // after the preview must not be modified without live-theme confirmation.
    const theme = await getTheme(admin, run.themeId);
    if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The target theme no longer exists');
    if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `The theme is ${theme.role} and cannot be modified`);
    const confirmedLive = (run.options as { confirmedLive?: boolean } | null)?.confirmedLive === true;
    if (theme.isLive && !confirmedLive) {
      throw new ApiError(
        409,
        'LIVE_THEME_CONFIRMATION_REQUIRED',
        'The theme became the live theme after this sync was confirmed. Preview again to confirm.',
      );
    }
  } catch (err) {
    if (isTransient(err)) {
      return { done: false, retryAfterSeconds: err instanceof ApiError ? (err.retryAfter ?? 30) : 30 };
    }
    const apiErr = err instanceof ApiError ? err : null;
    await failRun(db, shopId, syncId, apiErr?.code ?? 'INTERNAL_ERROR', errorMessage(err));
    logger.error('sync.setup_failed', { error: errorMessage(err) });
    return { done: true };
  }

  const ctx = { db, shopId, github, admin, logger, kv: env.KV, fetchImpl: options.fetchImpl };
  try {
    while (Date.now() < options.deadline) {
      const pending = await listPendingOperations(db, shopId, syncId, THEME_WRITE_BATCH_LIMIT);
      if (pending.length === 0) break;
      const deletes = pending.filter((op) => op.action === 'delete');
      const upserts = pending.filter((op) => op.action === 'upsert');
      if (upserts.length > 0) await processUpserts(ctx, run, upserts);
      if (deletes.length > 0) await processDeletes(ctx, run, deletes);
      // Progress after every batch, so the result page counts files as they are updated.
      await saveProgress(db, shopId, syncId);
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'GITHUB_RATE_LIMITED') {
      logger.warn('sync.github_rate_limited', { retryAfter: err.retryAfter });
      await finalizeIfComplete(db, shopId, syncId);
      return { done: false, retryAfterSeconds: err.retryAfter ?? 60 };
    }
    // Permission / auth problems apply to every remaining file: stop the run.
    await failRun(db, shopId, syncId, err instanceof ApiError ? err.code : 'INTERNAL_ERROR', errorMessage(err));
    logger.error('sync.run_failed', { error: errorMessage(err) });
    return { done: true };
  }

  const status = await finalizeIfComplete(db, shopId, syncId);
  if (status) logger.info('sync.completed', { status });
  if (status === 'succeeded') await recordLastSynced(db, admin, run, logger);
  return { done: status !== null };
}
