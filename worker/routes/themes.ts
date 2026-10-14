/**
 * GET /api/themes[?refresh=1]   themes of the authenticated shop via Admin GraphQL
 *                               (`themes` query, read_themes scope). Cached in KV for 60 s per shop.
 * GET /api/themes/last-synced   the last commit fully synced to each theme (any branch)
 */
import { Hono } from 'hono';
import type { LastSynced, ShopifyTheme } from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached, cacheKeys, invalidate } from '../lib/cache';
import { adminClient } from '../lib/clients';
import { getDb, latestSyncPerTheme, toLastSynced } from '../lib/database';
import { ok } from '../lib/response';
import { listThemes } from '../lib/shopify-graphql';

export const themesRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { shop } = c.get('auth');
    const key = cacheKeys.themes(shop.id);
    if (c.req.query('refresh') === '1') await invalidate(c.env.KV, key);
    const themes = await cached<ShopifyTheme[]>(c.env.KV, key, 60, async () => listThemes(await adminClient(c)), c.get('logger'));
    return ok(c, themes);
  })
  .get('/last-synced', async (c) => {
    const rows = await latestSyncPerTheme(getDb(c.env.DB), c.get('auth').shop.id);
    const out: Record<string, LastSynced> = {};
    for (const [themeId, row] of rows) out[themeId] = toLastSynced(row)!;
    return ok<Record<string, LastSynced>>(c, out);
  });
