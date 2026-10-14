/**
 *   GET /api/overview   the store's Staging and Live themes, their last synced
 *                       update, how many updates are waiting, active runs
 *   GET /api/stores     the stores of the group (store selector)
 */
import { Hono } from 'hono';
import type { OverviewResponse, ShopifyTheme, StoreSummary, ThemeLine, ThemeLineState, ThemeRef } from '../../shared/api-types';
import type { AppEnv } from '../env';
import {
  countOperations,
  findActiveSyncForTheme,
  findShopsByDomains,
  getGithubConnection,
  getThemeState,
  latestRunForTheme,
  toSyncedUpdate,
} from '../lib/database';
import { ok } from '../lib/response';
import { storeGroup, toStoreSummary } from '../lib/store-group';
import { describeRun, toUpdateRun } from '../sync/runs';
import { countAfter, resolveBranch, type ShopRuntime } from '../sync/runtime';
import { ensureShopName, importThemeMarker, requestRuntime, themesFor } from './helpers';


async function lineState(
  rt: ShopRuntime,
  line: ThemeLine,
  configured: ThemeRef | null,
  themes: ShopifyTheme[] | null,
): Promise<ThemeLineState> {
  const theme = configured ? (themes?.find((t) => t.id === configured.id) ?? null) : null;
  if (configured && theme) await importThemeMarker(rt, configured.id);
  const state = configured ? await getThemeState(rt.db, rt.shop.id, configured.id) : undefined;
  const active = configured ? await findActiveSyncForTheme(rt.db, rt.shop.id, configured.id) : undefined;
  const latest = configured ? await latestRunForTheme(rt.db, rt.shop.id, configured.id) : undefined;
  const stagingId = rt.settings.stagingTheme?.id ?? null;
  return {
    line,
    configured,
    theme,
    lastSynced: toSyncedUpdate(state),
    waiting: 0,
    waitingMore: false,
    activeRun: active ? await describeRun(rt.db, active, rt.shop.shopDomain, stagingId) : null,
    lastRun: latest ? toUpdateRun(latest, await countOperations(rt.db, rt.shop.id, latest.id), rt.shop.shopDomain) : null,
  };
}

export const overviewRoutes = new Hono<AppEnv>()
  .get('/overview', async (c) => {
    const rt = await requestRuntime(c);
    const notices: string[] = [];
    const name = await ensureShopName(rt);

    const connection = await getGithubConnection(rt.db, rt.shop.id);
    const githubConnected = !!connection || !!c.env.GITHUB_TOKEN?.trim();
    const setupMissing: string[] = [];
    if (!githubConnected) setupMissing.push('Connect GitHub');
    if (!rt.repo) setupMissing.push('Choose the master repository');
    if (!rt.settings.stagingTheme) setupMissing.push('Pick the Staging theme');
    if (!rt.settings.liveTheme) setupMissing.push('Pick the Live theme');

    let themes: ShopifyTheme[] | null = null;
    try {
      themes = await themesFor(rt, c.req.query('refresh') === '1');
    } catch (err) {
      notices.push(`Shopify themes could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
    }
    const staging = await lineState(rt, 'staging', rt.settings.stagingTheme, themes);
    const live = await lineState(rt, 'live', rt.settings.liveTheme, themes);
    if (rt.settings.stagingTheme && themes && !staging.theme) notices.push('The Staging theme chosen in Settings no longer exists.');
    if (rt.settings.liveTheme && themes && !live.theme) notices.push('The Live theme chosen in Settings no longer exists.');

    let branch: string | null = rt.repo?.branch ?? null;
    if (rt.repo && githubConnected) {
      try {
        branch = await resolveBranch(rt);
        if (staging.lastSynced) {
          const after = await countAfter(rt, branch, staging.lastSynced.sha, 100);
          staging.waiting = after.count;
          staging.waitingMore = after.more;
        }
        if (staging.lastSynced?.verifiedOnStagingAt && live.lastSynced?.sha !== staging.lastSynced.sha) {
          if (live.lastSynced) {
            const after = await countAfter(rt, staging.lastSynced.sha, live.lastSynced.sha, 100);
            live.waiting = Math.max(1, after.count);
            live.waitingMore = after.more;
          } else {
            live.waiting = 1;
          }
        }
      } catch (err) {
        notices.push(`GitHub could not be reached: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const publishable =
      staging.lastSynced?.verifiedOnStagingAt && live.lastSynced?.sha !== staging.lastSynced.sha && rt.settings.liveTheme
        ? staging.lastSynced
        : null;

    const store: StoreSummary = toStoreSummary(c.env, rt.shop.shopDomain, { ...rt.shop, shopName: name }, rt.shop.shopDomain);
    return ok<OverviewResponse>(c, {
      store,
      repository: rt.repo?.fullName ?? null,
      branch,
      githubConnected,
      setupMissing,
      staging,
      live,
      publishable,
      notices,
    });
  })
  .get('/stores', async (c) => {
    const { shop } = c.get('auth');
    const group = storeGroup(c.env);
    if (!group.includes(shop.shopDomain)) {
      return ok<StoreSummary[]>(c, [toStoreSummary(c.env, shop.shopDomain, shop, shop.shopDomain)]);
    }
    const rows = await findShopsByDomains((await requestRuntime(c)).db, group);
    const byDomain = new Map(rows.map((r) => [r.shopDomain, r]));
    return ok<StoreSummary[]>(c, group.map((domain) => toStoreSummary(c.env, domain, byDomain.get(domain), shop.shopDomain)));
  });
