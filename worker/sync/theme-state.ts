/**
 * Where a theme stands: the commit it was last fully synced to, per branch.
 *
 * The database row (theme_branch_sync) is the fast path. When a theme has no
 * row — a duplicated theme, or a theme synced before rows were kept — the
 * state is recovered and saved, in this order:
 *   1. the latest fully succeeded sync run of the theme on the branch;
 *   2. the theme's own assets/theme-sync.json, written last by every
 *      successful sync and copied along when Shopify duplicates a theme.
 */
import type { ThemeBranchSyncRow } from '../../drizzle/schema';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import { cached } from '../lib/cache';
import { base64ToBytes } from '../lib/crypto';
import { getLastSynced, latestSucceededRun, saveLastSynced, type Database } from '../lib/database';
import type { Logger } from '../lib/logger';
import { getThemeFileBodies, type ShopifyGraphqlClient } from '../lib/shopify-graphql';

export interface ThemeSyncMarker {
  lastSyncedUpdate: string;
  description: string;
  repository: string | null;
  branch: string | null;
  syncedOn: string | null;
  syncId: string | null;
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
  const sha = typeof value.lastSyncedUpdate === 'string' ? value.lastSyncedUpdate.trim().toLowerCase() : '';
  if (!SHA_RE.test(sha)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const syncedOn = str(value.syncedOn);
  return {
    lastSyncedUpdate: sha,
    description: str(value.description) ?? '',
    repository: str(value.repository),
    branch: str(value.branch),
    syncedOn: syncedOn && !Number.isNaN(Date.parse(syncedOn)) ? syncedOn : null,
    syncId: str(value.syncId),
  };
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
        const bodies = await getThemeFileBodies(deps.admin, themeId, [THEME_SYNC_MARKER_PATH]);
        const body = bodies.get(THEME_SYNC_MARKER_PATH);
        if (!body) return { marker: null };
        const text = body.type === 'TEXT' ? body.value : new TextDecoder().decode(base64ToBytes(body.value));
        return { marker: parseThemeSyncMarker(text) };
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

async function importMarker(
  deps: ThemeStateDeps,
  shopId: string,
  themeId: string,
  repository: string | null,
  fallbackBranch: string | null,
): Promise<string | null> {
  const marker = await readThemeSyncMarker(deps, shopId, themeId);
  if (!marker || !sameRepository(marker.repository, repository)) return null;
  const branch = marker.branch ?? fallbackBranch;
  if (!branch) return null;
  // A row the app saved itself is never replaced by the (possibly older) file.
  if (await getLastSynced(deps.db, shopId, themeId, branch)) return branch;
  await saveLastSynced(deps.db, shopId, {
    themeId,
    branch,
    commitSha: marker.lastSyncedUpdate,
    commitMessage: marker.description || null,
    syncId: null,
    syncedAt: marker.syncedOn ? new Date(marker.syncedOn) : new Date(),
  });
  deps.logger.info('theme_state.marker_imported', { themeId, branch, commitSha: marker.lastSyncedUpdate });
  return branch;
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

  const imported = await importMarker(deps, input.shopId, input.themeId, input.repository, input.branch);
  return imported === input.branch ? getLastSynced(db, input.shopId, input.themeId, input.branch) : undefined;
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
  return (await importMarker(deps, input.shopId, input.themeId, input.repository, null)) !== null;
}
