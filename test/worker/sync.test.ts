import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYNC_PREFERENCES, type CommitFile, type SyncPreview, type SyncRun, type SyncRunDetail } from '../../shared/api-types';
import { app } from '../../worker/index';
import { getDb, getSyncRun } from '../../worker/lib/database';
import { createLogger } from '../../worker/lib/logger';
import { handleSyncMessage } from '../../worker/sync/dispatch';
import { planCommitChanges } from '../../worker/sync/planner';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { seedMapping, seedShop, SHA_B, THEME_DEV, THEME_LIVE } from '../helpers/fixtures';
import { installWorld, PNG, REPO, type WorldOptions } from '../helpers/sync-world';

const SHOP = 'alpha.myshopify.com';
const logger = createLogger('error');

const file = (filename: string, status: CommitFile['status'], previousFilename: string | null = null): CommitFile => ({
  filename,
  previousFilename,
  status,
  additions: 0,
  deletions: 0,
  changes: 0,
  blobSha: status === 'removed' ? null : 'a'.repeat(40),
  themePath: null,
  themePathError: null,
});

describe('planCommitChanges', () => {
  const files = [
    file('sections/header.liquid', 'modified'),
    file('snippets/new.liquid', 'renamed', 'snippets/old.liquid'),
    file('snippets/gone.liquid', 'removed'),
    file('layout/theme.liquid', 'removed'),
    file('config/settings_data.json', 'modified'),
    file('README.md', 'added'),
    file('sections/../../x.liquid', 'added'),
  ];

  it('plans upserts, keeps deletions off by default, and explains every skip', () => {
    const { ops, warnings } = planCommitChanges(files, DEFAULT_SYNC_PREFERENCES, false);
    const by = Object.fromEntries(ops.map((o) => [o.path, o]));
    expect(by['sections/header.liquid']).toMatchObject({ action: 'upsert', changeType: 'modified' });
    expect(by['snippets/new.liquid']).toMatchObject({ action: 'upsert', previousPath: 'snippets/old.liquid' });
    expect(by['snippets/old.liquid']).toMatchObject({ action: 'skip', skipReason: /Deletions are disabled/ });
    expect(by['snippets/gone.liquid']).toMatchObject({ action: 'skip' });
    expect(by['layout/theme.liquid']).toMatchObject({ action: 'skip', skipReason: /Protected/ });
    expect(by['config/settings_data.json']).toMatchObject({ action: 'skip', skipReason: /ignore pattern/ });
    expect(by['README.md']).toMatchObject({ action: 'skip', skipReason: /Not a Shopify theme file/ });
    expect(by['sections/../../x.liquid']).toMatchObject({ action: 'skip', skipReason: /traversal/ });
    expect(warnings.join(' ')).toMatch(/2 file\(s\) were removed/);
  });

  it('plans deletions only when allowed, never for protected files', () => {
    const { ops } = planCommitChanges(files, DEFAULT_SYNC_PREFERENCES, true);
    const by = Object.fromEntries(ops.map((o) => [o.path, o]));
    expect(by['snippets/old.liquid']?.action).toBe('delete');
    expect(by['snippets/gone.liquid']?.action).toBe('delete');
    expect(by['layout/theme.liquid']?.action).toBe('skip');
  });

  it('applies the theme root and ignores files outside it', () => {
    const { ops } = planCommitChanges(
      [file('theme/sections/a.liquid', 'added'), file('docs/x.md', 'added')],
      { ...DEFAULT_SYNC_PREFERENCES, themeRoot: 'theme' },
      false,
    );
    expect(ops.find((o) => o.path === 'sections/a.liquid')?.sourcePath).toBe('theme/sections/a.liquid');
    expect(ops.find((o) => o.sourcePath === 'docs/x.md')?.skipReason).toMatch(/Outside theme root/);
  });

  it('lets an upsert win over a delete of the same path', () => {
    const { ops } = planCommitChanges(
      [file('snippets/b.liquid', 'renamed', 'snippets/a.liquid'), file('snippets/a.liquid', 'added')],
      DEFAULT_SYNC_PREFERENCES,
      true,
    );
    expect(ops.filter((o) => o.path === 'snippets/a.liquid')).toEqual([expect.objectContaining({ action: 'upsert' })]);
  });
});

