/**
 * Applies a confirmed run in bounded, resumable chunks.
 *
 * Phases (all state is in D1, so any chunk can stop and the next one resumes):
 *   1. Backup  – the current version of every affected file is saved to KV
 *                (or recorded as "did not exist") before any file changes.
 *   2. Apply   – files are written / removed in batches of up to 50. Content
 *                from GitHub is pinned to the commit SHA, verified against its
 *                Git blob SHA and code-checked before it is sent to Shopify.
 *   3. Finish  – only when every file succeeded: assets/theme-sync.json is
 *                written last and the theme's "last synced update" is saved.
 *                Otherwise the theme keeps its previous last synced update.
 *
 * Writes are idempotent (same content for the same path; deleting a missing
 * file counts as done), so re-delivered queue messages cannot corrupt a theme.
 */
import type { SyncHistoryRow, SyncOperationRow, SyncStatus } from '../../drizzle/schema';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import type { Env } from '../env';
import { createAdminClientForShop, createGithubClientForShop } from '../lib/clients';
import { bytesToBase64, gitBlobSha } from '../lib/crypto';
import {
  countOperations,
  deleteFileChecksums,
  findShopById,
  getDb,
  getMarkerOperation,
  getSyncRun,
  getThemeState,
  listOperationsNeedingBackup,
  listPendingOperations,
  saveFileChecksums,
  transitionSyncRun,
  updateOperations,
  upsertThemeState,
  type Database,
} from '../lib/database';
import type { GitHubClient } from '../lib/github-client';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import {
  THEME_WRITE_BATCH_LIMIT,
  deleteThemeFiles,
  getTheme,
  getThemeFileBodies,
  getThemeFilesMetadata,
  upsertThemeFiles,
  waitForJob,
  type ShopifyGraphqlClient,
  type ThemeFileBody,
} from '../lib/shopify-graphql';
import { splitRepository } from '../lib/validators';
import { checkThemeFile } from './code-check';
import { BACKUP_TTL_SECONDS, MAX_FILE_BYTES, type RunOptions } from './plan';

const MAX_OPERATION_ATTEMPTS = 3;
const MAX_UPSERT_PAYLOAD_BYTES = 4 * 1024 * 1024;

