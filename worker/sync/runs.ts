/**
 * Run lifecycle shared by the store's own screens and the multi-store roll-out:
 * DTO mapping, confirmation (with every safety check re-done at that moment),
 * retry and cancel.
 */
import type { SyncHistoryRow, SyncOperationRow } from '../../drizzle/schema';
import type {
  IncludedCommit,
  UpdateChecks,
  UpdateFile,
  UpdatePhase,
  UpdateRun,
  UpdateTotals,
} from '../../shared/api-types';
import type { Env, SyncJobMessage } from '../env';
import {
  countOperations,
  getThemeState,
  isActiveRunConflict,
  latestRunForTheme,
  resetFailedOperations,
  transitionSyncRun,
  type Database,
  type OperationCounts,
} from '../lib/database';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import { getTheme } from '../lib/shopify-graphql';
import { dispatchSync } from './dispatch';
import { BACKUP_TTL_SECONDS, verifiedOnStaging, type RunOptions } from './plan';
import type { ShopRuntime } from './runtime';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const EMPTY_TOTALS: UpdateTotals = { added: 0, updated: 0, removed: 0, protectedUntouched: 0, skipped: 0 };

export interface RunExtras {
  /** This run is the most recent confirmed run on its theme. */
  isLatestForTheme?: boolean;
  /** Staging's current last synced update (for "Publish to Live"). */
  stagingCurrentSha?: string | null;
}

function phaseOf(row: SyncHistoryRow, counts: OperationCounts): UpdatePhase {
  if (row.status === 'previewed') return 'review';
  if (row.status === 'queued' || row.status === 'running') {
    return counts.backedUp < counts.backupTotal ? 'backup' : 'applying';
  }
  return 'done';
}

