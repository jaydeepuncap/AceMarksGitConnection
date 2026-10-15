/**
 * Branch ↔ theme mappings: one theme per branch and one branch per theme,
 * enforced by the API and by the database; audit trail kept; syncs only go
 * to the theme mapped to the branch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncPreview, ThemeMapping, ThemeMappingsResponse } from '../../shared/api-types';
import { app } from '../../worker/index';
import { createMapping, getDb, isUniqueViolation } from '../../worker/lib/database';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { SHA_B, seedShop, THEME_DEV, THEME_LIVE } from '../helpers/fixtures';
import { installWorld } from '../helpers/sync-world';

const SHOP = 'alpha.myshopify.com';

describe('branch to theme mappings', () => {
  let t: TestContext;
  let shopId: string;
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    t = createTestEnv();
    installWorld();
    shopId = (await seedShop(t.env, SHOP)).id;
  }
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      { method, headers: { Authorization: `Bearer ${await sessionToken(SHOP)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
      t.env,
      t.ctx,
    );
    return { status: res.status, body: (await res.json()) as { data: T; error: { code: string; message: string } } };
  };
  const map = (branch: string, themeId: string) => api<ThemeMapping>('POST', '/api/mappings', { branch, themeId });

  it('maps a branch to a theme and lists it', async () => {
    await setup();
    const created = await map('main', THEME_DEV.id);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ repository: 'acme/theme', branch: 'main', themeId: THEME_DEV.id, themeName: THEME_DEV.name });
    const list = await api<ThemeMappingsResponse>('GET', '/api/mappings');
    expect(list.body.data.items).toHaveLength(1);
    // Mapping the same pair again changes nothing.
    expect((await map('main', THEME_DEV.id)).status).toBe(200);
  });

  it('allows one theme per branch and one branch per theme', async () => {
    await setup();
    await map('main', THEME_DEV.id);
    const sameBranch = await map('main', THEME_LIVE.id);
    expect(sameBranch.status).toBe(409);
    expect(sameBranch.body.error).toMatchObject({ code: 'MAPPING_CONFLICT' });
    expect(sameBranch.body.error.message).toMatch(/main branch is already mapped to Dev copy/);
    const sameTheme = await map('feature', THEME_DEV.id);
    expect(sameTheme.status).toBe(409);
    expect(sameTheme.body.error.message).toMatch(/already mapped to the main branch/);
    // A different branch and theme is fine.
    expect((await map('feature', THEME_LIVE.id)).status).toBe(201);
  });

  it('the database itself rejects a second active mapping (simultaneous requests)', async () => {
    await setup();
    const db = getDb(t.env.DB);
    const values = { repository: 'acme/theme', branch: 'main', themeId: THEME_DEV.id, themeName: 'Dev copy', createdBy: null };
    await createMapping(db, shopId, values);
    const sameBranch = await createMapping(db, shopId, { ...values, themeId: THEME_LIVE.id }).catch((e: unknown) => e);
    expect(isUniqueViolation(sameBranch)).toBe(true);
    const sameTheme = await createMapping(db, shopId, { ...values, branch: 'feature' }).catch((e: unknown) => e);
    expect(isUniqueViolation(sameTheme)).toBe(true);
  });

  it('rejects branches and themes that do not exist', async () => {
    await setup();
    expect((await map('no-such-branch', THEME_DEV.id)).status).toBe(404);
    expect((await map('main', 'gid://shopify/OnlineStoreTheme/999')).status).toBe(404);
  });

  it('changes and removes mappings only with confirmation and keeps the audit trail', async () => {
    await setup();
    const { body } = await map('main', THEME_DEV.id);
    expect((await api('DELETE', `/api/mappings/${body.data.id}`, {})).status).toBe(400); // confirm missing

    const changed = await api<ThemeMapping>('PUT', `/api/mappings/${body.data.id}`, { themeId: THEME_LIVE.id, confirm: true });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ branch: 'main', themeId: THEME_LIVE.id });
    // The theme freed by the change can be mapped again.
    expect((await map('feature', THEME_DEV.id)).status).toBe(201);

    expect((await api('DELETE', `/api/mappings/${changed.body.data.id}`, { confirm: true })).status).toBe(200);
    expect((await api('DELETE', `/api/mappings/${changed.body.data.id}`, { confirm: true })).status).toBe(404);
    const active = (await api<ThemeMappingsResponse>('GET', '/api/mappings')).body.data.items;
    expect(active.map((m) => `${m.branch}→${m.themeName}`)).toEqual(['feature→Dev copy']);
    const audit = t.sqlite.prepare('SELECT branch, theme_id, removed_at FROM theme_mappings ORDER BY created_at').all() as { removed_at: number | null }[];
    expect(audit).toHaveLength(3);
    expect(audit.filter((r) => r.removed_at !== null)).toHaveLength(2);
  });

  it('syncs only to the theme mapped to the branch, checked again before writing', async () => {
    await setup();
    const preview = (body: object) =>
      api<SyncPreview>('POST', '/api/sync/preview', { commitSha: SHA_B, themeId: THEME_DEV.id, strategy: 'commit_changes', ...body });

    expect((await preview({})).body.error.code).toBe('MAPPING_REQUIRED');
    const { body } = await map('feature', THEME_DEV.id);
    const wrongBranch = await preview({ branch: 'main' });
    expect(wrongBranch.status).toBe(409);
    expect(wrongBranch.body.error.code).toBe('MAPPING_CONFLICT');

    // Without a branch the preview uses the mapped one.
    const ok = await preview({});
    expect(ok.status).toBe(201);
    expect(ok.body.data.branch).toBe('feature');

    // The mapping is removed between preview and confirm: nothing is written.
    await api('DELETE', `/api/mappings/${body.data.id}`, { confirm: true });
    const confirm = await api('POST', '/api/sync', { syncId: ok.body.data.syncId, confirm: true });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('MAPPING_REQUIRED');
  });

  it('does not change a mapping while a sync to its theme is running', async () => {
    await setup();
    const { body } = await map('main', THEME_DEV.id);
    t.sqlite
      .prepare(
        `INSERT INTO sync_history (id, shop_id, repository, branch, commit_sha, theme_id, theme_name, theme_role, strategy, status)
         VALUES ('11111111-1111-4111-8111-111111111111', ?, 'acme/theme', 'main', ?, ?, 'Dev copy', 'UNPUBLISHED', 'commit_changes', 'running')`,
      )
      .run(shopId, SHA_B, THEME_DEV.id);
    const res = await api('DELETE', `/api/mappings/${body.data.id}`, { confirm: true });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/running/);
  });
});
