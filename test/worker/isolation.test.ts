import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../worker/index';
import { createRun, getDb, getSyncRun, listHistory } from '../../worker/lib/database';
import { createTestEnv, sessionToken, type FakeRateLimiter, type TestContext } from '../helpers/env';
import { seedShop, START_SHA, THEME_DEV } from '../helpers/fixtures';

const A = 'alpha.myshopify.com';
const B = 'beta.myshopify.com';

describe('shop-level data isolation', () => {
  let t: TestContext;
  let runId: string;
  beforeEach(async () => {
    t = createTestEnv();
    const shopA = await seedShop(t.env, A);
    await seedShop(t.env, B);
    runId = crypto.randomUUID();
    await createRun(getDb(t.env.DB), shopA.id, {
      id: runId,
      repository: 'acme/theme',
      branch: 'main',
      commitSha: '2'.repeat(40),
      themeId: THEME_DEV.id,
      themeName: THEME_DEV.name,
      themeRole: 'UNPUBLISHED',
      strategy: 'commit_changes',
      baseSha: START_SHA,
      filesChanged: 1,
      confirmedAt: new Date(),
      previewExpiresAt: new Date(Date.now() + 60_000),
    }, [{ path: 'sections/a.liquid', sourcePath: 'sections/a.liquid', previousPath: null, action: 'upsert', changeType: 'modified', blobSha: 'a'.repeat(40), size: 1, existsInTheme: true, status: 'pending', skipReason: null }]);
  });

  const call = async (shop: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await sessionToken(shop)}` } }, t.env, t.ctx);

  it('database helpers never return another shop’s rows', async () => {
    const db = getDb(t.env.DB);
    const shopB = t.sqlite.prepare('SELECT id FROM shops WHERE shop_domain = ?').get(B) as { id: string };
    expect(await getSyncRun(db, shopB.id, runId)).toBeUndefined();
    expect((await listHistory(db, shopB.id, { page: 1, perPage: 10 })).rows).toHaveLength(0);
  });

  it('shop B cannot read shop A’s update by ID', async () => {
    expect((await call(B, `/api/updates/${runId}`)).status).toBe(404);
    expect((await call(A, `/api/updates/${runId}`)).status).toBe(200);
  });

  it('shop B cannot confirm, retry or restore shop A’s update', async () => {
    for (const action of ['confirm', 'retry', 'restore', 'cancel']) {
      const res = await call(B, `/api/updates/${runId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    }
    expect(t.queue.sent).toHaveLength(0);
  });

  it('the shop comes from the verified token, not from client-supplied parameters', async () => {
    const res = await call(B, `/api/settings?shop=${A}`, { headers: { 'X-Shopify-Shop-Domain': A } });
    const body = (await res.json()) as { data: { shop: { shopDomain: string } } };
    expect(body.data.shop.shopDomain).toBe(B);
  });

  it('a store outside the store group cannot use the roll-out', async () => {
    const res = await call(A, '/api/rollout/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: '2'.repeat(40), shops: [B] }),
    });
    expect(res.status).toBe(403);
  });

  it('rate limits per shop (429 with Retry-After)', async () => {
    const limiter = t.env.API_RATE_LIMITER as unknown as FakeRateLimiter;
    limiter.allow = false;
    const res = await call(A, '/api/settings');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(limiter.keys.at(-1)).toBe(`API_RATE_LIMITER:${A}`);
  });
});
