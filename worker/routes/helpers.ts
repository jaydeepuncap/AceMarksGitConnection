import type { Context } from 'hono';
import type { Shop } from '../../drizzle/schema';
import type { ShopInfo, ShopifyTheme } from '../../shared/api-types';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import type { AppEnv } from '../env';
import { cached, cacheKeys } from '../lib/cache';
import { getDb, getThemeState, updateShopName, upsertThemeState } from '../lib/database';
import { parseScopes, scopeGrants } from '../lib/sessions';
import { getShopDetails, getThemeFileBodies, listThemes, upsertThemeFiles } from '../lib/shopify-graphql';
import { fallbackStoreName } from '../lib/store-group';
import { buildMarker } from '../sync/executor';
import { loadShopRuntime, type ShopRuntime } from '../sync/runtime';
import type { Actor } from '../sync/runs';

export function toShopInfo(shop: Shop): ShopInfo {
  const scopes = parseScopes(shop.scopes);
  return {
    shopDomain: shop.shopDomain,
    name: shop.shopName,
    status: shop.status,
    scopes,
    canReadThemes: scopeGrants(scopes, 'read_themes'),
    canWriteThemes: scopeGrants(scopes, 'write_themes'),
  };
}

/** Runtime for the store the request is authenticated for. */
export function requestRuntime(c: Context<AppEnv>): Promise<ShopRuntime> {
  const { shop, sessionToken } = c.get('auth');
  return loadShopRuntime(c.env, getDb(c.env.DB), shop, c.get('logger'), { sessionToken });
}

export function dispatchCtx(c: Context<AppEnv>) {
  return { env: c.env, executionCtx: c.executionCtx, logger: c.get('logger') };
}

export function requestActor(c: Context<AppEnv>): Actor {
  return { userId: c.get('auth').userId };
}

/** Theme list of a store (60 s KV cache). */
export async function themesFor(rt: ShopRuntime, refresh = false) {
  const key = cacheKeys.themes(rt.shop.id);
  if (refresh) await rt.env.KV.delete(key).catch(() => undefined);
  return cached(rt.env.KV, key, 60, async () => listThemes(await rt.admin()), rt.logger);
}

/** Learns the store's name from Shopify the first time it is needed. */
export async function ensureShopName(rt: ShopRuntime): Promise<string> {
  if (rt.shop.shopName) return rt.shop.shopName;
  try {
    const details = await getShopDetails(await rt.admin());
    await updateShopName(rt.db, rt.shop.id, details.name);
    rt.shop.shopName = details.name;
    return details.name;
  } catch (err) {
    rt.logger.warn('shop.name_lookup_failed', { error: err instanceof Error ? err.message : String(err) });
    return fallbackStoreName(rt.shop.shopDomain);
  }
}

export interface MarkerInfo {
  /** assets/theme-sync.json exists in the theme. */
  present: boolean;
  sha: string | null;
  branch: string | null;
  syncedOn: string | null;
}

/** Reads assets/theme-sync.json from a theme. */
export async function readThemeMarker(rt: ShopRuntime, themeId: string): Promise<MarkerInfo> {
  const bodies = await getThemeFileBodies(await rt.admin(), themeId, [THEME_SYNC_MARKER_PATH], rt.fetchImpl);
  const body = bodies.get(THEME_SYNC_MARKER_PATH);
  if (!body) return { present: false, sha: null, branch: null, syncedOn: null };
  try {
    const parsed = body.type === 'TEXT' ? (JSON.parse(body.value) as Record<string, unknown>) : {};
    const sha = typeof parsed.lastSyncedUpdate === 'string' ? parsed.lastSyncedUpdate.toLowerCase() : null;
    return {
      present: true,
      sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null,
      branch: typeof parsed.branch === 'string' ? parsed.branch : null,
      syncedOn: typeof parsed.syncedOn === 'string' ? parsed.syncedOn : null,
    };
  } catch {
    return { present: true, sha: null, branch: null, syncedOn: null };
  }
}

/**
 * Writes assets/theme-sync.json from the theme's last synced update, so the
 * theme (and any duplicate of it) carries the record. Only this one file is
 * written; it does not change how the store looks or works.
 */
export async function writeThemeMarker(rt: ShopRuntime, theme: Pick<ShopifyTheme, 'id' | 'isLive'>): Promise<{ written: boolean; message: string }> {
  const state = await getThemeState(rt.db, rt.shop.id, theme.id);
  if (!state?.lastSyncedSha) return { written: false, message: 'This theme has no last synced update to record yet.' };
  const content = buildMarker({
    sha: state.lastSyncedSha,
    message: state.lastSyncedMessage,
    line: theme.isLive ? 'live' : 'other',
    syncedAt: state.lastSyncedAt ?? new Date(),
    verifiedOnStagingAt: state.verifiedOnStagingAt,
    repository: rt.repo?.fullName ?? null,
    branch: state.lastSyncedBranch,
  });
  try {
    const result = await upsertThemeFiles(await rt.admin(), theme.id, [
      { filename: THEME_SYNC_MARKER_PATH, body: { type: 'TEXT', value: content } },
    ]);
    if (result.failed.length > 0) return { written: false, message: result.failed[0]!.message };
    await rt.env.KV.delete(`marker-miss:${rt.shop.id}:${theme.id}`).catch(() => undefined);
    return { written: true, message: `Saved ${THEME_SYNC_MARKER_PATH} in the theme.` };
  } catch (err) {
    return { written: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A theme with no record here may still carry assets/theme-sync.json (for
 * example a duplicated theme, or records lost with a database reset). Its last
 * synced update is imported from that file once.
 */
export async function importThemeMarker(rt: ShopRuntime, themeId: string): Promise<void> {
  const missKey = `marker-miss:${rt.shop.id}:${themeId}`;
  try {
    if (await getThemeState(rt.db, rt.shop.id, themeId)) return;
    if (await rt.env.KV.get(missKey)) return;
    const bodies = await getThemeFileBodies(await rt.admin(), themeId, [THEME_SYNC_MARKER_PATH], rt.fetchImpl);
    const body = bodies.get(THEME_SYNC_MARKER_PATH);
    const parsed = body?.type === 'TEXT' ? (JSON.parse(body.value) as Record<string, unknown>) : null;
    const sha = typeof parsed?.lastSyncedUpdate === 'string' ? parsed.lastSyncedUpdate.toLowerCase() : '';
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      await rt.env.KV.put(missKey, '1', { expirationTtl: 600 });
      return;
    }
    const syncedOn = typeof parsed?.syncedOn === 'string' ? new Date(parsed.syncedOn) : null;
    await upsertThemeState(rt.db, rt.shop.id, themeId, {
      lastSyncedSha: sha,
      lastSyncedMessage: typeof parsed?.description === 'string' ? parsed.description.slice(0, 1000) : null,
      lastSyncedBranch: typeof parsed?.branch === 'string' ? parsed.branch.slice(0, 250) : null,
      lastSyncedAt: syncedOn && !Number.isNaN(syncedOn.getTime()) ? syncedOn : null,
      lastSyncId: null,
      // A copied record is not proof that this store's Staging verified the update.
      verifiedOnStagingAt: null,
    });
    rt.logger.info('theme.marker_imported', { themeId, sha });
  } catch (err) {
    rt.logger.warn('theme.marker_import_failed', { themeId, error: err instanceof Error ? err.message : String(err) });
  }
}
