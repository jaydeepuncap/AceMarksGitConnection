import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RolloutConfirmResult, RolloutPreviewResult, RolloutResponse } from '../../shared/api-types';
import { app } from '../../worker/index';
import { createLogger } from '../../worker/lib/logger';
import { handleSyncMessage } from '../../worker/sync/dispatch';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { seedShop, THEME_DEV, THEME_LIVE } from '../helpers/fixtures';
import { C1, C3, installWorld, REPO_FILES } from '../helpers/sync-world';

const ACE = 'acemarks.myshopify.com';
const PAUL = 'paulevans.myshopify.com';
const OUTSIDER = 'other.myshopify.com';

describe('roll out across stores', () => {
  let t: TestContext;
  let world: ReturnType<typeof installWorld>;
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    t = createTestEnv();
    t.env.STORE_GROUP = `${ACE}, ${PAUL}`;
    world = installWorld();
    await seedShop(t.env, ACE);
    await seedShop(t.env, PAUL);
    await seedShop(t.env, OUTSIDER);
  }

  const api = async <T>(method: string, path: string, body?: unknown, shop = ACE) => {
    const res = await app.request(
      path,
      {
        method,
        headers: { Authorization: `Bearer ${await sessionToken(shop)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      t.env,
      t.ctx,
    );
    return { status: res.status, body: (await res.json()) as { data: T; error: { code: string } } };
  };

  it('shows where every store stands, checks each store, then updates their Staging themes', async () => {
    await setup();
    const status = (await api<RolloutResponse>('GET', `/api/rollout?sha=${C3}`)).body.data;
    expect(status.enabled).toBe(true);
    expect(status.stores.map((s) => [s.shopDomain, s.staging.state, s.live.state])).toEqual([
      [ACE, 'behind', 'behind'],
      [PAUL, 'behind', 'behind'],
    ]);

    const preview = await api<RolloutPreviewResult[]>('POST', '/api/rollout/preview', { sha: C3, shops: [ACE, PAUL] });
    expect(preview.status).toBe(201);
    expect(preview.body.data.map((r) => [r.shopDomain, r.run?.status, r.run?.base?.sha])).toEqual([
      [ACE, 'previewed', C1],
      [PAUL, 'previewed', C1],
    ]);
    expect(world.upserts).toHaveLength(0);

    const runs = preview.body.data.map((r) => ({ shopDomain: r.shopDomain, runId: r.run!.id }));
    const confirmed = await api<RolloutConfirmResult[]>('POST', '/api/rollout/confirm', { runs });
    expect(confirmed.body.data.map((r) => r.run?.status)).toEqual(['queued', 'queued']);
    const logger = createLogger('error');
    while (t.queue.sent.length) {
      const msg = t.queue.sent.shift()!;
      if ((await handleSyncMessage(t.env, msg.body, logger)) !== null) t.queue.sent.push(msg);
    }

    for (const shop of [ACE, PAUL]) {
      expect(world.theme(shop, THEME_DEV.id).get('sections/cart.liquid')?.value).toBe(REPO_FILES.C3['sections/cart.liquid']);
      // Live is published from each store's own screen, never by a roll-out.
      expect(world.theme(shop, THEME_LIVE.id).get('sections/cart.liquid')?.value).toBe(REPO_FILES.C1['sections/cart.liquid']);
    }
    const after = (await api<RolloutResponse>('GET', `/api/rollout?sha=${C3}`, undefined, PAUL)).body.data;
    expect(after.stores.map((s) => [s.staging.state, s.live.state])).toEqual([
      ['up_to_date', 'ready_to_publish'],
      ['up_to_date', 'ready_to_publish'],
    ]);
  });

  it('refuses stores outside the group and callers outside the group', async () => {
    await setup();
    expect((await api('POST', '/api/rollout/preview', { sha: C3, shops: [OUTSIDER] })).status).toBe(403);
    expect((await api('POST', '/api/rollout/preview', { sha: C3, shops: [ACE] }, OUTSIDER)).status).toBe(403);
    expect((await api<RolloutResponse>('GET', '/api/rollout', undefined, OUTSIDER)).body.data.enabled).toBe(false);
  });

  it('cannot confirm another store’s plan that a roll-out did not create', async () => {
    await setup();
    const own = await api<{ id: string }>('POST', '/api/updates/plan', { kind: 'update', targetSha: C3 }, PAUL);
    const res = await api<RolloutConfirmResult[]>('POST', '/api/rollout/confirm', { runs: [{ shopDomain: PAUL, runId: own.body.data.id }] });
    expect(res.body.data[0]?.error?.code).toBe('NOT_FOUND');
    expect(t.queue.sent).toHaveLength(0);
  });
});
