/**
 * "4. Updating your theme, step by step" (client guide):
 *   1 choose a theme (last update per theme)   2 choose an update (New / Last synced / Added)
 *   3 automatic checks                          4 review (current, updating to, updates included)
 *   5 confirm → backup, then update             6 result + last synced commit per theme and branch
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitsResponse, LastSynced, Paginated, SyncPreview, SyncRun, SyncRunDetail } from '../../shared/api-types';
import { app } from '../../worker/index';
import { createLogger } from '../../worker/lib/logger';
import { handleSyncMessage } from '../../worker/sync/dispatch';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { graphqlHandler, installFetchMock, json } from '../helpers/fetch-mock';
import { seedShop, THEME_DEV, THEME_LIVE } from '../helpers/fixtures';

const SHOP = 'alpha.myshopify.com';
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const C3 = '3'.repeat(40);
const blobSha = (s: string) => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

type Files = Record<string, string>;
const F1: Files = {
  'layout/theme.liquid': '<html>{{ content_for_layout }}</html>',
  'sections/cart.liquid': '{% if cart %}<ul></ul>{% endif %}',
  'assets/cart.css': '.cart{color:red}',
  'snippets/old-cart.liquid': '<div>old</div>',
};
const F2: Files = { ...F1, 'snippets/size-chart.liquid': '<table></table>' };
const F3: Files = { ...F2, 'sections/cart.liquid': '{% for i in cart.items %}{% render "cart-item" %}{% endfor %}', 'snippets/cart-item.liquid': '<li></li>' };
delete F3['snippets/old-cart.liquid'];

function world() {
  const history = [
    { sha: C1, message: 'Add custom CSS', files: F1 },
    { sha: C2, message: 'Update product template', files: F2 },
    { sha: C3, message: 'Update cart functionality', files: F3 },
  ];
  const theme = new Map<string, { value: string; updatedAt: string }>(
    Object.entries(F1).map(([k, v]) => [k, { value: v, updatedAt: '2026-10-01T00:00:00Z' }]),
  );
  const upserts: string[][] = [];
  const mock = installFetchMock();
  const raw = (c: (typeof history)[number]) => ({
    sha: c.sha,
    html_url: '',
    commit: { message: c.message, author: { name: 'Dev', date: '2026-10-04T00:00:00Z' }, committer: null, tree: { sha: `tree-${c.sha}` } },
    author: { login: 'dev', avatar_url: '' },
    parents: history.indexOf(c) > 0 ? [{ sha: history[history.indexOf(c) - 1]!.sha }] : [],
  });
  mock.on((req) => {
    const url = new URL(req.url);
    if (url.hostname !== 'api.github.com') return undefined;
    const p = url.pathname;
    if (p === '/repos/acme/theme/commits') {
      const ref = url.searchParams.get('sha') ?? 'main';
      const end = ref === 'main' ? history.length : history.findIndex((c) => c.sha === ref) + 1;
      return json(history.slice(0, end).reverse().map(raw));
    }
    let m = /^\/repos\/acme\/theme\/commits\/(\w{40})$/.exec(p);
    if (m) {
      const c = history.find((h) => h.sha === m![1])!;
      const parent = history[history.indexOf(c) - 1]?.files ?? {};
      const files = [
        ...Object.entries(c.files)
          .filter(([k, v]) => parent[k] !== v)
          .map(([k, v]) => ({ filename: k, status: parent[k] === undefined ? 'added' : 'modified', sha: blobSha(v), additions: 1, deletions: 0, changes: 1 })),
        ...Object.keys(parent)
          .filter((k) => !(k in c.files))
          .map((k) => ({ filename: k, status: 'removed', sha: null, additions: 0, deletions: 1, changes: 1 })),
      ];
      return json({ ...raw(c), files });
    }
    m = /^\/repos\/acme\/theme\/git\/trees\/tree-(\w{40})$/.exec(p);
    if (m) {
      const c = history.find((h) => h.sha === m![1])!;
      return json({ tree: Object.entries(c.files).map(([path, v]) => ({ path, mode: '100644', type: 'blob', sha: blobSha(v), size: v.length })), truncated: false });
    }
    m = /^\/repos\/acme\/theme\/git\/blobs\/(\w{40})$/.exec(p);
    if (m) {
      const content = history.flatMap((h) => Object.values(h.files)).find((v) => blobSha(v) === m![1])!;
      return json({ content: Buffer.from(content).toString('base64'), encoding: 'base64' });
    }
    m = /^\/repos\/acme\/theme\/contents\/(.+)$/.exec(p);
    if (m) {
      const content = history.find((h) => h.sha === url.searchParams.get('ref'))?.files[decodeURIComponent(m[1]!)];
      return content === undefined ? json({ message: 'Not Found' }, { status: 404 }) : new Response(content);
    }
    return undefined;
  });
  const node = (n: string) => ({ filename: n, size: String(theme.get(n)!.value.length), checksumMd5: md5(theme.get(n)!.value), updatedAt: theme.get(n)!.updatedAt });
  mock.on(
    graphqlHandler({
      AceTheme: (v) => ({ theme: [THEME_DEV, THEME_LIVE].find((t) => t.id === v.id) ?? null }),
      AceThemes: () => ({ themes: { nodes: [THEME_DEV, THEME_LIVE], pageInfo: { hasNextPage: false, endCursor: null } } }),
      AceThemeFiles: (v) => ({
        theme: {
          id: v.id,
          files: { nodes: ((v.filenames as string[] | null) ?? [...theme.keys()]).filter((n) => theme.has(n)).map(node), pageInfo: { hasNextPage: false, endCursor: null } },
        },
      }),
      AceThemeFileBodies: (v) => ({
        theme: { id: v.id, files: { nodes: (v.filenames as string[]).filter((n) => theme.has(n)).map((n) => ({ filename: n, body: { content: theme.get(n)!.value } })) } },
      }),
      AceThemeFilesUpsert: (v) => {
        const files = v.files as { filename: string; body: { value: string } }[];
        upserts.push(files.map((f) => f.filename));
        for (const f of files) theme.set(f.filename, { value: f.body.value, updatedAt: '2026-10-10T00:00:00Z' });
        return { themeFilesUpsert: { upsertedThemeFiles: files.map((f) => ({ filename: f.filename })), job: null, userErrors: [] } };
      },
      AceThemeFilesDelete: (v) => {
        const files = v.files as string[];
        for (const f of files) theme.delete(f);
        return { themeFilesDelete: { deletedThemeFiles: files.map((filename) => ({ filename })), userErrors: [] } };
      },
    }),
  );
  return { theme, upserts, history };
}

describe('updating a theme, step by step', () => {
  let t: TestContext;
  let w: ReturnType<typeof world>;
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    t = createTestEnv();
    w = world();
    await seedShop(t.env, SHOP);
  }
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      { method, headers: { Authorization: `Bearer ${await sessionToken(SHOP)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
      t.env,
      t.ctx,
    );
    return { status: res.status, body: (await res.json()) as { data: T; error: { code: string } } };
  };
  async function drain() {
    const logger = createLogger('error');
    while (t.queue.sent.length) {
      const msg = t.queue.sent.shift()!;
      if ((await handleSyncMessage(t.env, msg.body, logger)) !== null) t.queue.sent.push(msg);
    }
  }
  async function sync(sha: string, extra: Record<string, unknown> = {}, confirm: Record<string, unknown> = {}) {
    const preview = await api<SyncPreview>('POST', '/api/sync/preview', { commitSha: sha, themeId: THEME_DEV.id, branch: 'main', ...extra });
    expect(preview.status).toBe(201);
    const run = await api<SyncRun>('POST', '/api/sync', { syncId: preview.body.data.syncId, confirm: true, ...confirm });
    await drain();
    return { preview: preview.body.data, run: run.body.data, confirmStatus: run.status };
  }

  it('records the last synced commit per theme and branch, and labels commits New / Last synced / Added', async () => {
    await setup();
    await sync(C1, { strategy: 'commit_changes' });
    const last = (await api<Record<string, LastSynced>>('GET', '/api/themes/last-synced')).body.data;
    expect(last[THEME_DEV.id]).toMatchObject({ sha: C1, branch: 'main', message: 'Add custom CSS' });
    expect(JSON.parse(w.theme.get('assets/theme-sync.json')!.value)).toMatchObject({ lastSyncedUpdate: C1, branch: 'main' });

    const list = (await api<CommitsResponse>('GET', `/api/commits?branch=main&themeId=${encodeURIComponent(THEME_DEV.id)}`)).body.data;
    expect(list).toMatchObject({ waiting: 2, lastSynced: { sha: C1 } });
    expect(list.items.map((i) => [i.shortSha, i.syncStatus])).toEqual([
      ['3333333', 'new'],
      ['2222222', 'new'],
      ['1111111', 'last_synced'],
    ]);
  });

  it('catches up: the newest update brings every waiting update; review lists them; backup then update', async () => {
    await setup();
    await sync(C1, { strategy: 'commit_changes' });
    const { preview } = await sync(C3, { strategy: 'since_last_sync', allowDeletes: true });
    expect(preview.base).toMatchObject({ sha: C1, message: 'Add custom CSS' });
    expect(preview.commitsIncluded.map((c) => c.sha)).toEqual([C2, C3]);
    expect(preview.checks).toMatchObject({ code: { status: 'passed' }, directEdits: { status: 'passed' } });
    expect(preview.summary).toMatchObject({ creates: 2, updates: 1, deletes: 1 });

    expect(w.theme.get('sections/cart.liquid')!.value).toBe(F3['sections/cart.liquid']);
    expect(w.theme.has('snippets/old-cart.liquid')).toBe(false);
    expect(w.upserts.at(-1)).toEqual(['assets/theme-sync.json']); // written last
    // Backup of the theme's version saved before the change.
    const backup = JSON.parse((await t.kv.get([...t.kv.store.keys()].find((k) => k.includes(preview.syncId) && k.endsWith('sections/cart.liquid'))!))!);
    expect(backup).toMatchObject({ type: 'TEXT', value: F1['sections/cart.liquid'] });

    const detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${preview.syncId}`)).body.data;
    expect(detail).toMatchObject({ status: 'succeeded', baseSha: C1, backedUp: 4 });
    const list = (await api<CommitsResponse>('GET', `/api/commits?branch=main&themeId=${encodeURIComponent(THEME_DEV.id)}`)).body.data;
    expect(list.items.map((i) => i.syncStatus)).toEqual(['last_synced', 'added', 'added']);
  });

  it('warns about files edited directly in Shopify and asks before replacing them', async () => {
    await setup();
    await sync(C1, { strategy: 'commit_changes' });
    w.theme.set('sections/cart.liquid', { value: '<edited in shopify>', updatedAt: '2026-10-05T09:00:00Z' });
    const preview = (await api<SyncPreview>('POST', '/api/sync/preview', { commitSha: C3, themeId: THEME_DEV.id, branch: 'main', strategy: 'since_last_sync' })).body.data;
    expect(preview.checks.directEdits).toMatchObject({ status: 'warning', files: [{ path: 'sections/cart.liquid', updatedAt: '2026-10-05T09:00:00Z' }] });
    const refused = await api('POST', '/api/sync', { syncId: preview.syncId, confirm: true });
    expect(refused.body.error.code).toBe('DIRECT_EDITS_FOUND');
    expect((await api('POST', '/api/sync', { syncId: preview.syncId, confirm: true, acceptDirectEdits: true })).status).toBe(202);
  });

  it('blocks code errors before they reach Shopify', async () => {
    await setup();
    w.history.push({ sha: '4'.repeat(40), message: 'Broken', files: { ...F3, 'sections/cart.liquid': '{% if cart %}' } });
    const preview = (await api<SyncPreview>('POST', '/api/sync/preview', { commitSha: '4'.repeat(40), themeId: THEME_DEV.id, branch: 'main', strategy: 'commit_changes' })).body.data;
    expect(preview.checks.code).toMatchObject({ status: 'failed', issues: [{ path: 'sections/cart.liquid' }] });
    const res = await api('POST', '/api/sync', { syncId: preview.syncId, confirm: true });
    expect(res.body.error.code).toBe('CODE_ERRORS');
    expect(w.upserts).toHaveLength(0);
  });

  it('shows the sync history of the selected theme and branch', async () => {
    await setup();
    await sync(C1, { strategy: 'commit_changes' });
    const onMain = (await api<Paginated<SyncRun>>('GET', `/api/sync/history?themeId=111&branch=main`)).body.data;
    expect(onMain.items.map((r) => r.commitSha)).toEqual([C1]);
    expect((await api<Paginated<SyncRun>>('GET', `/api/sync/history?themeId=111&branch=feature`)).body.data.items).toEqual([]);
    expect((await api<Paginated<SyncRun>>('GET', `/api/sync/history?themeId=222`)).body.data.items).toEqual([]);
  });
});
