/**
 * GET /api/themes[?refresh=1]   themes of the authenticated shop via Admin GraphQL
 *                               (`themes` query, read_themes scope). Cached in KV for 60 s per shop.
 * GET /api/themes/last-synced   the last commit fully synced to each theme (any branch); themes
 *                               without a record are read from their assets/theme-sync.json
 */
import { Hono } from 'hono';
import type { LastSynced, ShopifyTheme } from '../../shared/api-types';
import type { AppEnv } from '../env';
import { cached, cacheKeys, invalidate } from '../lib/cache';
import { adminClient } from '../lib/clients';
import { getDb, getGithubConnection, getSettings, latestSyncPerTheme, toLastSynced, type Database } from '../lib/database';
import { ok } from '../lib/response';
import { listThemes } from '../lib/shopify-graphql';
import { recoverThemeState } from '../sync/theme-state';

export const themesRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { shop } = c.get('auth');
    const key = cacheKeys.themes(shop.id);
    if (c.req.query('refresh') === '1') await invalidate(c.env.KV, key);
    const themes = await cached<ShopifyTheme[]>(c.env.KV, key, 60, async () => listThemes(await adminClient(c)), c.get('logger'));
    return ok(c, themes);
  })
  .get('/last-synced', async (c) => {
    const { shop } = c.get('auth');
    const db = getDb(c.env.DB);
    let rows = await latestSyncPerTheme(db, shop.id);

    // Themes the app has no record for (e.g. duplicates of a synced theme) are
    // identified by their assets/theme-sync.json.
    try {
      const admin = await adminClient(c);
      const themes = await cached<ShopifyTheme[]>(c.env.KV, cacheKeys.themes(shop.id), 60, () => listThemes(admin), c.get('logger'));
      const missing = themes.filter((t) => !rows.has(t.id));
      if (missing.length > 0) {
        const repository = await currentRepository(db, shop.id);
        const deps = { db, admin, kv: c.env.KV, logger: c.get('logger') };
        let recovered = false;
        for (let i = 0; i < missing.length; i += 5) {
          const results = await Promise.all(
            missing.slice(i, i + 5).map((t) => recoverThemeState(deps, { shopId: shop.id, themeId: t.id, repository })),
          );
          recovered ||= results.some(Boolean);
        }
        if (recovered) rows = await latestSyncPerTheme(db, shop.id);
      }
    } catch (err) {
      // The recorded rows are still shown when Shopify cannot be reached.
      c.get('logger').warn('themes.recover_failed', { error: err });
    }

    const out: Record<string, LastSynced> = {};
    for (const [themeId, row] of rows) out[themeId] = toLastSynced(row)!;
    return ok<Record<string, LastSynced>>(c, out);
  });

/** The repository syncs come from (settings, else the GitHub connection), if any. */
async function currentRepository(db: Database, shopId: string): Promise<string | null> {
  const settings = await getSettings(db, shopId);
  if (settings.defaultRepository) return settings.defaultRepository;
  const connection = await getGithubConnection(db, shopId);
  return connection?.repoOwner && connection.repoName ? `${connection.repoOwner}/${connection.repoName}` : null;
}
