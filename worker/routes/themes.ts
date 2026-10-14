/**
 *   GET /api/themes            ?refresh=1  themes of the store (KV cache 60 s)
 *   GET /api/themes/overview   ?refresh=1  every theme with its last synced update
 *                                          (read from assets/theme-sync.json when not recorded yet)
 *   GET /api/themes/:id        one theme (numeric ID or GID) with its last synced update and runs
 */
import { Hono } from 'hono';
import type { ShopifyTheme, ThemeOverviewItem, ThemeSyncFile } from '../../shared/api-types';
import { THEME_SYNC_MARKER_PATH } from '../../shared/theme-paths';
import type { AppEnv } from '../env';
import {
  countOperations,
  findActiveSyncForTheme,
  getThemeState,
  latestRunForTheme,
  toSyncedUpdate,
} from '../lib/database';
import { ApiError, ok } from '../lib/response';
import { parseOrThrow, themeIdSchema } from '../lib/validators';
import { lineForTheme } from '../sync/plan';
import { describeRun, toUpdateRun } from '../sync/runs';
import { mapLimit, type ShopRuntime } from '../sync/runtime';
import { importThemeMarker, readThemeMarker, requestRuntime, themesFor, writeThemeMarker } from './helpers';

async function overviewItem(rt: ShopRuntime, theme: ShopifyTheme): Promise<ThemeOverviewItem> {
  await importThemeMarker(rt, theme.id);
  const state = await getThemeState(rt.db, rt.shop.id, theme.id);
  const active = await findActiveSyncForTheme(rt.db, rt.shop.id, theme.id);
  const latest = await latestRunForTheme(rt.db, rt.shop.id, theme.id);
  const stagingId = rt.settings.stagingTheme?.id ?? null;
  return {
    theme,
    line: lineForTheme(rt.settings, theme),
    lastSynced: toSyncedUpdate(state),
    activeRun: active ? await describeRun(rt.db, active, rt.shop.shopDomain, stagingId) : null,
    lastRun: latest ? toUpdateRun(latest, await countOperations(rt.db, rt.shop.id, latest.id), rt.shop.shopDomain) : null,
  };
}

export const themesRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rt = await requestRuntime(c);
    return ok<ShopifyTheme[]>(c, await themesFor(rt, c.req.query('refresh') === '1'));
  })
  .get('/overview', async (c) => {
    const rt = await requestRuntime(c);
    const themes = await themesFor(rt, c.req.query('refresh') === '1');
    const items = await mapLimit(themes, 4, (theme) => overviewItem(rt, theme));
    return ok<ThemeOverviewItem[]>(c, items);
  })
  .get('/:id', async (c) => {
    const id = parseOrThrow(themeIdSchema, c.req.param('id'));
    const rt = await requestRuntime(c);
    const theme = (await themesFor(rt, c.req.query('refresh') === '1')).find((t) => t.id === id);
    if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
    const item = await overviewItem(rt, theme);
    let syncFile: ThemeSyncFile | null = null;
    try {
      const marker = await readThemeMarker(rt, theme.id);
      syncFile = { path: THEME_SYNC_MARKER_PATH, ...marker, matchesRecord: !!marker.sha && marker.sha === item.lastSynced?.sha };
    } catch (err) {
      rt.logger.warn('theme.marker_read_failed', { error: err instanceof Error ? err.message : String(err) });
    }
    return ok<ThemeOverviewItem>(c, { ...item, syncFile });
  })
  /** Writes assets/theme-sync.json from the theme's last synced update (only that file changes). */
  .post('/:id/sync-file', async (c) => {
    const id = parseOrThrow(themeIdSchema, c.req.param('id'));
    const rt = await requestRuntime(c);
    const theme = (await themesFor(rt)).find((t) => t.id === id);
    if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
    if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `A ${theme.role} theme cannot be changed`);
    const result = await writeThemeMarker(rt, theme);
    if (!result.written) throw new ApiError(422, 'VALIDATION_ERROR', result.message);
    return ok(c, { written: true }, result.message);
  });