export function toUpdateRun(row: SyncHistoryRow, counts: OperationCounts, shopDomain: string, extras: RunExtras = {}): UpdateRun {
  const options = (row.options ?? {}) as Partial<RunOptions>;
  const checks = (row.checks ?? null) as UpdateChecks | null;
  const details = row.errorDetails as { code?: string; message?: string } | null;
  const finished = ['succeeded', 'partially_failed', 'failed'].includes(row.status);
  const expired = row.status === 'previewed' && (!row.previewExpiresAt || row.previewExpiresAt.getTime() < Date.now());
  const codeBlocked = checks?.code.status === 'failed';
  const withinBackupWindow = !row.completedAt || Date.now() - row.completedAt.getTime() < BACKUP_TTL_SECONDS * 1000;

  return {
    id: row.id,
    kind: row.kind,
    line: row.line,
    status: expired ? 'expired' : row.status,
    phase: phaseOf(row, counts),
    shopDomain,
    theme: { id: row.themeId, name: row.themeName, role: row.themeRole },
    repository: row.repository,
    branch: row.branch,
    base: row.baseSha ? { sha: row.baseSha, shortSha: row.baseSha.slice(0, 7), message: row.baseMessage } : null,
    target: row.commitSha ? { sha: row.commitSha, shortSha: row.commitSha.slice(0, 7), message: row.commitMessage } : null,
    direction: options.direction ?? 'forward',
    commits: (row.commitsIncluded ?? []) as IncludedCommit[],
    checks,
    totals: options.totals ?? EMPTY_TOTALS,
    progress: {
      total: counts.pending + counts.succeeded + counts.failed,
      succeeded: counts.succeeded,
      failed: counts.failed,
      pending: counts.pending,
      backedUp: counts.backedUp,
    },
    warnings: options.warnings ?? [],
    errorDetails: details?.message ? { code: details.code ?? 'ERROR', message: details.message } : null,
    attempt: row.attempt,
    verifiedOnStagingAt: iso(row.verifiedOnStagingAt),
    restoredFromId: row.restoredFromId,
    rolloutId: row.rolloutId,
    previewExpiresAt: iso(row.previewExpiresAt),
    initiatedAt: iso(row.initiatedAt) ?? new Date(0).toISOString(),
    confirmedAt: iso(row.confirmedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    actions: {
      canConfirm: row.status === 'previewed' && !expired && !codeBlocked,
      needsDirectEditApproval: checks?.directEdits.status === 'warning',
      blockedByCodeErrors: codeBlocked,
      canCancel: row.status === 'previewed' && !expired,
      canRetry: (row.status === 'failed' || row.status === 'partially_failed') && row.kind !== 'baseline',
      canRerun:
        (row.status === 'failed' || row.status === 'partially_failed') && ['update', 'publish', 'rollback'].includes(row.kind),
      canRestore:
        finished &&
        row.kind !== 'baseline' &&
        counts.succeeded > 0 &&
        withinBackupWindow &&
        extras.isLatestForTheme === true,
      // Fully completed on an unpublished theme → can be published to Live.
      canPublish: row.status === 'succeeded' && row.line !== 'live' && (row.kind === 'update' || row.kind === 'rollback'),
    },
  };
}

export function toUpdateFile(op: SyncOperationRow): UpdateFile {
  return {
    id: op.id,
    path: op.path,
    action: op.action,
    change:
      op.status === 'skipped' ? 'skipped' : op.action === 'delete' ? 'removed' : op.existsInTheme ? 'modified' : 'added',
    status: op.status,
    introducedBy: op.introducedBy,
    skipReason: op.skipReason,
    error: op.error,
    errorKind: op.errorKind,
    backup: op.backupState,
    attempts: op.attempts,
  };
}

/** Loads the DTO for one run including the context-dependent actions. */
export async function describeRun(db: Database, row: SyncHistoryRow, shopDomain: string, stagingThemeId: string | null): Promise<UpdateRun> {
  const counts = await countOperations(db, row.shopId, row.id);
  const latest = row.confirmedAt ? await latestRunForTheme(db, row.shopId, row.themeId) : undefined;
  const staging = stagingThemeId ? await getThemeState(db, row.shopId, stagingThemeId) : undefined;
  return toUpdateRun(row, counts, shopDomain, {
    isLatestForTheme: latest?.id === row.id,
    stagingCurrentSha: staging?.lastSyncedSha ?? null,
  });
}

// ---------------------------------------------------------------------------
// Confirm / retry / cancel
// ---------------------------------------------------------------------------
/** Shopify user ID from the session token (kept for auditing; names are not tracked). */
export interface Actor {
  userId: string | null;
}

interface DispatchCtx {
  env: Env;
  executionCtx: Pick<ExecutionContext, 'waitUntil'>;
  logger: Logger;
}

/**
 * Starts a reviewed plan. Every rule is checked again now, because the theme,
 * Staging or another person's update may have changed since the review.
 */
export async function confirmRun(
  rt: ShopRuntime,
  dispatch: DispatchCtx,
  run: SyncHistoryRow,
  input: { acceptDirectEdits?: boolean },
  actor: Actor,
): Promise<SyncHistoryRow> {
  const { db, shop } = rt;
  if (run.status !== 'previewed') {
    throw new ApiError(409, 'CONFLICT', `This update was already ${run.status}`);
  }
  if (!run.previewExpiresAt || run.previewExpiresAt.getTime() < Date.now()) {
    await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'expired');
    throw new ApiError(410, 'PREVIEW_EXPIRED', 'This review expired. Start the update again to see the latest changes.');
  }
  const checks = run.checks as UpdateChecks | null;
  if (checks?.code.status === 'failed') {
    throw new ApiError(422, 'CODE_ERRORS', 'The code check found errors. Ask your developer to fix them and save a new update.', {
      details: { issues: checks.code.issues },
    });
  }
  if (checks?.directEdits.status === 'warning' && input.acceptDirectEdits !== true) {
    throw new ApiError(
      422,
      'DIRECT_EDITS_FOUND',
      'Some files were edited directly in Shopify since the last sync. Choose "Replace and continue" to replace them.',
      { details: { files: checks.directEdits.files } },
    );
  }

  const theme = await getTheme(await rt.admin(), run.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The theme no longer exists in this store');
  if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `A ${theme.role} theme cannot be changed`);
  if (theme.isLive && run.line !== 'live') {
    throw new ApiError(409, 'THEME_NOT_WRITABLE', 'This theme is now the published theme. Only Staging-verified updates can go there.');
  }
  if (run.kind === 'publish' && !(await verifiedOnStaging(rt, run.commitSha))) {
    throw new ApiError(422, 'NOT_VERIFIED_ON_STAGING', 'Only updates that fully completed on an unpublished theme can be published to Live.');
  }
  if (run.kind === 'restore') {
    const latest = await latestRunForTheme(db, shop.id, run.themeId);
    if (latest && latest.id !== run.restoredFromId) {
      await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'expired');
      throw new ApiError(409, 'PREVIEW_EXPIRED', 'Another update ran on this theme since this review. Start again.');
    }
  }
  // The plan was made against the theme's last synced update; if that moved, the plan is stale.
  const state = await getThemeState(db, shop.id, run.themeId);
  const planBase = run.kind === 'restore' ? null : (run.baseSha ?? null);
  if (run.kind !== 'restore' && (state?.lastSyncedSha ?? null) !== planBase) {
    await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'expired');
    throw new ApiError(409, 'PREVIEW_EXPIRED', 'The theme was updated since this review. Start again to review the latest changes.');
  }

  let queued: SyncHistoryRow | undefined;
  try {
    // Atomic previewed → queued. The database allows one active run per theme.
    queued = await transitionSyncRun(db, shop.id, run.id, ['previewed'], 'queued', {
      attempt: 1,
      confirmedAt: new Date(),
      initiatedBy: actor.userId ?? run.initiatedBy,
    });
  } catch (err) {
    if (isActiveRunConflict(err)) {
      throw new ApiError(409, 'UPDATE_IN_PROGRESS', 'Another update is running on this theme. Wait for it to finish.');
    }
    throw err;
  }
  if (!queued) throw new ApiError(409, 'CONFLICT', 'This update was confirmed by another request');

  const message: SyncJobMessage = { syncId: run.id, shopId: shop.id };
  const mode = await dispatchSync(dispatch.env, dispatch.executionCtx, message, dispatch.logger);
  dispatch.logger.info('update.confirmed', { syncId: run.id, kind: run.kind, line: run.line, mode });
  return queued;
}