export interface ChunkResult {
  done: boolean;
  /** Suggested delay before the next chunk (rate limits, temporary Shopify issues). */
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

export const backupKey = (shopId: string, syncId: string, opId: string) => `backup:${shopId}:${syncId}:${opId}`;

function isTransient(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 429 || err.status >= 500 || err.code === 'UPSTREAM_TIMEOUT' || err.code === 'SHOPIFY_THROTTLED')
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Shopify rejects files with Liquid/JSON problems through userErrors. */
function classifyUserError(message: string): 'code' | 'other' {
  return /liquid|syntax|json|schema|parse|unexpected|invalid/i.test(message) ? 'code' : 'other';
}

interface Ctx {
  db: Database;
  shopId: string;
  run: SyncHistoryRow;
  admin: ShopifyGraphqlClient;
  github: () => Promise<GitHubClient>;
  kv: KVNamespace;
  logger: Logger;
  fetchImpl?: typeof fetch;
  /** Set when a temporary problem asked for a pause before the next chunk. */
  backoff: number;
}

async function failOrRetry(ctx: Ctx, ops: SyncOperationRow[], err: unknown) {
  const message = errorMessage(err).slice(0, 1000);
  const transient = isTransient(err);
  if (transient) ctx.backoff = Math.max(ctx.backoff, err instanceof ApiError ? (err.retryAfter ?? 10) : 10);
  const exhausted = ops.filter((op) => !transient || op.attempts + 1 >= MAX_OPERATION_ATTEMPTS);
  const retry = ops.filter((op) => !exhausted.includes(op));
  await updateOperations(ctx.db, ctx.shopId, exhausted.map((o) => o.id), {
    status: 'failed',
    error: message,
    errorKind: transient ? 'transient' : 'other',
    incrementAttempts: true,
  });
  await updateOperations(ctx.db, ctx.shopId, retry.map((o) => o.id), { error: message, incrementAttempts: true });
}

// ---------------------------------------------------------------------------
// Phase 1: backup
// ---------------------------------------------------------------------------
async function backupBatch(ctx: Ctx, ops: SyncOperationRow[]): Promise<void> {
  const bodies = await getThemeFileBodies(ctx.admin, ctx.run.themeId, ops.map((o) => o.path), ctx.fetchImpl);
  for (const op of ops) {
    const body = bodies.get(op.path);
    if (!body) {
      await updateOperations(ctx.db, ctx.shopId, [op.id], { backupState: 'absent' });
      continue;
    }
    const key = backupKey(ctx.shopId, ctx.run.id, op.id);
    await ctx.kv.put(key, JSON.stringify({ path: op.path, type: body.type, value: body.value }), {
      expirationTtl: BACKUP_TTL_SECONDS,
    });
    await updateOperations(ctx.db, ctx.shopId, [op.id], { backupState: 'saved', backupKey: key });
  }
}

// ---------------------------------------------------------------------------
// Phase 2: apply
// ---------------------------------------------------------------------------
async function contentFor(ctx: Ctx, op: SyncOperationRow): Promise<{ body: ThemeFileBody; bytes: number }> {
  if (op.contentSource === 'backup') {
    const saved = op.contentKey ? await ctx.kv.get<{ type: 'TEXT' | 'BASE64'; value: string }>(op.contentKey, 'json') : null;
    if (!saved) throw new ApiError(410, 'BACKUP_UNAVAILABLE', 'The saved copy of this file is no longer available');
    return { body: { type: saved.type, value: saved.value }, bytes: saved.value.length };
  }
  const { owner, repo } = splitRepository(ctx.run.repository);
  const commitSha = op.sourceCommitSha ?? ctx.run.commitSha;
  const github = await ctx.github();
  // Exact commit: Contents API with ref=<full SHA>, never a branch name.
  const bytes = await github.getFileAtCommit(owner, repo, op.sourcePath ?? op.path, commitSha);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ApiError(422, 'VALIDATION_ERROR', `File is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}`);
  }
  if (op.blobSha && (await gitBlobSha(bytes)) !== op.blobSha) {
    throw new ApiError(409, 'CONFLICT', `Integrity check failed: the content does not match update ${commitSha.slice(0, 7)}`);
  }
  const issues = checkThemeFile(op.path, bytes);
  if (issues.length > 0) {
    const first = issues[0]!;
    throw Object.assign(new ApiError(422, 'CODE_ERRORS', `Code error${first.line ? ` on line ${first.line}` : ''}: ${first.message}`), {
      codeError: true,
    });
  }
  return { body: encodeBody(bytes), bytes: bytes.byteLength };
}

async function recordChecksums(ctx: Ctx, paths: string[], commitSha: string | null) {
  if (paths.length === 0) return;
  try {
    const meta = await getThemeFilesMetadata(ctx.admin, ctx.run.themeId, paths);
    await saveFileChecksums(
      ctx.db,
      ctx.shopId,
      ctx.run.themeId,
      paths.map((path) => ({ path, checksumMd5: meta.get(path)?.checksumMd5 ?? null, commitSha })),
    );
  } catch (err) {
    // Only used for direct edit detection; never fail a run over it.
    ctx.logger.warn('update.checksum_record_failed', { error: errorMessage(err) });
  }
}

