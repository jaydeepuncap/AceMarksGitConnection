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

const FOLDER_KIND: Record<string, string> = {
  sections: 'section',
  snippets: 'snippet',
  blocks: 'block',
  templates: 'template',
  layout: 'layout',
  config: 'settings',
  locales: 'translations',
};

/** "sections/cart.liquid" → "Cart section", "snippets/cart-item.liquid" → "Cart item snippet". */
export function themeFileLabel(path: string): string {
  const [folder = '', ...rest] = path.split('/');
  const file = rest.at(-1) ?? path;
  const kind = FOLDER_KIND[folder];
  if (!kind) return file;
  const words = [...rest.slice(0, -1), file.replace(/\.(liquid|json)$/, '')]
    .join(' ')
    .replace(/[-_.]+/g, ' ')
    .trim();
  const label = `${words} ${kind}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The sync type a strategy stands for, in the words of the UI. */
export function syncTypeLabel(strategy: string): string {
  switch (strategy) {
    case 'full_snapshot':
      return 'Full sync';
    case 'commit_changes':
      return 'Single commit';
    case 'selected_commits':
      return 'Multiple commits';
    case 'since_last_sync':
      return 'Multiple commits (since last sync)';
    default:
      return strategy;
  }
}

/** Overall result of a finished sync, never "successful" unless every file succeeded. */
export const RESULT_BADGE: Partial<Record<SyncStatus, { label: string; tone: Tone }>> = {
  succeeded: { label: 'Successful', tone: 'success' },
  partially_failed: { label: 'Partially successful', tone: 'warning' },
  failed: { label: 'Failed', tone: 'critical' },
};
