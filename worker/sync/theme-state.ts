/**
 * Where a theme stands: the commit it was last fully synced to, per branch.
 *
 * The database row (theme_branch_sync) is the fast path. When a theme has no
 * row — a duplicated theme, or a theme synced before rows were kept — the
 * state is recovered and saved, in this order:
 *   1. the latest fully succeeded sync run of the theme on the branch;
 *   2. the theme's own assets/theme-sync.json, written last by every
 *      successful sync and copied along when Shopify duplicates a theme. It
 *      holds the last synced commit of every branch ("branches").
 */
import type { ThemeBranchSyncRow } from '../../drizzle/schema';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import { cached } from '../lib/cache';
import { base64ToBytes } from '../lib/crypto';
import { getLastSynced, latestSucceededRun, saveLastSynced, type Database } from '../lib/database';
import type { Logger } from '../lib/logger';
import { getThemeFileBodies, type ShopifyGraphqlClient } from '../lib/shopify-graphql';

/** One branch's last synced commit, as stored in assets/theme-sync.json. */
export interface MarkerBranchEntry {
  branch: string;
  lastSyncedUpdate: string;
  description: string;
  syncedOn: string | null;
  syncId: string | null;
}

export interface ThemeSyncMarker {
  /** The most recent sync (any branch). */
  lastSyncedUpdate: string;
  description: string;
  repository: string | null;
  branch: string | null;
  syncedOn: string | null;
  syncId: string | null;
  /** The last synced commit of every branch, most recent first. */
  branches: MarkerBranchEntry[];
}

export interface ThemeStateDeps {
  db: Database;
  admin: ShopifyGraphqlClient;
  kv: KVNamespace;
  logger: Logger;
}

const SHA_RE = /^[0-9a-f]{40}$/;
/** Themes without a marker are re-checked after this long (a new duplicate has a new ID anyway). */
const MARKER_CACHE_TTL = 600;

const markerCacheKey = (shopId: string, themeId: string) => `cache:${shopId}:theme-marker:${themeId}`;

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const sha40 = (v: unknown) => {
  const sha = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return SHA_RE.test(sha) ? sha : null;
};
const isoDate = (v: unknown) => {
  const d = str(v);
  return d && !Number.isNaN(Date.parse(d)) ? d : null;
};
const newestFirst = (a: { syncedOn: string | null }, b: { syncedOn: string | null }) =>
  Date.parse(b.syncedOn ?? '1970-01-01') - Date.parse(a.syncedOn ?? '1970-01-01');

/** Parses assets/theme-sync.json; null when it is not a valid Theme Sync marker. */
export function parseThemeSyncMarker(text: string): ThemeSyncMarker | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const sha = sha40(value.lastSyncedUpdate);
  if (!sha) return null;
  const marker: ThemeSyncMarker = {
    lastSyncedUpdate: sha,
    description: str(value.description) ?? '',
    repository: str(value.repository),
    branch: str(value.branch),
    syncedOn: isoDate(value.syncedOn),
    syncId: str(value.syncId),
    branches: [],
  };
  const byBranch = new Map<string, MarkerBranchEntry>();
  if (value.branches && typeof value.branches === 'object' && !Array.isArray(value.branches)) {
    for (const [branch, entry] of Object.entries(value.branches as Record<string, unknown>)) {
      if (!branch.trim() || !entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const entrySha = sha40(e.lastSyncedUpdate);
      if (!entrySha) continue;
      byBranch.set(branch, {
        branch,
        lastSyncedUpdate: entrySha,
        description: str(e.description) ?? '',
        syncedOn: isoDate(e.syncedOn),
        syncId: str(e.syncId),
      });
    }
  }
  // Files written before per-branch entries existed only have the top-level sync.
  if (marker.branch && !byBranch.has(marker.branch)) {
    byBranch.set(marker.branch, {
      branch: marker.branch,
      lastSyncedUpdate: sha,
      description: marker.description,
      syncedOn: marker.syncedOn,
      syncId: marker.syncId,
    });
  }
  marker.branches = [...byBranch.values()].sort(newestFirst);
  return marker;
}

/**
 * The content of assets/theme-sync.json after a successful sync: the sync
 * itself at the top, plus the last synced commit of every branch — from the
 * file already in the theme (same repository), the app's records for the
 * theme, and this sync (which always wins for its branch).
 */
export function buildThemeSyncMarker(input: {
  previous: ThemeSyncMarker | null;
  rows: ThemeBranchSyncRow[];
  sync: {
    commitSha: string;
    message: string | null;
    repository: string;
    branch: string | null;
    themeName: string;
    syncedOn: string;
    syncId: string;
  };
}): Record<string, unknown> {
  const { previous, rows, sync } = input;
  const byBranch = new Map<string, MarkerBranchEntry>();
  const keepNewer = (entry: MarkerBranchEntry) => {
    const current = byBranch.get(entry.branch);
    if (!current || newestFirst(entry, current) < 0) byBranch.set(entry.branch, entry);
  };
  if (previous && sameRepository(previous.repository, sync.repository)) previous.branches.forEach(keepNewer);
  for (const row of rows) {
    keepNewer({
      branch: row.branch,
      lastSyncedUpdate: row.commitSha,
      description: firstLine(row.commitMessage),
      syncedOn: row.syncedAt.toISOString(),
      syncId: row.syncId,
    });
  }
  if (sync.branch) {
    byBranch.set(sync.branch, {
      branch: sync.branch,
      lastSyncedUpdate: sync.commitSha,
      description: firstLine(sync.message),
      syncedOn: sync.syncedOn,
      syncId: sync.syncId,
    });
  }
  const branches: Record<string, unknown> = {};
  for (const entry of [...byBranch.values()].sort(newestFirst)) {
    branches[entry.branch] = {
      lastSyncedUpdate: entry.lastSyncedUpdate,
      shortSha: entry.lastSyncedUpdate.slice(0, 7),
      description: entry.description,
      syncedOn: entry.syncedOn,
      syncId: entry.syncId,
    };
  }
  return {
    app: 'Theme Sync',
    lastSyncedUpdate: sync.commitSha,
    shortSha: sync.commitSha.slice(0, 7),
    description: firstLine(sync.message),
    repository: sync.repository,
    branch: sync.branch,
    theme: sync.themeName,
    syncedOn: sync.syncedOn,
    syncId: sync.syncId,
    branches,
  };
}