async function processUpserts(ctx: Ctx, ops: SyncOperationRow[]): Promise<void> {
  const ready: { op: SyncOperationRow; body: ThemeFileBody; bytes: number }[] = [];
  for (const op of ops) {
    try {
      ready.push({ op, ...(await contentFor(ctx, op)) });
    } catch (err) {
      // Rate limits abort the chunk so the dispatcher can back off; nothing was written.
      if (err instanceof ApiError && err.code === 'GITHUB_RATE_LIMITED') throw err;
      if ((err as { codeError?: boolean }).codeError) {
        await updateOperations(ctx.db, ctx.shopId, [op.id], {
          status: 'failed',
          error: errorMessage(err).slice(0, 1000),
          errorKind: 'code',
          incrementAttempts: true,
        });
        continue;
      }
      ctx.logger.warn('update.fetch_failed', { path: op.path, error: errorMessage(err) });
      await failOrRetry(ctx, [op], err);
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
      const result = await upsertThemeFiles(ctx.admin, ctx.run.themeId, batch.map((b) => ({ filename: b.op.path, body: b.body })));
      if (result.jobId && !result.jobDone && !(await waitForJob(ctx.admin, result.jobId))) {
        // Accepted but still processing: retry later; re-upserting the same content is harmless.
        await failOrRetry(ctx, batchOps, new ApiError(504, 'UPSTREAM_TIMEOUT', 'Shopify did not finish processing these files in time'));
        continue;
      }
      const byName = new Map(batchOps.map((o) => [o.path, o]));
      const succeeded = result.succeeded.map((n) => byName.get(n)).filter((o): o is SyncOperationRow => !!o);
      await updateOperations(ctx.db, ctx.shopId, succeeded.map((o) => o.id), {
        status: 'succeeded',
        error: null,
        errorKind: null,
        incrementAttempts: true,
      });
      for (const failure of result.failed) {
        const op = byName.get(failure.filename);
        if (!op) continue;
        await updateOperations(ctx.db, ctx.shopId, [op.id], {
          status: 'failed',
          error: failure.message.slice(0, 1000),
          errorKind: classifyUserError(failure.message),
          incrementAttempts: true,
        });
      }
      await recordChecksums(
        ctx,
        succeeded.filter((o) => o.contentSource !== 'marker').map((o) => o.path),
        ctx.run.kind === 'restore' ? null : ctx.run.commitSha,
      );
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'THEME_WRITE_NOT_PERMITTED' || err.code === 'SHOPIFY_REAUTH_REQUIRED')) throw err;
      ctx.logger.warn('update.upsert_batch_failed', { files: batchOps.length, error: errorMessage(err) });
      await failOrRetry(ctx, batchOps, err);
    }
  }
}

async function processDeletes(ctx: Ctx, ops: SyncOperationRow[]): Promise<void> {
  try {
    const result = await deleteThemeFiles(ctx.admin, ctx.run.themeId, ops.map((o) => o.path));
    const byName = new Map(ops.map((o) => [o.path, o]));
    await updateOperations(
      ctx.db,
      ctx.shopId,
      result.succeeded.map((n) => byName.get(n)?.id).filter((id): id is string => !!id),
      { status: 'succeeded', error: null, errorKind: null, incrementAttempts: true },
    );
    for (const failure of result.failed) {
      const op = byName.get(failure.filename);
      if (op) {
        await updateOperations(ctx.db, ctx.shopId, [op.id], {
          status: 'failed',
          error: failure.message.slice(0, 1000),
          errorKind: 'other',
          incrementAttempts: true,
        });
      }
    }
    await deleteFileChecksums(ctx.db, ctx.shopId, ctx.run.themeId, result.succeeded);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'THEME_WRITE_NOT_PERMITTED' || err.code === 'SHOPIFY_REAUTH_REQUIRED')) throw err;
    ctx.logger.warn('update.delete_batch_failed', { files: ops.length, error: errorMessage(err) });
    await failOrRetry(ctx, ops, err);
  }
}

// ---------------------------------------------------------------------------
// Phase 3: finish
// ---------------------------------------------------------------------------
const LINE_LABEL = { staging: 'Staging', live: 'Live' } as const;

export function markerContent(run: SyncHistoryRow, syncedAt: Date, verifiedOnStagingAt: Date | null): string {
  return `${JSON.stringify(
    {
      app: 'Theme Sync',
      lastSyncedUpdate: run.commitSha,
      description: (run.commitMessage ?? '').split('\n')[0] ?? '',
      themeRole: LINE_LABEL[run.line],
      verifiedOnStaging: verifiedOnStagingAt ? verifiedOnStagingAt.toISOString() : null,
      syncedOn: syncedAt.toISOString(),
      repository: run.repository,
      branch: run.branch,
    },
    null,
    2,
  )}\n`;
}

