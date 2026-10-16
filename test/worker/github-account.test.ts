/**
 * The selected repository and the branch → theme mappings belong to the GitHub
 * account that set them up: connecting another account starts clean, the same
 * account keeps them, and choosing another repository removes the mappings of
 * the previous one. Sync history is always kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubConnectionResponse, SettingsResponse, ThemeMappingsResponse } from '../../shared/api-types';
import { app } from '../../worker/index';
import {
  createMapping,
  getDb,
  getGithubConnection,
  upsertGithubConnection,
  upsertSettings,
} from '../../worker/lib/database';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { json } from '../helpers/fetch-mock';
import { seedShop, THEME_DEV, THEME_LIVE } from '../helpers/fixtures';
import { installWorld } from '../helpers/sync-world';

const SHOP = 'alpha.myshopify.com';

describe('GitHub account and repository ownership of mappings', () => {
  let t: TestContext;
  let shopId: string;
  let login = 'octocat';
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    t = createTestEnv();
    const world = installWorld();
    shopId = (await seedShop(t.env, SHOP)).id;
    // The seeded repository and mappings were set up by octocat.
    await upsertSettings(getDb(t.env.DB), shopId, { githubAccount: 'octocat' });
    const db = getDb(t.env.DB);
    await createMapping(db, shopId, {
      repository: 'acme/theme',
      branch: 'main',
      themeId: THEME_DEV.id,
      themeName: THEME_DEV.name,
      createdBy: null,
    });
    await createMapping(db, shopId, {
      repository: 'acme/theme',
      branch: 'staging',
      themeId: THEME_LIVE.id,
      themeName: THEME_LIVE.name,
      createdBy: null,
    });
    world.mock.first((req) => {
      const url = new URL(req.url);
      if (url.hostname !== 'api.github.com') return undefined;
      if (url.pathname === '/user') return json({ login, type: 'User' });
      if (url.pathname === '/repos/acme/other')
        return json({
          id: 2,
          full_name: 'acme/other',
          owner: { login: 'acme' },
          name: 'other',
          private: false,
          default_branch: 'main',
          html_url: 'https://github.com/acme/other',
          updated_at: '2026-10-01T00:00:00Z',
          permissions: { pull: true, push: false, admin: false },
        });
      if (url.pathname === '/repos/acme/other/commits') return json([]);
      if (url.pathname === '/repos/acme/other/branches/main')
        return json({ name: 'main', commit: { sha: 'f'.repeat(40) }, protected: false });
      return undefined;
    });
  }
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
    return { status: res.status, body: (await res.json()) as { data: T; error: { code: string; message: string } } };
  };
  const connect = () =>
    api<GithubConnectionResponse>('POST', '/api/github/connection', { token: 'github_pat_' + 'x'.repeat(40) });
  // The seeded connection's stored values, to re-save it under another login.
  const connectionValues = async () => {
    const {
      id: _id,
      shopId: _shop,
      createdAt: _c,
      updatedAt: _u,
      ...rest
    } = (await getGithubConnection(getDb(t.env.DB), shopId))!;
    return rest;
  };
  const mappings = async () => (await api<ThemeMappingsResponse>('GET', '/api/mappings')).body.data.items;
  const repository = async () =>
    (await api<SettingsResponse>('GET', '/api/settings')).body.data.settings.defaultRepository;

  it('keeps the repository and mappings when the same account connects a new token', async () => {
    await setup();
    login = 'octocat';
    const res = await connect();
    expect(res.status).toBe(201);
    expect(res.body.data.reset).toBeUndefined();
    expect(await repository()).toBe('acme/theme');
    expect(await mappings()).toHaveLength(2);
  });

  it("clears the previous account's repository and mappings when another account connects", async () => {
    await setup();
    login = 'someone-else';
    const res = await connect();
    expect(res.status).toBe(201);
    expect(res.body.data.connection?.accountLogin).toBe('someone-else');
    expect(res.body.data.reset).toEqual({ previousAccount: 'octocat', repository: 'acme/theme', mappingsRemoved: 2 });
    expect(await repository()).toBeNull();
    expect(await mappings()).toHaveLength(0);
    // Connecting the same new account again changes nothing.
    expect((await connect()).body.data.reset).toBeUndefined();
  });

  it("clears an already connected account's foreign repository and mappings on the next page load", async () => {
    await setup();
    // Saved before the account was recorded, while another account (bristm) is connected now.
    const db = getDb(t.env.DB);
    await upsertSettings(db, shopId, { githubAccount: null });
    await upsertGithubConnection(db, shopId, { ...(await connectionValues()), accountLogin: 'bristm' });
    expect(await repository()).toBeNull();
    expect(await mappings()).toHaveLength(0);
    const connection = await api<GithubConnectionResponse>('GET', '/api/github/connection');
    expect(connection.body.data.connection?.accountLogin).toBe('bristm');
  });

  it("keeps an unrecorded repository that is the connected account's own", async () => {
    await setup();
    const db = getDb(t.env.DB);
    await upsertSettings(db, shopId, { githubAccount: null });
    await upsertGithubConnection(db, shopId, { ...(await connectionValues()), accountLogin: 'acme' });
    expect(await repository()).toBe('acme/theme');
    expect(await mappings()).toHaveLength(2);
  });

  it('clears the repository and mappings when the recorded account differs from the connected one', async () => {
    await setup();
    await upsertGithubConnection(getDb(t.env.DB), shopId, { ...(await connectionValues()), accountLogin: 'bristm' });
    expect(await mappings()).toHaveLength(0);
    expect(await repository()).toBeNull();
  });

  it('removes the mappings of the previous repository when another repository is chosen', async () => {
    await setup();
    const res = await api<SettingsResponse>('PUT', '/api/settings', {
      defaultRepository: 'acme/other',
      defaultBranch: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.defaultRepository).toBe('acme/other');
    expect(await mappings()).toHaveLength(0);
  });
});