const firstLine = (message: string | null) => (message ?? '').split('\n')[0] ?? '';

/** Reads the marker straight from the theme (no cache). */
export async function fetchThemeSyncMarker(admin: ShopifyGraphqlClient, themeId: string): Promise<ThemeSyncMarker | null> {
  const bodies = await getThemeFileBodies(admin, themeId, [THEME_SYNC_MARKER_PATH]);
  const body = bodies.get(THEME_SYNC_MARKER_PATH);
  if (!body) return null;
  const text = body.type === 'TEXT' ? body.value : new TextDecoder().decode(base64ToBytes(body.value));
  return parseThemeSyncMarker(text);
}

/** Reads the theme's marker file (cached briefly, including "no marker"). */
export async function readThemeSyncMarker(
  deps: ThemeStateDeps,
  shopId: string,
  themeId: string,
): Promise<ThemeSyncMarker | null> {
  const { marker } = await cached(
    deps.kv,
    markerCacheKey(shopId, themeId),
    MARKER_CACHE_TTL,
    async () => {
      try {
        return { marker: await fetchThemeSyncMarker(deps.admin, themeId) };
      } catch (err) {
        deps.logger.warn('theme_state.marker_read_failed', { themeId, error: err });
        return { marker: null };
      }
    },
    deps.logger,
  );
  return marker;
}

const sameRepository = (a: string | null, b: string | null) => !a || !b || a.toLowerCase() === b.toLowerCase();

/** Saves every branch of the theme's marker that has no record yet; returns the branches it covers. */
async function importMarker(
  deps: ThemeStateDeps,
  shopId: string,
  themeId: string,
  repository: string | null,
): Promise<string[]> {
  const marker = await readThemeSyncMarker(deps, shopId, themeId);
  if (!marker || !sameRepository(marker.repository, repository)) return [];
  for (const entry of marker.branches) {
    // A record the app saved itself is never replaced by the (possibly older) file.
    if (await getLastSynced(deps.db, shopId, themeId, entry.branch)) continue;
    await saveLastSynced(deps.db, shopId, {
      themeId,
      branch: entry.branch,
      commitSha: entry.lastSyncedUpdate,
      commitMessage: entry.description || null,
      syncId: null,
      syncedAt: entry.syncedOn ? new Date(entry.syncedOn) : new Date(),
    });
    deps.logger.info('theme_state.marker_imported', { themeId, branch: entry.branch, commitSha: entry.lastSyncedUpdate });
  }
  return marker.branches.map((e) => e.branch);
}

/**
 * The commit `themeId` was last synced to from `branch`, recovering it from the
 * sync history or the theme's marker file when no row exists yet.
 */
export async function resolveLastSynced(
  deps: ThemeStateDeps,
  input: { shopId: string; themeId: string; branch: string; repository: string | null },
): Promise<ThemeBranchSyncRow | undefined> {
  const { db } = deps;
  const row = await getLastSynced(db, input.shopId, input.themeId, input.branch);
  if (row) return row;

  const run = await latestSucceededRun(db, input.shopId, input.themeId, input.branch, input.repository);
  if (run) {
    await saveLastSynced(db, input.shopId, {
      themeId: input.themeId,
      branch: input.branch,
      commitSha: run.commitSha,
      commitMessage: run.commitMessage,
      syncId: run.id,
      syncedAt: run.completedAt ?? run.initiatedAt,
    });
    return getLastSynced(db, input.shopId, input.themeId, input.branch);
  }

  const imported = await importMarker(deps, input.shopId, input.themeId, input.repository);
  return imported.includes(input.branch) ? getLastSynced(db, input.shopId, input.themeId, input.branch) : undefined;
}

/**
 * For a theme with no row on any branch: recovers its state from the sync
 * history or its marker file (any branch). Returns true when something was saved.
 */
export async function recoverThemeState(
  deps: ThemeStateDeps,
  input: { shopId: string; themeId: string; repository: string | null },
): Promise<boolean> {
  const run = await latestSucceededRun(deps.db, input.shopId, input.themeId, null, input.repository);
  if (run?.branch) {
    await saveLastSynced(deps.db, input.shopId, {
      themeId: input.themeId,
      branch: run.branch,
      commitSha: run.commitSha,
      commitMessage: run.commitMessage,
      syncId: run.id,
      syncedAt: run.completedAt ?? run.initiatedAt,
    });
    return true;
  }
  return (await importMarker(deps, input.shopId, input.themeId, input.repository)).length > 0;
}