/** Saves the theme's last synced update (only called when every file succeeded). */
async function recordLastSynced(ctx: Ctx, completedAt: Date, verifiedAt: Date | null): Promise<void> {
  const { db, shopId, run } = ctx;
  if (run.kind === 'restore') {
    // The theme is back where it was before the restored run: put its record back too.
    const source = run.restoredFromId ? await getSyncRun(db, shopId, run.restoredFromId) : undefined;
    const previous = (source?.options as RunOptions | null)?.previousState;
    if (source?.status === 'succeeded' && previous !== undefined) {
      await upsertThemeState(db, shopId, run.themeId, {
        lastSyncedSha: previous?.lastSyncedSha ?? null,
        lastSyncedMessage: previous?.lastSyncedMessage ?? null,
        lastSyncedAt: previous?.lastSyncedAt ? new Date(previous.lastSyncedAt) : null,
        lastSyncId: previous?.lastSyncId ?? null,
        verifiedOnStagingAt: previous?.verifiedOnStagingAt ? new Date(previous.verifiedOnStagingAt) : null,
      });
    }
    return;
  }
  const before = await getThemeState(db, shopId, run.themeId);
  const options = (run.options ?? {}) as RunOptions;
  await transitionSyncRun(db, shopId, run.id, ['running'], 'running', {
    options: {
      ...options,
      previousState: before
        ? {
            lastSyncedSha: before.lastSyncedSha,
            lastSyncedMessage: before.lastSyncedMessage,
            lastSyncedAt: before.lastSyncedAt?.getTime() ?? null,
            lastSyncId: before.lastSyncId,
            verifiedOnStagingAt: before.verifiedOnStagingAt?.getTime() ?? null,
          }
        : null,
    },
  });
  await upsertThemeState(db, shopId, run.themeId, {
    lastSyncedSha: run.commitSha,
    lastSyncedMessage: run.commitMessage,
    lastSyncedAt: completedAt,
    lastSyncId: run.id,
    verifiedOnStagingAt: verifiedAt,
  });
}

