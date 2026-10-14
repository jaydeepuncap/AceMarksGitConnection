/**
 * Roll an update out to a test (unpublished) theme of several stores of the group.
 *
 *   GET  /api/rollout          ?sha   where every store of the group stands
 *   POST /api/rollout/preview  { sha, shops }   checks + review for each store (nothing changes)
 *   POST /api/rollout/confirm  { runs: [{ shopDomain, runId, acceptDirectEdits? }] }
 *
 * Only stores listed in STORE_GROUP, and only when the requesting store is one
 * of them. Each store's own settings and tokens are used, and roll-outs only
 * ever reach unpublished themes: each store is published to Live from its own
 * Theme Sync, one at a time.
 */
import { Hono, type Context } from 'hono';
import type { Shop } from '../../drizzle/schema';
import type {
  CommitRef,
  ShopifyTheme,
  RolloutConfirmResult,
  RolloutPreviewResult,
  RolloutResponse,
  RolloutStagingState,
  RolloutStore,
} from '../../shared/api-types';
import type { AppEnv } from '../env';
import {
  countOperations,
  findActiveSyncForTheme,
  findShopsByDomains,
  getDb,
  getSyncRun,
  getThemeState,
  latestRunForTheme,
  type Database,
} from '../lib/database';
import { ApiError, ok } from '../lib/response';
import { storeGroup, toStoreSummary } from '../lib/store-group';
import { normalizeShopDomain } from '../lib/validators';
import {
  parseOrThrow,
  readJsonBody,
  rolloutConfirmSchema,
  rolloutPreviewSchema,
  rolloutQuerySchema,
} from '../lib/validators';
import { rateLimit } from '../middleware/error-handler';
import { planRun } from '../sync/plan';
import { confirmRun, describeRun } from '../sync/runs';
import { loadShopRuntime, mapLimit } from '../sync/runtime';
import { dispatchCtx, requestActor, themesFor } from './helpers';

const writeLimiter = rateLimit({
  binding: 'SYNC_RATE_LIMITER',
  limit: 10,
  periodSeconds: 60,
  key: (c) => c.get('auth').shopDomain,
});

function requireGroup(c: Context<AppEnv>): string[] {
  const group = storeGroup(c.env);
  if (!group.includes(c.get('auth').shopDomain)) {
    throw new ApiError(403, 'FORBIDDEN', 'This store is not part of a store group (STORE_GROUP)');
  }
  return group;
}

/** Group stores by domain; a domain outside the group is refused. */
async function groupShops(c: Context<AppEnv>, domains: string[]): Promise<Map<string, Shop>> {
  const group = requireGroup(c);
  const wanted = domains.map((d) => normalizeShopDomain(d));
  if (wanted.some((d) => !d || !group.includes(d))) {
    throw new ApiError(403, 'FORBIDDEN', 'Only stores of this store group can be selected');
  }
  const rows = await findShopsByDomains(getDb(c.env.DB), wanted as string[]);
  return new Map(rows.map((r) => [r.shopDomain, r]));
}

/** The test theme that most recently received an update from Theme Sync. */
async function mostRecentlyUpdated(db: Database, shopId: string, themes: ShopifyTheme[]): Promise<ShopifyTheme | undefined> {
  let best: { theme: ShopifyTheme; at: number } | undefined;
  for (const theme of themes) {
    const run = await latestRunForTheme(db, shopId, theme.id);
    const at = run?.confirmedAt?.getTime() ?? 0;
    if (run && (!best || at > best.at)) best = { theme, at };
  }
  return best?.theme;
}

const toError = (err: unknown) =>
  err instanceof ApiError
    ? { code: err.code, message: err.message }
    : { code: 'INTERNAL_ERROR', message: 'Unexpected error while preparing this store' };

