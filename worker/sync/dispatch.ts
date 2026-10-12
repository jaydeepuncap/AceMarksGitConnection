/**
 * Hands a confirmed sync to the background job mechanism.
 *
 * Primary: Cloudflare Queues (SYNC_QUEUE). The consumer in worker/index.ts runs
 * processSyncChunk with a generous deadline and re-enqueues itself while
 * operations remain, so arbitrarily large syncs proceed in bounded steps.
 *
 * Fallback (no queue binding, e.g. Workers Free plan): ctx.waitUntil() runs
 * chunks for up to ~25 s after the response. If work remains, the run is left
 * `running`; the next GET /api/sync/history/:id (the UI polls it) notices the
 * stale run and resumes it. State is in D1, so resuming is always safe.
 */
import type { Env, SyncJobMessage } from '../env';
import { transitionSyncRun, getDb } from '../lib/database';
import type { Logger } from '../lib/logger';
import { processSyncChunk } from './executor';

export const INLINE_BUDGET_MS = 25_000;
export const QUEUE_BUDGET_MS = 10 * 60 * 1000;
/** A queued/running run untouched for this long is considered stalled (fallback mode). */
export const STALE_RUN_MS = 45_000;

export async function dispatchSync(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  message: SyncJobMessage,
  logger: Logger,
  delaySeconds = 0,
): Promise<'queue' | 'inline'> {
  if (env.SYNC_QUEUE) {
    await env.SYNC_QUEUE.send(message, delaySeconds > 0 ? { delaySeconds } : undefined);
    logger.info('sync.enqueued', { syncId: message.syncId, delaySeconds });
    return 'queue';
  }
  ctx.waitUntil(runInline(env, message, logger));
  return 'inline';
}

export async function runInline(env: Env, message: SyncJobMessage, logger: Logger): Promise<void> {
  try {
    const result = await processSyncChunk(env, message, logger, { deadline: Date.now() + INLINE_BUDGET_MS });
    if (!result.done) logger.info('sync.inline_paused', { syncId: message.syncId });
  } catch (err) {
    logger.error('sync.inline_failed', { syncId: message.syncId, error: err });
    await transitionSyncRun(getDb(env.DB), message.shopId, message.syncId, ['queued', 'running'], 'failed', {
      completedAt: new Date(),
      errorDetails: { code: 'INTERNAL_ERROR', message: 'Background processing failed; use Retry to resume' },
    });
  }
}

/** Queue consumer body for one message. Returns the delay for a follow-up message, or null when finished. */
export async function handleSyncMessage(env: Env, message: SyncJobMessage, logger: Logger): Promise<number | null> {
  const result = await processSyncChunk(env, message, logger, { deadline: Date.now() + QUEUE_BUDGET_MS });
  return result.done ? null : (result.retryAfterSeconds ?? 0);
}