/** Recomputes counters and, when nothing is pending, finishes the run. */
export async function finalizeIfComplete(ctx: Ctx): Promise<SyncStatus | null> {
  const { db, shopId, run } = ctx;
  const counts = await countOperations(db, shopId, run.id);
  const progress = { filesSucceeded: counts.succeeded, filesFailed: counts.failed, filesSkipped: counts.skipped };
  if (counts.pending > 0) {
    await transitionSyncRun(db, shopId, run.id, ['running'], 'running', progress);
    return null;
  }

  const marker = await getMarkerOperation(db, shopId, run.id);
  if (counts.failed === 0) {
    const completedAt = new Date();
    const verifiedAt = run.line === 'staging' ? completedAt : run.verifiedOnStagingAt;
    if (marker && marker.status === 'pending') {
      // Written last, only after every other file succeeded.
      try {
        const result = await upsertThemeFiles(ctx.admin, run.themeId, [
          { filename: THEME_SYNC_MARKER_PATH, body: { type: 'TEXT', value: markerContent(run, completedAt, verifiedAt) } },
        ]);
        if (result.failed.length > 0) throw new ApiError(502, 'SHOPIFY_ERROR', result.failed[0]!.message);
        await updateOperations(db, shopId, [marker.id], { status: 'succeeded', error: null, incrementAttempts: true });
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'THEME_WRITE_NOT_PERMITTED' || err.code === 'SHOPIFY_REAUTH_REQUIRED')) throw err;
        await failOrRetry(ctx, [marker], err);
        const latest = await getMarkerOperation(db, shopId, run.id);
        if (latest?.status !== 'failed') return null;
      }
    }
    const markerFailed = (await getMarkerOperation(db, shopId, run.id))?.status === 'failed';
    if (!markerFailed) await recordLastSynced(ctx, completedAt, verifiedAt);
    const status: SyncStatus = markerFailed ? 'partially_failed' : 'succeeded';
    await transitionSyncRun(db, shopId, run.id, ['running', 'queued'], status, {
      ...progress,
      completedAt,
      errorDetails: markerFailed
        ? { code: 'MARKER_FAILED', message: 'Every file was updated, but the update record (assets/theme-sync.json) could not be written' }
        : null,
    });
    return status;
  }

  if (marker && marker.status === 'pending') {
    await updateOperations(db, shopId, [marker.id], { status: 'skipped', skipReason: 'Not written because some files failed' });
  }
  const status: SyncStatus = counts.succeeded > 0 ? 'partially_failed' : 'failed';
  await transitionSyncRun(db, shopId, run.id, ['running', 'queued'], status, {
    ...progress,
    completedAt: new Date(),
    errorDetails: { code: 'FILES_FAILED', message: `${counts.succeeded} of ${counts.succeeded + counts.failed} files updated` },
  });
  return status;
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
 * Processes one run until it is finished or the deadline passes. Safe to call
 * concurrently or repeatedly for the same run.
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

  const started = await transitionSyncRun(db, shopId, syncId, ['queued', 'running'], 'running', {
    startedAt: run.startedAt ?? new Date(),
  });
  if (!started) return { done: true };

  let admin: ShopifyGraphqlClient;
  try {
    admin = await createAdminClientForShop(env, db, shop, logger, { fetchImpl: options.fetchImpl });
    // The theme must still exist and be writable; Staging must not have become the published theme.
    const theme = await getTheme(admin, run.themeId);
    if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The theme no longer exists in this store');
    if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `The theme is ${theme.role} and cannot be changed`);
    if (theme.isLive && run.line !== 'live') {
      throw new ApiError(409, 'THEME_NOT_WRITABLE', 'The Staging theme was published after this update was confirmed');
    }
  } catch (err) {
    if (isTransient(err)) return { done: false, retryAfterSeconds: err instanceof ApiError ? (err.retryAfter ?? 30) : 30 };
    await failRun(db, shopId, syncId, err instanceof ApiError ? err.code : 'INTERNAL_ERROR', errorMessage(err));
    logger.error('update.setup_failed', { error: errorMessage(err) });
    return { done: true };
  }

  let githubPromise: Promise<GitHubClient> | null = null;
  const ctx: Ctx = {
    db,
    shopId,
    run: started,
    admin,
    kv: env.KV,
    logger,
    fetchImpl: options.fetchImpl,
    backoff: 0,
    github: () =>
      (githubPromise ??= createGithubClientForShop(env, db, shop, logger, { fetchImpl: options.fetchImpl }).then((g) => g.client)),
  };

  try {
    // Phase 1: save every affected file before any file changes.
    while (Date.now() < options.deadline) {
      const ops = await listOperationsNeedingBackup(db, shopId, syncId, THEME_WRITE_BATCH_LIMIT);
      if (ops.length === 0) break;
      await backupBatch(ctx, ops);
    }
    if ((await listOperationsNeedingBackup(db, shopId, syncId, 1)).length > 0) return { done: false };

    // Phase 2: apply.
    while (Date.now() < options.deadline && ctx.backoff === 0) {
      const pending = await listPendingOperations(db, shopId, syncId, THEME_WRITE_BATCH_LIMIT);
      if (pending.length === 0) break;
      const upserts = pending.filter((op) => op.action === 'upsert');
      const deletes = pending.filter((op) => op.action === 'delete');
      if (upserts.length > 0) await processUpserts(ctx, upserts);
      if (deletes.length > 0) await processDeletes(ctx, deletes);
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'GITHUB_RATE_LIMITED') {
      logger.warn('update.github_rate_limited', { retryAfter: err.retryAfter });
      return { done: false, retryAfterSeconds: err.retryAfter ?? 60 };
    }
    if (isTransient(err)) return { done: false, retryAfterSeconds: err instanceof ApiError ? (err.retryAfter ?? 30) : 30 };
    // Permission / auth problems apply to every remaining file: stop the run.
    await failRun(db, shopId, syncId, err instanceof ApiError ? err.code : 'INTERNAL_ERROR', errorMessage(err));
    logger.error('update.run_failed', { error: errorMessage(err) });
    return { done: true };
  }

  try {
    const status = await finalizeIfComplete(ctx);
    if (status) {
      logger.info('update.completed', { status, kind: run.kind, line: run.line });
      return { done: true };
    }
  } catch (err) {
    await failRun(db, shopId, syncId, err instanceof ApiError ? err.code : 'INTERNAL_ERROR', errorMessage(err));
    return { done: true };
  }
  return { done: false, retryAfterSeconds: ctx.backoff || undefined };
}
