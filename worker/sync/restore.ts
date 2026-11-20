/**
 * "Restore backup" / "Undo this sync": puts the theme back exactly as it was
 * before an update (incomplete or completed). Every file the update touched was
 * saved to KV right before it changed (see backupFiles in the executor):
 *   - files that existed are written back with their previous content;
 *   - files the update created (backed up as "absent") are removed again.
 * Files that were never touched have no backup and are left alone.
 */
import type { SyncHistoryRow } from '../../drizzle/schema';
import { listSyncOperations, type Database } from '../lib/database';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import {
  THEME_WRITE_BATCH_LIMIT,
  deleteThemeFiles,
  upsertThemeFiles,
  waitForJob,
  type ShopifyGraphqlClient,
  type ThemeFileBody,
} from '../lib/shopify-graphql';
import { backupKey } from './executor';

const MAX_RESTORE_PAYLOAD_BYTES = 4 * 1024 * 1024;

export interface RestoreResult {
  restored: number;
  removed: number;
  failed: { path: string; message: string }[];
  /** Index of the next file to restore (another step is needed), or null when every file was handled. */
  next: number | null;
  /** Files of the sync, restored or not (the step works through them in order). */
  total: number;
}

type Backup = { path: string; absent?: true; type?: ThemeFileBody['type']; value?: string };

/**
 * One step of a restore: the files from `start`, at most `maxFiles` of them (Cloudflare limits the
 * requests of one invocation; each file needs a backup read). Call again from `next` until it is null.
 */
export async function restoreBackup(
  deps: { db: Database; admin: ShopifyGraphqlClient; kv: KVNamespace; logger: Logger },
  run: SyncHistoryRow,
  step: { start: number; maxFiles: number } = { start: 0, maxFiles: Number.MAX_SAFE_INTEGER },
): Promise<RestoreResult> {
  const { db, admin, kv, logger } = deps;
  const ops = await listSyncOperations(db, run.shopId, run.id);
  const end = Math.min(ops.length, step.start + step.maxFiles);
  const writes: { filename: string; body: ThemeFileBody }[] = [];
  const removals: string[] = [];
  for (const op of ops.slice(step.start, end)) {
    const raw = await kv.get(backupKey(run.shopId, run.id, op.path));
    if (raw === null) continue;
    const backup = JSON.parse(raw) as Backup;
    if (backup.absent) removals.push(op.path);
    else if (backup.type && typeof backup.value === 'string') {
      writes.push({ filename: op.path, body: { type: backup.type, value: backup.value } });
    }
  }
  if (step.start === 0 && end >= ops.length && writes.length === 0 && removals.length === 0) {
    throw new ApiError(409, 'CONFLICT', 'There is no backup for this update (backups are kept for 30 days)');
  }

  const result: RestoreResult = {
    restored: 0,
    removed: 0,
    failed: [],
    next: end < ops.length ? end : null,
    total: ops.length,
  };

  // Upserts, bounded by file count and request size.
  let batch: typeof writes = [];
  let size = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    size = 0;
    try {
      const res = await upsertThemeFiles(admin, run.themeId, current);
      if (res.jobId && !res.jobDone && !(await waitForJob(admin, res.jobId))) {
        for (const f of current) result.failed.push({ path: f.filename, message: 'Shopify did not finish in time' });
        return;
      }
      result.restored += res.succeeded.length;
      for (const f of res.failed) result.failed.push({ path: f.filename, message: f.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const f of current) result.failed.push({ path: f.filename, message });
    }
  };
  for (const file of writes) {
    if (batch.length >= THEME_WRITE_BATCH_LIMIT || (batch.length > 0 && size + file.body.value.length > MAX_RESTORE_PAYLOAD_BYTES)) {
      await flush();
    }
    batch.push(file);
    size += file.body.value.length;
  }
  await flush();

  // Files this update created.
  for (let i = 0; i < removals.length; i += THEME_WRITE_BATCH_LIMIT) {
    const chunk = removals.slice(i, i + THEME_WRITE_BATCH_LIMIT);
    try {
      const res = await deleteThemeFiles(admin, run.themeId, chunk);
      result.removed += res.succeeded.length;
      for (const f of res.failed) result.failed.push({ path: f.filename, message: f.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const path of chunk) result.failed.push({ path, message });
    }
  }

  logger.info('sync.backup_restored', {
    syncId: run.id,
    restored: result.restored,
    removed: result.removed,
    failed: result.failed.length,
  });
  return result;
}