export const rolloutRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const query = parseOrThrow(rolloutQuerySchema, c.req.query());
    const { shop: current } = c.get('auth');
    const db = getDb(c.env.DB);
    const group = storeGroup(c.env);
    if (!group.includes(current.shopDomain)) {
      return ok<RolloutResponse>(c, { enabled: false, target: null, stores: [] });
    }

    const chosen = new Map<string, string>();
    for (const pair of (query.themes ?? '').split(',')) {
      const [domain, id] = pair.split(':');
      const normalized = normalizeShopDomain(domain);
      if (normalized && id && /^\d{1,20}$/.test(id)) chosen.set(normalized, `gid://shopify/OnlineStoreTheme/${id}`);
    }

    const rows = await findShopsByDomains(db, group);
    const byDomain = new Map(rows.map((r) => [r.shopDomain, r]));
    const stores: RolloutStore[] = [];
    let target: CommitRef | null = query.sha ? { sha: query.sha, shortSha: query.sha.slice(0, 7), message: null } : null;

    for (const domain of group) {
      const shop = byDomain.get(domain);
      const summary = toStoreSummary(c.env, domain, shop, current.shopDomain);
      const entry: RolloutStore = {
        shopDomain: domain,
        name: summary.name,
        current: summary.current,
        adminUrl: summary.adminUrl,
        themes: [],
        themeId: null,
        staging: { state: 'not_installed', sha: null, runId: null, progress: null },
        live: { state: 'none', sha: null },
      };
      stores.push(entry);
      if (!shop || shop.status !== 'installed') continue;

      const rt = await loadShopRuntime(c.env, db, shop, c.get('logger').child({ shop: domain }), {
        sessionToken: domain === current.shopDomain ? c.get('auth').sessionToken : undefined,
      });
      let themes: ShopifyTheme[];
      try {
        themes = await themesFor(rt);
      } catch {
        entry.staging.state = 'not_configured';
        continue;
      }
      const testThemes = themes.filter((t) => !t.isLive && t.writable);
      entry.themes = testThemes.map((t) => ({ id: t.id, name: t.name }));
      const testTheme =
        testThemes.find((t) => t.id === chosen.get(domain)) ??
        testThemes.find((t) => t.id === rt.settings.stagingTheme?.id) ??
        (await mostRecentlyUpdated(db, shop.id, testThemes)) ??
        testThemes[0];
      entry.themeId = testTheme?.id ?? null;

      const state = testTheme ? await getThemeState(db, shop.id, testTheme.id) : undefined;
      // Default update: what this store's test theme runs.
      if (!target && domain === current.shopDomain && state?.lastSyncedSha) {
        target = { sha: state.lastSyncedSha, shortSha: state.lastSyncedSha.slice(0, 7), message: state.lastSyncedMessage };
      }
      if (!testTheme) {
        entry.staging.state = 'not_configured';
      } else {
        entry.staging.sha = state?.lastSyncedSha ?? null;
        const active = await findActiveSyncForTheme(db, shop.id, testTheme.id);
        const latest = await latestRunForTheme(db, shop.id, testTheme.id);
        let stagingState: RolloutStagingState = 'behind';
        if (active) {
          const counts = await countOperations(db, shop.id, active.id);
          stagingState = active.status === 'queued' && counts.succeeded === 0 ? 'queued' : 'updating';
          entry.staging.runId = active.id;
          entry.staging.progress = { done: counts.succeeded, total: counts.pending + counts.succeeded + counts.failed };
        } else if (latest && latest.commitSha === target?.sha && ['failed', 'partially_failed'].includes(latest.status)) {
          stagingState = 'failed';
          entry.staging.runId = latest.id;
        }
        entry.staging.state = stagingState;
      }

      const published = themes.find((t) => t.isLive);
      if (!published) {
        entry.live.state = 'not_configured';
      } else {
        const liveState = await getThemeState(db, shop.id, published.id);
        entry.live.sha = liveState?.lastSyncedSha ?? null;
        entry.live.state = (await findActiveSyncForTheme(db, shop.id, published.id)) ? 'updating' : 'none';
      }
    }

    // States relative to the update (known only once the target is resolved).
    for (const entry of stores) {
      if (target && entry.staging.state === 'behind' && entry.staging.sha === target.sha) entry.staging.state = 'up_to_date';
      if (entry.live.state === 'none' && target) {
        if (entry.live.sha === target.sha) entry.live.state = 'published';
        else if (entry.staging.state === 'up_to_date') entry.live.state = 'ready_to_publish';
        else if (entry.live.sha) entry.live.state = 'behind';
      }
    }
    return ok<RolloutResponse>(c, { enabled: true, target, stores });
  })
  .post('/preview', writeLimiter, async (c) => {
    const body = parseOrThrow(rolloutPreviewSchema, await readJsonBody(c.req.raw));
    const shops = await groupShops(c, body.targets.map((t) => t.shopDomain));
    const themeFor = new Map(body.targets.map((t) => [normalizeShopDomain(t.shopDomain)!, t.themeId]));
    const rolloutId = crypto.randomUUID();
    const { userId, shopDomain: currentDomain, sessionToken } = c.get('auth');
    const db = getDb(c.env.DB);

    const results = await mapLimit([...themeFor.keys()], 2, async (domain): Promise<RolloutPreviewResult> => {
      const shop = shops.get(domain);
      const name = shop?.shopName ?? toStoreSummary(c.env, domain, shop, currentDomain).name;
      if (!shop || shop.status !== 'installed') {
        return { shopDomain: domain, name, run: null, error: { code: 'NOT_FOUND', message: 'The app is not installed on this store' } };
      }
      try {
        const logger = c.get('logger').child({ shop: domain, rolloutId });
        const rt = await loadShopRuntime(c.env, db, shop, logger, { sessionToken: domain === currentDomain ? sessionToken : undefined });
        const themeId = themeFor.get(domain)!;
        const run = await planRun(rt, {
          kind: 'update',
          line: themeId === rt.settings.stagingTheme?.id ? 'staging' : 'other',
          themeId,
          targetSha: body.sha,
          userId,
          rolloutId,
        });
        return { shopDomain: domain, name, run: await describeRun(db, run, domain, rt.settings.stagingTheme?.id ?? null), error: null };
      } catch (err) {
        return { shopDomain: domain, name, run: null, error: toError(err) };
      }
    });
    return ok<RolloutPreviewResult[]>(c, results, 'Checks complete. Nothing has changed yet.', 201);
  })
  .post('/confirm', writeLimiter, async (c) => {
    const body = parseOrThrow(rolloutConfirmSchema, await readJsonBody(c.req.raw));
    const shops = await groupShops(c, body.runs.map((r) => r.shopDomain));
    const { shopDomain: currentDomain, sessionToken } = c.get('auth');
    const actor = requestActor(c);
    const db = getDb(c.env.DB);

    const results: RolloutConfirmResult[] = [];
    for (const item of body.runs) {
      const domain = normalizeShopDomain(item.shopDomain)!;
      const shop = shops.get(domain);
      try {
        if (!shop || shop.status !== 'installed') throw new ApiError(404, 'NOT_FOUND', 'The app is not installed on this store');
        const run = await getSyncRun(db, shop.id, item.runId);
        // Another store's plan can only be confirmed here when a roll-out created it.
        if (!run || (domain !== currentDomain && !run.rolloutId) || run.kind !== 'update') {
          throw new ApiError(404, 'NOT_FOUND', 'Roll-out update not found');
        }
        const logger = c.get('logger').child({ shop: domain });
        const rt = await loadShopRuntime(c.env, db, shop, logger, { sessionToken: domain === currentDomain ? sessionToken : undefined });
        await confirmRun(rt, { ...dispatchCtx(c), logger }, run, { acceptDirectEdits: item.acceptDirectEdits }, actor);
        const fresh = await getSyncRun(db, shop.id, run.id);
        results.push({ shopDomain: domain, run: await describeRun(db, fresh!, domain, rt.settings.stagingTheme?.id ?? null), error: null });
      } catch (err) {
        results.push({ shopDomain: domain, run: null, error: toError(err) });
      }
    }
    return ok<RolloutConfirmResult[]>(c, results, 'Roll-out started', 202);
  });
