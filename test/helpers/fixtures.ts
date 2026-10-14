import { encryptSecret } from '../../worker/lib/crypto';
import { githubTokenAad } from '../../worker/lib/clients';
import { getDb, upsertGithubConnection, upsertSettings, upsertThemeState } from '../../worker/lib/database';
import { storeOfflineToken } from '../../worker/lib/sessions';
import type { Env } from '../../worker/env';

export const SHA_B = 'b'.repeat(40);
export const SHA_D = 'd'.repeat(40);

/** C1 in test/helpers/sync-world.ts: the update both themes start on. */
export const START_SHA = '1'.repeat(40);

/**
 * Creates an installed shop with a non-expiring offline token, a GitHub
 * connection, settings (Staging = THEME_DEV, Live = THEME_LIVE) and both
 * themes recorded on START_SHA (verified on Staging).
 */
export async function seedShop(env: Env, shopDomain: string, opts: { github?: boolean; themes?: boolean } = {}) {
  const db = getDb(env.DB);
  const shop = await storeOfflineToken(env, db, shopDomain, {
    access_token: `shpat_${shopDomain.replace(/\W/g, '')}_token`,
    scope: 'read_themes,write_themes',
  });
  if (opts.github !== false) {
    await upsertGithubConnection(db, shop.id, {
      authType: 'fine_grained_pat',
      accountLogin: 'octocat',
      accountType: 'User',
      repoOwner: 'acme',
      repoName: 'theme',
      defaultBranch: 'main',
      tokenEncrypted: await encryptSecret(env, 'github_pat_testtoken_1234567890', githubTokenAad(shopDomain)),
      tokenExpiresAt: null,
      lastVerifiedAt: new Date(),
    });
    await upsertSettings(db, shop.id, { defaultRepository: 'acme/theme', defaultBranch: 'main' });
  }
  if (opts.themes !== false) {
    await upsertSettings(db, shop.id, {
      stagingThemeId: THEME_DEV.id,
      stagingThemeName: THEME_DEV.name,
      liveThemeId: THEME_LIVE.id,
      liveThemeName: THEME_LIVE.name,
    });
    const at = new Date('2026-10-04T10:00:00Z');
    const state = { lastSyncedSha: START_SHA, lastSyncedMessage: 'Add custom CSS', lastSyncedAt: at, lastSyncId: null };
    await upsertThemeState(db, shop.id, THEME_DEV.id, { ...state, verifiedOnStagingAt: at });
    await upsertThemeState(db, shop.id, THEME_LIVE.id, { ...state, verifiedOnStagingAt: at });
  }
  return shop;
}

export const THEME_DEV = {
  id: 'gid://shopify/OnlineStoreTheme/111',
  name: 'Staging',
  role: 'UNPUBLISHED',
  processing: false,
  processingFailed: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

export const THEME_LIVE = { ...THEME_DEV, id: 'gid://shopify/OnlineStoreTheme/222', name: 'Live', role: 'MAIN' };