describe('sync workflow', () => {
  let t: TestContext;
  let world: ReturnType<typeof installWorld>;
  let shopId: string;

  async function setup(options: { world?: WorldOptions; withQueue?: boolean } = {}) {
    t = createTestEnv({ withQueue: options.withQueue });
    world = installWorld(options.world);
    shopId = (await seedShop(t.env, SHOP)).id;
    await seedMapping(t.env, shopId, THEME_DEV, 'main');
  }
  afterEach(() => vi.unstubAllGlobals());

  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: { Authorization: `Bearer ${await sessionToken(SHOP)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      t.env,
      t.ctx,
    );
    return { status: res.status, body: (await res.json()) as { success: boolean; data: T; error: { code: string; message: string } } };
  };

  const preview = (body: Record<string, unknown>) =>
    api<SyncPreview>('POST', '/api/sync/preview', { commitSha: SHA_B, themeId: THEME_DEV.id, strategy: 'commit_changes', ...body });

  /** Drains the queue like the Cloudflare consumer would. */
  async function drainQueue() {
    for (let i = 0; i < 20 && t.queue.sent.length > 0; i++) {
      const msg = t.queue.sent.shift()!;
      const delay = await handleSyncMessage(t.env, msg.body, logger);
      if (delay !== null) t.queue.sent.push({ body: msg.body });
    }
  }

  describe('preview', () => {
    beforeEach(() => setup());

    it('builds a plan without modifying the theme', async () => {
      const { status, body } = await preview({});
      expect(status).toBe(201);
      // config/settings_data.json matches the default ignore pattern: counted as ignored, not skipped.
      expect(body.data.summary).toEqual({ creates: 2, updates: 1, deletes: 0, skipped: 4, ignored: 1, total: 8 });
      expect(body.data.requiresLiveConfirmation).toBe(false);
      const header = body.data.operations.find((o) => o.path === 'sections/header.liquid');
      expect(header).toMatchObject({ action: 'upsert', existsInTheme: true });

      // No write mutation reached Shopify.
      expect(world.mock.graphqlCalls().some((c) => /mutation/.test(c.query))).toBe(false);
      expect(world.upserts).toHaveLength(0);
      const run = await getSyncRun(getDb(t.env.DB), (t.sqlite.prepare('SELECT id FROM shops').get() as { id: string }).id, body.data.syncId);
      expect(run?.status).toBe('previewed');
    });

    it('rejects abbreviated SHAs and unknown themes', async () => {
      expect((await preview({ commitSha: 'bbbbbbb' })).status).toBe(400);
      // A theme that is not mapped to the branch cannot be synced at all…
      const unmapped = await preview({ themeId: 'gid://shopify/OnlineStoreTheme/999' });
      expect(unmapped.status).toBe(409);
      expect(unmapped.body.error.code).toBe('MAPPING_REQUIRED');
      // …and a mapped theme that was deleted in Shopify is reported as not found.
      await seedMapping(t.env, shopId, { id: 'gid://shopify/OnlineStoreTheme/999', name: 'Deleted' }, 'feature');
      const res = await preview({ themeId: 'gid://shopify/OnlineStoreTheme/999' });
      expect(res.status).toBe(404);
    });

    it('full sync uses the commit tree and deletes theme files missing in Git only when chosen', async () => {
      const { body } = await preview({ strategy: 'full_snapshot' });
      const paths = body.data.operations.filter((o) => o.action === 'upsert').map((o) => o.path).sort();
      expect(paths).toEqual(['assets/logo.png', 'layout/theme.liquid', 'sections/header.liquid', 'snippets/new.liquid']);
      expect(body.data.summary).toMatchObject({ deletes: 0, ignored: 1 });
      expect(body.data.operations.find((o) => o.path === 'snippets/old.liquid')).toMatchObject({
        action: 'skip',
        skipReason: 'Not in the repository; kept because deleting was not selected',
      });
      expect(body.data.warnings.join(' ')).toMatch(/not theme files/);
      expect(body.data.warnings.join(' ')).toMatch(/2 theme file\(s\) are not in the repository and stay unchanged/);

      const withDeletes = (await preview({ strategy: 'full_snapshot', allowDeletes: true })).body.data;
      expect(withDeletes.operations.filter((o) => o.action === 'delete').map((o) => o.path).sort()).toEqual([
        'snippets/gone.liquid',
        'snippets/old.liquid',
      ]);
      // layout/theme.liquid exists in Git; protected and ignored files are never deleted.
      expect(withDeletes.warnings.join(' ')).toMatch(/2 theme file\(s\) are not in the repository and will be DELETED/);
    });
  });

  describe('execution', () => {
    it('applies exactly the commit-B content, as TEXT and BASE64, and records success', async () => {
      await setup();
      const { body: p } = await preview({});
      const { status, body } = await api<SyncRun>('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      expect(status).toBe(202);
      expect(body.data.status).toBe('queued');
      expect(t.queue.sent).toHaveLength(1);

      await drainQueue();
      const files = world.themeFiles.get(THEME_DEV.id)!;
      expect(files.get('sections/header.liquid')).toBe(REPO[SHA_B]!['sections/header.liquid']); // B, not D
      expect(files.get('snippets/new.liquid')).toBe('new at B');
      const logo = world.upserts.flatMap((u) => u.files).find((f) => f.filename === 'assets/logo.png');
      expect(logo?.body).toEqual({ type: 'BASE64', value: PNG.toString('base64') });
      expect(files.has('config/settings_data.json')).toBe(false);

      const { body: detail } = await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`);
      expect(detail.data).toMatchObject({ status: 'succeeded', filesSucceeded: 3, filesFailed: 0, canRetry: false });
    });

    it('requires confirm: true and refuses to execute a preview twice', async () => {
      await setup();
      const { body: p } = await preview({});
      expect((await api('POST', '/api/sync', { syncId: p.data.syncId })).status).toBe(400);
      expect((await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true })).status).toBe(202);
      const again = await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      expect(again.status).toBe(409);
      expect(t.queue.sent).toHaveLength(1);
    });

    it('requires typed confirmation for the live theme', async () => {
      await setup();
      await seedMapping(t.env, shopId, THEME_LIVE, 'feature');
      const { body: p } = await preview({ themeId: THEME_LIVE.id });
      expect(p.data.requiresLiveConfirmation).toBe(true);
      const missing = await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      expect(missing.status).toBe(422);
      expect(missing.body.error.code).toBe('LIVE_THEME_CONFIRMATION_REQUIRED');
      const wrong = await api('POST', '/api/sync', {
        syncId: p.data.syncId,
        confirm: true,
        confirmLiveTheme: true,
        confirmThemeName: 'live theme',
      });
      expect(wrong.status).toBe(422);
      const ok = await api('POST', '/api/sync', {
        syncId: p.data.syncId,
        confirm: true,
        confirmLiveTheme: true,
        confirmThemeName: THEME_LIVE.name,
      });
      expect(ok.status).toBe(202);
    });

    it('rejects expired previews', async () => {
      await setup();
      const { body: p } = await preview({});
      t.sqlite.prepare('UPDATE sync_history SET preview_expires_at = 0 WHERE id = ?').run(p.data.syncId);
      const res = await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('PREVIEW_EXPIRED');
    });

    it('blocks a file whose bytes do not match the commit blob (integrity check) before anything changes', async () => {
      await setup({ world: { corrupt: 'sections/header.liquid' } });
      const { body: p } = await preview({});
      expect(p.data.checks.code.status).toBe('failed');
      expect(p.data.checks.code.issues[0]).toMatchObject({ path: 'sections/header.liquid', message: /integrity check failed/ });
      const res = await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CODE_ERRORS');
      expect(world.upserts).toHaveLength(0);
      expect(world.themeFiles.get(THEME_DEV.id)!.get('sections/header.liquid')).toBe('old');
    });

    it('records partial failures and retries only the failed files, idempotently', async () => {
      const reject = new Set(['sections/header.liquid']);
      await setup({ world: { rejectUpserts: reject } });
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      let detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail).toMatchObject({ status: 'partially_failed', filesSucceeded: 2, filesFailed: 1, canRetry: true });
      expect(detail.operations.find((o) => o.path === 'sections/header.liquid')?.error).toMatch(/Liquid syntax error/);

      reject.clear(); // the theme now accepts the file
      const upsertsBefore = world.upserts.length;
      const retry = await api<SyncRun>('POST', `/api/sync/history/${p.data.syncId}/retry`, {});
      expect(retry.status).toBe(202);
      await drainQueue();
      detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail).toMatchObject({ status: 'succeeded', filesFailed: 0, attempt: 2 });
      const retried = world.upserts.slice(upsertsBefore).flatMap((u) => u.files.map((f) => f.filename));
      // Only the failed file is written again; the sync record file comes last once everything succeeded.
      expect(retried).toEqual(['sections/header.liquid', 'assets/theme-sync.json']);
    });

    it('explains why files failed and restores the backup of an incomplete update', async () => {
      const reject = new Set(['sections/header.liquid']);
      await setup({ world: { rejectUpserts: reject } });
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      const theme = world.themeFiles.get(THEME_DEV.id)!;
      expect(theme.has('snippets/new.liquid')).toBe(true); // created by this update

      let detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail).toMatchObject({ status: 'partially_failed', canRestore: true, restoredAt: null, allowDeletes: false });
      expect(detail.operations.find((o) => o.path === 'sections/header.liquid')?.failure).toMatchObject({
        kind: 'code',
        reason: 'Code error — needs a fix from your developer',
      });
      expect(detail.operations.find((o) => o.path === 'assets/logo.png')?.failure).toBeNull();

      // A restore that cannot write every file says so and can be tried again.
      const partial = await api('POST', `/api/sync/history/${p.data.syncId}/restore`, {});
      expect(partial.status).toBe(502);
      expect((await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data).toMatchObject({ canRestore: true, restoredAt: null });

      reject.clear();
      const restored = await api<SyncRun>('POST', `/api/sync/history/${p.data.syncId}/restore`, {});
      expect(restored.status).toBe(200);
      expect(restored.body.data).toMatchObject({ canRestore: false, canRetry: false, restoredFiles: 3 });
      // Back exactly as before: the changed file has its old content, the files this update added are gone.
      expect(theme.get('sections/header.liquid')).toBe('old');
      expect(theme.has('snippets/new.liquid')).toBe(false);
      expect(theme.has('assets/logo.png')).toBe(false);
      expect(theme.has('snippets/old.liquid')).toBe(true);

      detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail.restoredAt).not.toBeNull();
      expect((await api('POST', `/api/sync/history/${p.data.syncId}/restore`, {})).status).toBe(409);
      expect((await api('POST', `/api/sync/history/${p.data.syncId}/retry`, {})).status).toBe(409);
    });

    it('reports progress file by file while the update runs', async () => {
      await setup({ withQueue: true }); // the queue is not drained: the run stays in progress
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      const writes = p.data.operations.filter((o) => o.action !== 'skip');
      // One file done, as after the first batch.
      t.sqlite.prepare(`UPDATE sync_operations SET status = 'succeeded' WHERE sync_id = ? AND path = ?`).run(p.data.syncId, writes[0]!.path);
      t.sqlite.prepare(`UPDATE sync_history SET status = 'running' WHERE id = ?`).run(p.data.syncId);
      const detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail).toMatchObject({ status: 'running', filesSucceeded: 1, filesFailed: 0, filesChanged: writes.length });
    });

    it('does not restore a completed update', async () => {
      await setup();
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      expect((await api('POST', `/api/sync/history/${p.data.syncId}/restore`, {})).status).toBe(409);
    });

    it('does not rewrite files that are already identical in the theme', async () => {
      await setup();
      const { body: p } = await preview({});
      // Someone already put the commit's version in the theme after the preview.
      world.themeFiles.get(THEME_DEV.id)!.set('sections/header.liquid', '<header>B</header>');
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      const detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail.status).toBe('succeeded');
      expect(detail.operations.find((o) => o.path === 'sections/header.liquid')).toMatchObject({
        status: 'skipped',
        skipReason: 'Already identical in the theme',
      });
      const written = world.upserts.flatMap((u) => u.files.map((f) => f.filename));
      expect(written).not.toContain('sections/header.liquid');
    });

    it('never modifies a file that matches an ignore pattern added after the preview', async () => {
      await setup();
      const { body: p } = await preview({});
      await api('PUT', '/api/settings', { syncPreferences: { ignorePatterns: ['config/settings_data.json', 'sections/'] } });
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      expect(world.themeFiles.get(THEME_DEV.id)!.get('sections/header.liquid')).toBe('old');
      const detail = (await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`)).body.data;
      expect(detail.operations.find((o) => o.path === 'sections/header.liquid')).toMatchObject({
        status: 'skipped',
        skipReason: 'Matches ignore pattern "sections/" (added after the preview)',
      });
      expect(detail.filesIgnored).toBe(2); // settings_data.json (preview) + header.liquid (at write time)
    });

    it('applies explicit deletions and treats already-missing files as deleted', async () => {
      await setup();
      world.themeFiles.get(THEME_DEV.id)!.delete('snippets/gone.liquid');
      const { body: p } = await preview({ allowDeletes: true });
      // gone.liquid is no longer in the theme → planned as skip; old.liquid → delete.
      expect(p.data.operations.find((o) => o.path === 'snippets/old.liquid')?.action).toBe('delete');
      expect(p.data.operations.find((o) => o.path === 'snippets/gone.liquid')?.action).toBe('skip');
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      expect(world.themeFiles.get(THEME_DEV.id)!.has('snippets/old.liquid')).toBe(false);
      expect(world.deletes.flatMap((d) => d.files)).toEqual(['snippets/old.liquid']);
    });

    it('fails the run clearly when Shopify denies theme writes (no exemption)', async () => {
      await setup({ world: { denyWrites: true } });
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await drainQueue();
      const { body } = await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`);
      expect(body.data.status).toBe('failed');
      expect(body.data.errorDetails?.code).toBe('THEME_WRITE_NOT_PERMITTED');
      expect(body.data.errorDetails?.message).toContain('Shopify said: Access denied for themeFilesUpsert field.');
    });

    it('runs inline via waitUntil when no queue is bound', async () => {
      await setup({ withQueue: false });
      const { body: p } = await preview({});
      await api('POST', '/api/sync', { syncId: p.data.syncId, confirm: true });
      await t.ctx.flush();
      const { body } = await api<SyncRunDetail>('GET', `/api/sync/history/${p.data.syncId}`);
      expect(body.data.status).toBe('succeeded');
    });

    it('prevents two concurrent syncs to the same theme', async () => {
      await setup();
      const first = (await preview({})).body.data;
      const second = (await preview({})).body.data;
      expect((await api('POST', '/api/sync', { syncId: first.syncId, confirm: true })).status).toBe(202);
      const res = await api('POST', '/api/sync', { syncId: second.syncId, confirm: true });
      expect(res.status).toBe(409);
    });
  });
});
