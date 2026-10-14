import { describe, expect, it } from 'vitest';
import {
  findShopByDomain,
  getDb,
  getSettings,
  normalizePreferences,
  updateShopTokensIfVersion,
  upsertSettings,
} from '../../worker/lib/database';
import { createTestEnv } from '../helpers/env';
import { seedShop } from '../helpers/fixtures';

describe('migrations', () => {
  it('create every table and index the schema declares', () => {
    const { sqlite } = createTestEnv();
    const names = (sqlite.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as {
      name: string;
      type: string;
    }[]).map((r) => r.name);
    for (const table of ['shops', 'sessions', 'github_connections', 'app_settings', 'sync_history', 'sync_operations']) {
      expect(names).toContain(table);
    }
    for (const index of ['shops_shop_domain_unique', 'sync_history_shop_initiated_idx', 'sync_operations_sync_path_unique']) {
      expect(names).toContain(index);
    }
  });
});

describe('database helpers', () => {
  it('enforces one row per shop domain and reinstall reuses it', async () => {
    const { env } = createTestEnv();
    const first = await seedShop(env, 'a.myshopify.com', { github: false });
    const second = await seedShop(env, 'a.myshopify.com', { github: false });
    expect(second.id).toBe(first.id);
    expect(second.tokenVersion).toBe(first.tokenVersion + 1);
  });

  it('token refresh writes are compare-and-set on token_version', async () => {
    const { env } = createTestEnv();
    const db = getDb(env.DB);
    const shop = await seedShop(env, 'a.myshopify.com', { github: false });
    const write = {
      scopes: 'read_themes',
      accessTokenEncrypted: 'v1.x.y.z',
      accessTokenExpiresAt: null,
      refreshTokenEncrypted: null,
      refreshTokenExpiresAt: null,
    };
    expect(await updateShopTokensIfVersion(db, shop.id, shop.tokenVersion, write)).toBeDefined();
    // A second writer holding the stale version loses.
    expect(await updateShopTokensIfVersion(db, shop.id, shop.tokenVersion, write)).toBeUndefined();
  });

  it('settings default and merge sync preferences', async () => {
    const { env } = createTestEnv();
    const db = getDb(env.DB);
    const shop = await seedShop(env, 'a.myshopify.com', { github: false });
    const defaults = await getSettings(db, shop.id);
    expect(defaults.syncPreferences.ignorePatterns).toEqual(['config/settings_data.json']);
    const updated = await upsertSettings(db, shop.id, {
      defaultBranch: 'dev',
      syncPreferences: { ...defaults.syncPreferences, allowDeletes: true },
    });
    expect(updated).toMatchObject({ defaultBranch: 'dev', syncPreferences: { allowDeletes: true } });
    expect(normalizePreferences({ strategy: 'bogus' }).strategy).toBe('commit_changes');
  });

  it('deleting a shop cascades to its data', async () => {
    const { env, sqlite } = createTestEnv();
    await seedShop(env, 'a.myshopify.com');
    sqlite.prepare("DELETE FROM shops WHERE shop_domain = 'a.myshopify.com'").run();
    expect(sqlite.prepare('SELECT count(*) AS n FROM github_connections').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT count(*) AS n FROM app_settings').get()).toEqual({ n: 0 });
    expect(await findShopByDomain(getDb(env.DB), 'a.myshopify.com')).toBeUndefined();
  });
});
