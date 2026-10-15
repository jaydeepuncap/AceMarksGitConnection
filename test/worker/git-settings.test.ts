/**
 * Git connection settings: ignore patterns (validation, de-duplication, what
 * they match on the selected branch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IgnorePreviewResponse, SettingsResponse } from '../../shared/api-types';
import { app } from '../../worker/index';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { json } from '../helpers/fetch-mock';
import { seedShop, SHA_B, THEME_DEV } from '../helpers/fixtures';
import { installWorld } from '../helpers/sync-world';

const SHOP = 'alpha.myshopify.com';

describe('git connection settings', () => {
  let t: TestContext;
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    t = createTestEnv();
    const world = installWorld();
    world.mock.on((req) =>
      req.url.endsWith('/repos/acme/theme/branches/main')
        ? json({ name: 'main', commit: { sha: SHA_B }, protected: false })
        : undefined,
    );
    await seedShop(t.env, SHOP);
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

  it('saves ignore patterns without duplicates and rejects invalid ones', async () => {
    await setup();
    const saved = await api<SettingsResponse>('PUT', '/api/settings', {
      syncPreferences: { ignorePatterns: ['locales/', 'templates/*.json', 'locales/', ' assets/development.js '] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.settings.syncPreferences.ignorePatterns).toEqual(['locales/', 'templates/*.json', 'assets/development.js']);

    const bad = await api('PUT', '/api/settings', { syncPreferences: { ignorePatterns: ['../secrets'] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(bad.body.error)).toMatch(/not allowed/);
  });

  it('keeps ignore patterns when the default theme changes', async () => {
    await setup();
    await api('PUT', '/api/settings', { syncPreferences: { ignorePatterns: ['locales/'] } });
    const changed = await api<SettingsResponse>('PUT', '/api/settings', { defaultThemeId: THEME_DEV.id });
    expect(changed.status).toBe(200);
    expect(changed.body.data.settings.syncPreferences.ignorePatterns).toEqual(['locales/']);
  });

  it('shows which theme files on the branch each pattern matches', async () => {
    await setup();
    const res = await api<IgnorePreviewResponse>('POST', '/api/settings/ignore-preview', {
      patterns: ['config/settings_data.json', 'snippets/', 'templates/*.json'],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ repository: 'acme/theme', branch: 'main' });
    const byPattern = Object.fromEntries(res.body.data.patterns.map((p) => [p.pattern, p.matches]));
    expect(byPattern).toEqual({ 'config/settings_data.json': 1, 'snippets/': 1, 'templates/*.json': 0 });
    expect(res.body.data.ignoredFiles).toBe(2);
    // README.md is not a theme file, so it is not counted.
    expect(res.body.data.themeFiles).toBe(5);
  });
});
