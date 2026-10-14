import type { CommitFileStatus, SyncStatus, ThemeRole } from './types';

/** Tones supported by <s-badge>/<s-banner>. */
export type Tone = 'auto' | 'neutral' | 'info' | 'success' | 'caution' | 'warning' | 'critical';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function firstLine(message: string | null | undefined): string {
  return (message ?? '').split('\n')[0] ?? '';
}

export const SYNC_STATUS_BADGE: Record<SyncStatus, { label: string; tone: Tone }> = {
  previewed: { label: 'Previewed', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Running', tone: 'caution' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  partially_failed: { label: 'Partially failed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export const FILE_STATUS_BADGE: Record<CommitFileStatus, { label: string; tone: Tone }> = {
  added: { label: 'Added', tone: 'success' },
  modified: { label: 'Modified', tone: 'caution' },
  changed: { label: 'Changed', tone: 'caution' },
  renamed: { label: 'Renamed', tone: 'info' },
  copied: { label: 'Copied', tone: 'info' },
  removed: { label: 'Deleted', tone: 'critical' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
};

export const THEME_ROLE_BADGE: Record<ThemeRole, { label: string; tone: Tone }> = {
  MAIN: { label: 'Live', tone: 'success' },
  UNPUBLISHED: { label: 'Unpublished', tone: 'neutral' },
  DEVELOPMENT: { label: 'Development', tone: 'info' },
  DEMO: { label: 'Trial', tone: 'caution' },
  LOCKED: { label: 'Locked', tone: 'warning' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};