/** "Retry failed files": only the failed files are tried again (with a fresh backup check). */
export async function retryRun(rt: ShopRuntime, dispatch: DispatchCtx, run: SyncHistoryRow): Promise<SyncHistoryRow> {
  if (run.status !== 'failed' && run.status !== 'partially_failed') {
    throw new ApiError(409, 'CONFLICT', `A ${run.status} update cannot be retried`);
  }
  const theme = await getTheme(await rt.admin(), run.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The theme no longer exists in this store');
  if (theme.isLive && run.line !== 'live') {
    throw new ApiError(409, 'THEME_NOT_WRITABLE', 'This theme is now the published theme; retrying here is not allowed.');
  }
  const reset = await resetFailedOperations(rt.db, rt.shop.id, run.id);
  let queued: SyncHistoryRow | undefined;
  try {
    queued = await transitionSyncRun(rt.db, rt.shop.id, run.id, ['failed', 'partially_failed'], 'queued', {
      attempt: run.attempt + 1,
      completedAt: null,
      errorDetails: null,
    });
  } catch (err) {
    if (isActiveRunConflict(err)) {
      throw new ApiError(409, 'UPDATE_IN_PROGRESS', 'Another update is running on this theme. Wait for it to finish.');
    }
    throw err;
  }
  if (!queued) throw new ApiError(409, 'CONFLICT', 'This update changed state; refresh and try again');
  await dispatchSync(dispatch.env, dispatch.executionCtx, { syncId: run.id, shopId: rt.shop.id }, dispatch.logger);
  dispatch.logger.info('update.retried', { syncId: run.id, files: reset, attempt: queued.attempt });
  return queued;
}

export async function cancelRun(db: Database, run: SyncHistoryRow): Promise<SyncHistoryRow> {
  const cancelled = await transitionSyncRun(db, run.shopId, run.id, ['previewed'], 'cancelled', { completedAt: new Date() });
  if (!cancelled) throw new ApiError(409, 'CONFLICT', `This update was already ${run.status}`);
  return cancelled;
}
