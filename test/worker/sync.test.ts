import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitListItem, ThemeOverviewItem, UpdateRun, UpdateRunDetail, UpdatesResponse, OverviewResponse, PublishOptionsResponse, Paginated } from '../../shared/api-types';
import { app } from '../../worker/index';
import { createLogger } from '../../worker/lib/logger';
import { handleSyncMessage } from '../../worker/sync/dispatch';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { seedShop, THEME_DEV, THEME_LIVE, THEME_OTHER } from '../helpers/fixtures';
import { C1, C2, C3, installWorld, PNG, REPO_FILES, type WorldOptions } from '../helpers/sync-world';

const SHOP = 'alpha.myshopify.com';
const logger = createLogger('error');

type Body<T> = { success: boolean; data: T; error: { code: string; message: string; details?: unknown } };

describe('Theme Sync workflow', () => {
  let t: TestContext;
  let world: ReturnType<typeof installWorld>;

  async function setup(options: { world?: WorldOptions; withQueue?: boolean; seed?: Parameters<typeof seedShop>[2] } = {}) {
    t = createTestEnv({ withQueue: options.withQueue });
    world = installWorld(options.world);
    await seedShop(t.env, SHOP, options.seed);
  }
  afterEach(() => vi.unstubAllGlobals());

  const api = async <T>(method: string, path: string, body?: unknown, shop = SHOP) => {
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
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const plan = (body: Record<string, unknown>) => api<UpdateRun>('POST', '/api/updates/plan', body);
  const get = async (id: string) => (await api<UpdateRunDetail>('GET', `/api/updates/${id}`)).body.data;
  const staging = () => world.theme(SHOP, THEME_DEV.id);
  const live = () => world.theme(SHOP, THEME_LIVE.id);
  const text = (files: Map<string, { value: string }>, path: string) => files.get(path)?.value;

  /** Drains the queue like the Cloudflare consumer would. */
  async function drainQueue() {
    for (let i = 0; i < 30 && t.queue.sent.length > 0; i++) {
      const msg = t.queue.sent.shift()!;
      const delay = await handleSyncMessage(t.env, msg.body, logger);
      if (delay !== null) t.queue.sent.push({ body: msg.body });
    }
  }

  async function updateStagingTo(sha: string, opts: { acceptDirectEdits?: boolean } = {}) {
    const planned = await plan({ kind: 'update', targetSha: sha });
    expect(planned.status).toBe(201);
    const confirmed = await api<UpdateRun>('POST', `/api/updates/${planned.body.data.id}/confirm`, opts);
    expect(confirmed.status).toBe(202);
    await drainQueue();
    return get(planned.body.data.id);
  }

  describe('choosing an update', () => {
    it('lists updates newest first with NEW / CURRENT and file counts', async () => {
      await setup();
      const { status, body } = await api<UpdatesResponse>('GET', '/api/updates?line=staging');
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ waiting: 2, currentFound: true, current: { sha: C1 } });
      expect(body.data.items.map((i) => [i.shortSha, i.state])).toEqual([
        [C3.slice(0, 7), 'new'],
        [C2.slice(0, 7), 'new'],
        [C1.slice(0, 7), 'current'],
      ]);
      // C3: + cart-item, + logo.png, ~ cart.liquid, ~ cart.css, − old-cart
      expect(body.data.items[0]!.counts).toEqual({ added: 2, modified: 2, removed: 1 });
    });

    it('overview reports waiting updates per theme', async () => {
      await setup();
      const { body } = await api<OverviewResponse>('GET', '/api/overview');
      expect(body.data.setupMissing).toEqual([]);
      expect(body.data.staging).toMatchObject({ waiting: 2, lastSynced: { sha: C1 } });
      expect(body.data.live).toMatchObject({ waiting: 0, lastSynced: { sha: C1 } });
      expect(body.data.store.name).toBe('ALPHA');
    });
  });

  describe('checks and review (nothing changes yet)', () => {
    it('selecting the newest update includes every update before it, in order', async () => {
      await setup();
      const { status, body } = await plan({ kind: 'update', targetSha: C3 });
      expect(status).toBe(201);
      const run = body.data;
      expect(run).toMatchObject({ status: 'previewed', kind: 'update', line: 'staging', direction: 'forward', base: { sha: C1 }, target: { sha: C3 } });
      expect(run.commits.map((c) => c.sha)).toEqual([C2, C3]);
      expect(run.checks?.code).toMatchObject({ status: 'passed', issues: [] });
      expect(run.checks?.directEdits.status).toBe('passed');
      // new: size-chart, cart-item, logo · updated: main-product, cart.liquid, cart.css · removed: old-badge, old-cart
      expect(run.totals).toEqual({ added: 3, updated: 3, removed: 2, protectedUntouched: 1, skipped: 0 });
      expect(run.actions).toMatchObject({ canConfirm: true, needsDirectEditApproval: false, blockedByCodeErrors: false });

      const detail = await get(run.id);
      expect(detail.files.find((f) => f.path === 'templates/product.json')).toMatchObject({
        status: 'skipped',
        skipReason: expect.stringMatching(/Protected/),
      });
      expect(detail.files.find((f) => f.path === 'snippets/size-chart.liquid')?.introducedBy).toBe(C2.slice(0, 7));
      expect(detail.files.find((f) => f.path === 'sections/cart.liquid')?.introducedBy).toBe(C3.slice(0, 7));
      expect(detail.files.some((f) => f.path === 'README.md' || f.path === 'assets/theme-sync.json')).toBe(false);

      expect(world.mock.graphqlCalls().some((c) => /mutation/.test(c.query))).toBe(false);
    });

    it('the code check blocks Liquid and JSON errors before they reach Shopify', async () => {
      await setup();
      world.addCommit('4'.repeat(40), 'Broken', (files) => ({
        ...files,
        'sections/cart.liquid': '{% if cart %}<ul>{% for i in cart.items %}{% endif %}',
        'locales/en.default.json': '{"a": 1,}',
      }));
      const { body } = await plan({ kind: 'update', targetSha: '4'.repeat(40) });
      expect(body.data.checks?.code.status).toBe('failed');
      const paths = body.data.checks!.code.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['sections/cart.liquid', 'locales/en.default.json']));
      expect(body.data.actions).toMatchObject({ canConfirm: false, blockedByCodeErrors: true });

      const res = await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CODE_ERRORS');
      expect(t.queue.sent).toHaveLength(0);
    });

    it('warns about files edited directly in Shopify and asks before replacing them', async () => {
      await setup();
      world.editInShopify(SHOP, THEME_DEV.id, 'assets/cart.css', '.cart{color:green}');
      const { body } = await plan({ kind: 'update', targetSha: C3 });
      expect(body.data.checks?.directEdits).toMatchObject({
        status: 'warning',
        files: [{ path: 'assets/cart.css', reason: 'edited', updatedAt: '2026-10-05T09:00:00Z' }],
      });
      const refused = await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('DIRECT_EDITS_FOUND');
      const accepted = await api('POST', `/api/updates/${body.data.id}/confirm`, { acceptDirectEdits: true });
      expect(accepted.status).toBe(202);
    });

    it('rejects abbreviated SHAs, unknown updates and an update the theme already runs', async () => {
      await setup();
      expect((await plan({ kind: 'update', targetSha: 'bbbbbbb' })).status).toBe(400);
      expect((await plan({ kind: 'update', targetSha: 'f'.repeat(40) })).status).toBe(400);
      const same = await plan({ kind: 'update', targetSha: C1 });
      expect(same.status).toBe(409);
    });

    it('cancelling a review changes nothing', async () => {
      await setup();
      const { body } = await plan({ kind: 'update', targetSha: C3 });
      const res = await api<UpdateRun>('POST', `/api/updates/${body.data.id}/cancel`, {});
      expect(res.body.data.status).toBe('cancelled');
      expect((await api('POST', `/api/updates/${body.data.id}/confirm`, {})).status).toBe(409);
      expect(world.upserts).toHaveLength(0);
    });

    it('rejects expired reviews', async () => {
      await setup();
      const { body } = await plan({ kind: 'update', targetSha: C3 });
      t.sqlite.prepare('UPDATE sync_history SET preview_expires_at = 0 WHERE id = ?').run(body.data.id);
      const res = await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('PREVIEW_EXPIRED');
    });
  });

  describe('updating Staging', () => {
    it('backs up, applies exactly the selected update, writes theme-sync.json last and records the last synced update', async () => {
      await setup();
      const run = await updateStagingTo(C3);
      expect(run).toMatchObject({ status: 'succeeded', progress: { total: 8, succeeded: 8, failed: 0 } });

      const files = staging();
      expect(text(files, 'sections/cart.liquid')).toBe(REPO_FILES.C3['sections/cart.liquid']);
      expect(text(files, 'snippets/size-chart.liquid')).toBe(REPO_FILES.C3['snippets/size-chart.liquid']);
      expect(files.get('assets/logo.png')).toMatchObject({ type: 'BASE64', value: PNG.toString('base64') });
      expect(files.has('snippets/old-cart.liquid')).toBe(false);
      expect(files.has('snippets/old-badge.liquid')).toBe(false);
      // Protected files keep what was edited in Shopify.
      expect(text(files, 'templates/product.json')).toBe(REPO_FILES.C1['templates/product.json']);
      // The Live theme is not touched.
      expect(text(live(), 'sections/cart.liquid')).toBe(REPO_FILES.C1['sections/cart.liquid']);

      // theme-sync.json is the last write and describes the update.
      const lastUpsert = world.upserts.at(-1)!;
      expect(lastUpsert.files.map((f) => f.filename)).toEqual(['assets/theme-sync.json']);
      const marker = JSON.parse(text(files, 'assets/theme-sync.json')!);
      expect(marker).toMatchObject({ app: 'Theme Sync', lastSyncedUpdate: C3, description: 'Update cart functionality', themeRole: 'Staging' });
      expect(marker.syncedBy).toBeUndefined();

      // Every changed file was backed up first (KV), and files that did not exist are recorded as such.
      const detail = await get(run.id);
      expect(detail.files.find((f) => f.path === 'sections/cart.liquid')?.backup).toBe('saved');
      expect(detail.files.find((f) => f.path === 'snippets/cart-item.liquid')?.backup).toBe('absent');
      // 3 updated + 2 removed files; new files and the (absent) marker need no copy.
      expect([...t.kv.store.keys()].filter((k) => k.startsWith('backup:'))).toHaveLength(5);

      const overview = (await api<OverviewResponse>('GET', '/api/overview')).body.data;
      expect(overview.staging).toMatchObject({ waiting: 0, lastSynced: { sha: C3 } });
      expect(overview.publishable?.sha).toBe(C3);
      expect(overview.live.waiting).toBe(2);
      expect(detail.actions.canPublish).toBe(true);
    });

    it('allows one update at a time per theme', async () => {
      await setup();
      const first = (await plan({ kind: 'update', targetSha: C3 })).body.data;
      const second = (await plan({ kind: 'update', targetSha: C2 })).body.data;
      expect((await api('POST', `/api/updates/${first.id}/confirm`, {})).status).toBe(202);
      const res = await api('POST', `/api/updates/${second.id}/confirm`, {});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('UPDATE_IN_PROGRESS');
    });

    it('a review made before another update finished is stale', async () => {
      await setup();
      const stale = (await plan({ kind: 'update', targetSha: C3 })).body.data;
      await updateStagingTo(C2);
      const res = await api('POST', `/api/updates/${stale.id}/confirm`, {});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PREVIEW_EXPIRED');
    });

    it('runs inline via waitUntil when no queue is bound', async () => {
      await setup({ withQueue: false });
      const { body } = await plan({ kind: 'update', targetSha: C3 });
      await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      await t.ctx.flush();
      expect((await get(body.data.id)).status).toBe('succeeded');
    });

    it('fails clearly when Shopify denies theme writes (no exemption)', async () => {
      await setup({ world: { denyWrites: true } });
      const run = await updateStagingTo(C3);
      expect(run.status).toBe('failed');
      expect(run.errorDetails?.code).toBe('THEME_WRITE_NOT_PERMITTED');
    });
  });

  describe('incomplete updates', () => {
    it('keeps the previous last synced update, then retries only the failed files', async () => {
      const reject = new Set(['sections/cart.liquid']);
      await setup({ world: { rejectUpserts: reject } });
      let run = await updateStagingTo(C3);
      expect(run).toMatchObject({ status: 'partially_failed', progress: { succeeded: 7, failed: 1 } });
      expect(run.actions).toMatchObject({ canRetry: true, canRerun: true, canRestore: true, canPublish: false });
      expect(run.files.find((f) => f.path === 'sections/cart.liquid')).toMatchObject({ status: 'failed', errorKind: 'other' });
      expect(staging().has('assets/theme-sync.json')).toBe(false);
      const options = (await api<PublishOptionsResponse>('GET', '/api/updates/publish-options')).body.data;
      expect(options).toMatchObject({ verified: true, update: { sha: C1 } }); // Staging still on C1

      reject.clear();
      const before = world.upserts.length;
      expect((await api('POST', `/api/updates/${run.id}/retry`, {})).status).toBe(202);
      await drainQueue();
      run = await get(run.id);
      expect(run).toMatchObject({ status: 'succeeded', attempt: 2 });
      const retried = world.upserts.slice(before).flatMap((u) => u.files.map((f) => f.filename));
      expect(retried).toEqual(['sections/cart.liquid', 'assets/theme-sync.json']);
    });

    it('flags files with code errors as needing a developer fix', async () => {
      await setup();
      // A file beyond the planning check is still checked before it is written.
      world.addCommit('5'.repeat(40), 'Sneaky', (files) => ({ ...files, 'snippets/x.liquid': '{% if a %}' }));
      t.sqlite.exec('UPDATE theme_states SET last_synced_sha = NULL');
      const { body } = await plan({ kind: 'update', targetSha: '5'.repeat(40) });
      expect(body.data.checks?.code.status).toBe('failed');
    });

    it('restores the backup: modified files come back and new files are removed', async () => {
      await setup();
      const run = await updateStagingTo(C3);
      const restore = await api<UpdateRun>('POST', `/api/updates/${run.id}/restore`, {});
      expect(restore.status).toBe(201);
      expect(restore.body.data).toMatchObject({ kind: 'restore', status: 'previewed', target: { sha: C1 } });
      await api('POST', `/api/updates/${restore.body.data.id}/confirm`, {});
      await drainQueue();
      expect((await get(restore.body.data.id)).status).toBe('succeeded');

      const files = staging();
      expect(text(files, 'sections/cart.liquid')).toBe(REPO_FILES.C1['sections/cart.liquid']);
      expect(text(files, 'snippets/old-cart.liquid')).toBe(REPO_FILES.C1['snippets/old-cart.liquid']);
      expect(files.has('snippets/cart-item.liquid')).toBe(false);
      expect(files.has('assets/theme-sync.json')).toBe(false); // it did not exist before
      const overview = (await api<OverviewResponse>('GET', '/api/overview')).body.data;
      expect(overview.staging.lastSynced?.sha).toBe(C1);
    });
  });

  describe('publishing to Live', () => {
    it('only Staging-verified updates can be published', async () => {
      await setup();
      const res = await plan({ kind: 'publish', targetSha: C3, themeId: THEME_LIVE.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NOT_VERIFIED_ON_STAGING');
    });

    it('publishes the verified update to the selected Live theme and records it', async () => {
      await setup();
      await updateStagingTo(C3);
      const options = (await api<PublishOptionsResponse>('GET', '/api/updates/publish-options')).body.data;
      expect(options).toMatchObject({ verified: true, update: { sha: C3 }, defaultThemeId: THEME_LIVE.id });
      expect(options.themes.map((o) => o.theme.id)).toEqual([THEME_LIVE.id, THEME_OTHER.id]); // Staging is not offered

      const { status, body } = await plan({ kind: 'publish', targetSha: C3, themeId: THEME_LIVE.id });
      expect(status).toBe(201);
      expect(body.data).toMatchObject({ kind: 'publish', line: 'live', base: { sha: C1 }, verifiedOnStagingAt: expect.any(String) });
      expect(body.data.checks?.directEdits.status).toBe('passed');
      await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      await drainQueue();

      expect(text(live(), 'sections/cart.liquid')).toBe(REPO_FILES.C3['sections/cart.liquid']);
      expect(JSON.parse(text(live(), 'assets/theme-sync.json')!)).toMatchObject({ lastSyncedUpdate: C3, themeRole: 'Live' });
      const history = (await api<Paginated<UpdateRun>>('GET', '/api/history')).body.data;
      expect(history.items.map((r) => [r.kind, r.line, r.status])).toEqual([
        ['publish', 'live', 'succeeded'],
        ['update', 'staging', 'succeeded'],
      ]);
    });

    it('never sends new updates straight to the published theme', async () => {
      await setup();
      const res = await plan({ kind: 'rollback', targetSha: C3, line: 'live' });
      expect(res.status).toBe(422);
    });
  });

  describe('going back to an earlier version', () => {
    it('undoes every change made after the selected update', async () => {
      await setup();
      await updateStagingTo(C3);
      const { status, body } = await plan({ kind: 'rollback', targetSha: C2, line: 'staging' });
      expect(status).toBe(201);
      expect(body.data).toMatchObject({ direction: 'backward', commits: [{ sha: C3 }] });
      await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      await drainQueue();
      const files = staging();
      expect(text(files, 'sections/cart.liquid')).toBe(REPO_FILES.C2['sections/cart.liquid']);
      expect(text(files, 'snippets/old-cart.liquid')).toBe(REPO_FILES.C2['snippets/old-cart.liquid']);
      expect(files.has('snippets/cart-item.liquid')).toBe(false);
      expect(files.has('snippets/size-chart.liquid')).toBe(true);
      expect(JSON.parse(text(files, 'assets/theme-sync.json')!).lastSyncedUpdate).toBe(C2);
    });

    it('an older update cannot be applied as a new update', async () => {
      await setup();
      await updateStagingTo(C3);
      const res = await plan({ kind: 'update', targetSha: C2 });
      expect(res.status).toBe(422);
    });
  });

  describe('themes without a last synced update', () => {
    it('can record the update a theme already runs without changing files', async () => {
      await setup({ seed: { themes: false } });
      await api('PUT', '/api/settings', { stagingThemeId: THEME_DEV.id, liveThemeId: THEME_LIVE.id });
      const res = await api<UpdateRun>('POST', '/api/updates/baseline', { line: 'staging', sha: C1 });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ kind: 'baseline', status: 'succeeded' });
      // Only the sync file is written, so a duplicate of the theme keeps the record.
      expect(world.upserts.flatMap((u) => u.files.map((f) => f.filename))).toEqual(['assets/theme-sync.json']);
      expect(JSON.parse(text(staging(), 'assets/theme-sync.json')!)).toMatchObject({ lastSyncedUpdate: C1, branch: 'main' });
      expect((await api('POST', '/api/updates/baseline', { line: 'staging', sha: C2 })).status).toBe(409);
    });

    it('imports the last synced update from assets/theme-sync.json (e.g. a duplicated theme)', async () => {
      await setup({ seed: { themes: false } });
      world.editInShopify(SHOP, THEME_DEV.id, 'assets/theme-sync.json', JSON.stringify({ lastSyncedUpdate: C2, description: 'Update product template' }));
      await api('PUT', '/api/settings', { stagingThemeId: THEME_DEV.id });
      const overview = (await api<OverviewResponse>('GET', '/api/overview')).body.data;
      expect(overview.staging.lastSynced).toMatchObject({ sha: C2, verifiedOnStagingAt: null });
      expect(overview.staging.waiting).toBe(1);
    });

    it('a first update applies the complete theme and removes nothing', async () => {
      await setup({ seed: { themes: false } });
      await api('PUT', '/api/settings', { stagingThemeId: THEME_DEV.id });
      staging().set('snippets/custom.liquid', { type: 'TEXT', value: 'x', updatedAt: '2026-01-01T00:00:00Z' });
      const { body } = await plan({ kind: 'update', targetSha: C3 });
      expect(body.data).toMatchObject({ direction: 'initial', totals: { removed: 0 } });
      expect(body.data.checks?.directEdits.status).toBe('skipped');
    });
  });

  describe('every theme', () => {
    it('lists all themes with their line and last synced update (read from assets/theme-sync.json)', async () => {
      await setup();
      world.editInShopify(SHOP, THEME_OTHER.id, 'assets/theme-sync.json', JSON.stringify({ lastSyncedUpdate: C2, description: 'Update product template' }));
      const { body } = await api<ThemeOverviewItem[]>('GET', '/api/themes/overview');
      const rows = Object.fromEntries(body.data.map((i) => [i.theme.name, [i.line, i.lastSynced?.sha ?? null]]));
      expect(rows).toEqual({ Staging: ['staging', C1], Live: ['live', C1], 'Holiday 2026': ['other', C2] });
      const one = await api<ThemeOverviewItem>('GET', '/api/themes/333');
      expect(one.body.data).toMatchObject({ theme: { name: 'Holiday 2026' }, lastSynced: { sha: C2 } });
    });

    it('applies a commit of a chosen branch to any unpublished theme, like the old flow', async () => {
      await setup();
      const list = await api<UpdatesResponse>('GET', `/api/updates?themeId=333&branch=main`);
      expect(list.body.data).toMatchObject({ line: 'other', theme: { name: 'Holiday 2026' }, branch: 'main', current: null });
      expect(list.body.data.items.every((i) => i.state === 'new')).toBe(true);

      // No last synced update yet: record the one it runs, then update it.
      await api('POST', '/api/updates/baseline', { line: 'other', themeId: THEME_OTHER.id, sha: C1 });
      const planned = await plan({ kind: 'update', targetSha: C3, themeId: THEME_OTHER.id, branch: 'main' });
      expect(planned.status).toBe(201);
      expect(planned.body.data).toMatchObject({ line: 'other', branch: 'main', theme: { name: 'Holiday 2026' }, base: { sha: C1 } });
      await api('POST', `/api/updates/${planned.body.data.id}/confirm`, {});
      await drainQueue();
      const files = world.theme(SHOP, THEME_OTHER.id);
      expect(text(files, 'sections/cart.liquid')).toBe(REPO_FILES.C3['sections/cart.liquid']);
      expect(JSON.parse(text(files, 'assets/theme-sync.json')!)).toMatchObject({ lastSyncedUpdate: C3, themeRole: 'Theme' });
      // Staging and Live are untouched; a commit fully tested on any unpublished theme can be published.
      expect(text(staging(), 'sections/cart.liquid')).toBe(REPO_FILES.C1['sections/cart.liquid']);
      const liveList = (await api<UpdatesResponse>('GET', `/api/updates?themeId=222`)).body.data;
      expect(liveList.items.find((i) => i.sha === C3)).toMatchObject({ verified: true, applied: false, state: 'new' });
      const publish = await plan({ kind: 'publish', targetSha: C3 });
      expect(publish.status).toBe(201);
      expect(publish.body.data.theme.id).toBe(THEME_LIVE.id);
    });

    it('tags commits already added to the theme and filters its history by branch', async () => {
      await setup();
      await updateStagingTo(C2);
      const list = (await api<UpdatesResponse>('GET', `/api/updates?themeId=${encodeURIComponent(THEME_DEV.id)}&branch=main`)).body.data;
      expect(list.items.map((i) => [i.shortSha, i.state, i.applied])).toEqual([
        [C3.slice(0, 7), 'new', false],
        [C2.slice(0, 7), 'current', true],
        [C1.slice(0, 7), 'older', false],
      ]);
      const onMain = (await api<Paginated<UpdateRun>>('GET', `/api/history?themeId=111&branch=main`)).body.data;
      expect(onMain.items.map((r) => r.target?.sha)).toEqual([C2]);
      const onOther = (await api<Paginated<UpdateRun>>('GET', `/api/history?themeId=111&branch=feature`)).body.data;
      expect(onOther.items).toEqual([]);
      expect((await api('GET', `/api/updates?themeId=111&branch=${encodeURIComponent('main (store branch)')}`)).status).toBe(400);
    });

    it('the published theme cannot receive a commit directly', async () => {
      await setup();
      const res = await plan({ kind: 'update', targetSha: C3, themeId: THEME_LIVE.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NOT_VERIFIED_ON_STAGING');
    });
  });

  describe('review choices and the sync file', () => {
    it('skips files and turns deletions off like the earlier flow; checks follow the selection', async () => {
      await setup();
      world.addCommit('4'.repeat(40), 'Broken cart', (files) => ({ ...files, 'sections/cart.liquid': '{% if cart %}' }));
      const { body } = await plan({ kind: 'update', targetSha: '4'.repeat(40) });
      expect(body.data.actions.blockedByCodeErrors).toBe(true);

      const sel = await api<UpdateRun>('POST', `/api/updates/${body.data.id}/selection`, {
        allowDeletes: false,
        skippedPaths: ['sections/cart.liquid'],
      });
      expect(sel.status).toBe(200);
      expect(sel.body.data).toMatchObject({
        selection: { allowDeletes: false, skippedPaths: ['sections/cart.liquid'] },
        actions: { blockedByCodeErrors: false, canConfirm: true },
        totals: { removed: 0 },
      });
      const detail = await get(body.data.id);
      expect(detail.files.find((f) => f.path === 'snippets/old-cart.liquid')).toMatchObject({ status: 'skipped', skipReason: 'Deletions turned off' });
      expect(detail.files.find((f) => f.path === 'sections/cart.liquid')).toMatchObject({ status: 'skipped', skipReason: 'Skipped by you' });

      await api('POST', `/api/updates/${body.data.id}/confirm`, {});
      await drainQueue();
      expect((await get(body.data.id)).status).toBe('succeeded');
      expect(text(staging(), 'sections/cart.liquid')).toBe(REPO_FILES.C1['sections/cart.liquid']); // skipped
      expect(staging().has('snippets/old-cart.liquid')).toBe(true); // not deleted
      expect(text(staging(), 'snippets/cart-item.liquid')).toBe(REPO_FILES.C3['snippets/cart-item.liquid']);
    });

    it('shows the theme\u2019s sync file and the branch of the last sync; can save the file again', async () => {
      await setup();
      await updateStagingTo(C2);
      let theme = (await api<ThemeOverviewItem>('GET', '/api/themes/111')).body.data;
      expect(theme.lastSynced).toMatchObject({ sha: C2, branch: 'main' });
      expect(theme.syncFile).toMatchObject({ path: 'assets/theme-sync.json', present: true, sha: C2, branch: 'main', matchesRecord: true });

      staging().delete('assets/theme-sync.json');
      theme = (await api<ThemeOverviewItem>('GET', '/api/themes/111')).body.data;
      expect(theme.syncFile).toMatchObject({ present: false, matchesRecord: false });
      expect((await api('POST', '/api/themes/111/sync-file', {})).status).toBe(200);
      expect(JSON.parse(text(staging(), 'assets/theme-sync.json')!)).toMatchObject({ lastSyncedUpdate: C2, branch: 'main' });
    });
  });

  describe('commits page', () => {
    it('lists commits with changed-file counts by status', async () => {
      await setup();
      const res = await api<Paginated<CommitListItem>>('GET', '/api/commits?branch=main&withFiles=1');
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((i) => [i.shortSha, i.authorName, i.fileStats])).toEqual([
        [C3.slice(0, 7), 'Dev', { total: 5, added: 2, modified: 2, renamed: 0, removed: 1, truncated: false }],
        [C2.slice(0, 7), 'Dev', { total: 4, added: 1, modified: 2, renamed: 0, removed: 1, truncated: false }],
        [C1.slice(0, 7), 'Dev', { total: 10, added: 10, modified: 0, renamed: 0, removed: 0, truncated: false }],
      ]);
    });
  });

  describe('settings', () => {
    it('Staging must be unpublished and different from Live', async () => {
      await setup();
      expect((await api('PUT', '/api/settings', { stagingThemeId: THEME_LIVE.id, liveThemeId: THEME_DEV.id })).status).toBe(422);
      expect((await api('PUT', '/api/settings', { liveThemeId: THEME_DEV.id })).status).toBe(422);
    });

    it('Test connection checks GitHub, Shopify and theme write access without changing anything', async () => {
      await setup();
      const res = await api<{ github: { ok: boolean }; shopify: { ok: boolean }; themeWrites: { allowed: boolean } }>('POST', '/api/settings/test', {});
      expect(res.body.data).toMatchObject({ github: { ok: true }, shopify: { ok: true }, themeWrites: { allowed: true } });
      expect(world.upserts).toHaveLength(0);
    });

    it('Test connection reports a missing theme-modification exemption', async () => {
      await setup({ world: { denyWrites: true } });
      const res = await api<{ themeWrites: { allowed: boolean; message: string } }>('POST', '/api/settings/test', {});
      expect(res.body.data.themeWrites).toMatchObject({ allowed: false, message: expect.stringMatching(/exemption/) });
    });
  });
});
