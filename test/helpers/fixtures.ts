import { encryptSecret } from '../../worker/lib/crypto';
import { githubTokenAad } from '../../worker/lib/clients';
import { createMapping, getDb, upsertGithubConnection, upsertSettings } from '../../worker/lib/database';
import { storeOfflineToken } from '../../worker/lib/sessions';
import type { Env } from '../../worker/env';

export const SHA_B = 'b'.repeat(40);
export const SHA_D = 'd'.repeat(40);

/** Creates an installed shop with a non-expiring offline token, a GitHub connection and settings. */
export async function seedShop(env: Env, shopDomain: string, opts: { github?: boolean } = {}) {
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
  return shop;
}

export const THEME_DEV = {
  id: 'gid://shopify/OnlineStoreTheme/111',
  name: 'Dev copy',
  role: 'UNPUBLISHED',
  processing: false,
  processingFailed: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

export const THEME_LIVE = { ...THEME_DEV, id: 'gid://shopify/OnlineStoreTheme/222', name: 'Live theme', role: 'MAIN' };

/** Maps `branch` of acme/theme to a theme (what the Theme mapping page does). */
export async function seedMapping(
  env: Env,
  shopId: string,
  theme: { id: string; name: string },
  branch = 'main',
  repository = 'acme/theme',
) {
  return createMapping(getDb(env.DB), shopId, { repository, branch, themeId: theme.id, themeName: theme.name, createdBy: null });
}
