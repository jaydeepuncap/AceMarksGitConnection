import type { FileChange, ThemeLine, UpdateKind, UpdateRun, UpdateStatus } from './types';

/** Tones supported by <s-badge>/<s-banner>/<s-text>. */
export type Tone = 'auto' | 'neutral' | 'info' | 'success' | 'caution' | 'warning' | 'critical';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function firstLine(message: string | null | undefined): string {
  return (message ?? '').split('\n')[0] ?? '';
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export const LINE_LABEL: Record<ThemeLine, string> = { staging: 'Staging', live: 'Live' };

export const KIND_LABEL: Record<UpdateKind, string> = {
  update: 'Update',
  publish: 'Publish to Live',
  rollback: 'Go back',
  restore: 'Restore backup',
  baseline: 'Recorded current update',
};

export const STATUS_BADGE: Record<UpdateStatus, { label: string; tone: Tone }> = {
  previewed: { label: 'Waiting for review', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Updating', tone: 'info' },
  succeeded: { label: 'Complete', tone: 'success' },
  partially_failed: { label: 'Incomplete', tone: 'warning' },
  failed: { label: 'Failed', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** +, ~, − markers used throughout the guide. */
export const CHANGE_MARK: Record<FileChange, { mark: string; tone: Tone; label: string }> = {
  added: { mark: '+', tone: 'success', label: 'new' },
  modified: { mark: '~', tone: 'caution', label: 'updated' },
  removed: { mark: '−', tone: 'critical', label: 'removed' },
};

export function runTitle(run: UpdateRun): string {
  const target = run.target ? `${run.target.shortSha} ${firstLine(run.target.message)}` : 'its earlier state';
  switch (run.kind) {
    case 'publish':
      return `Publish ${target} to ${run.theme.name}`;
    case 'rollback':
      return `Go back to ${target}`;
    case 'restore':
      return `Restore ${run.theme.name} from backup`;
    case 'baseline':
      return `Recorded ${target}`;
    default:
      return `Update ${LINE_LABEL[run.line]} to ${target}`;
  }
}
