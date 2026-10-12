/**
 * GET /api/settings   → { shop, settings } for the authenticated shop
 * PUT /api/settings   → partial update; repository/branch/theme are verified upstream
 */
import { Hono } from 'hono';
import type { SettingsResponse, ShopInfo } from '@shared/api-types';
import type { AppEnv } from '../env';
import { adminClient, githubClient } from '../lib/clients';
import { getDb, getSettings, updateGithubConnectionRepository, upsertSettings, type SettingsWrite } from '../lib/database';
import { ok, ApiError } from '../lib/response';
import { parseScopes, scopeGrants } from '../lib/sessions';
import { getTheme } from '../lib/shopify-graphql';
import { parseOrThrow, readJsonBody, splitRepository, updateSettingsSchema } from '../lib/validators';
import type { Shop } from '../../drizzle/schema';

export function toShopInfo(shop: Shop): ShopInfo {
  const scopes = parseScopes(shop.scopes);
  return {
    shopDomain: shop.shopDomain,
    status: shop.status,
    scopes,
    canReadThemes: scopeGrants(scopes, 'read_themes'),
    canWriteThemes: scopeGrants(scopes, 'write_themes'),
  };
}

export const settingsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { shop } = c.get('auth');
    const settings = await getSettings(getDb(c.env.DB), shop.id);
    return ok<SettingsResponse>(c, { shop: toShopInfo(shop), settings });
  })
  .put('/', async (c) => {
    const { shop } = c.get('auth');
    const body = parseOrThrow(updateSettingsSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);
    const current = await getSettings(db, shop.id);
    const patch: SettingsWrite = {};

    // Repository + branch: verify the stored GitHub token can read them.
    const repository = body.defaultRepository === undefined ? current.defaultRepository : body.defaultRepository;
    if (body.defaultRepository !== undefined || body.defaultBranch !== undefined) {
      if (repository) {
        const { client } = await githubClient(c);
        const { owner, repo } = splitRepository(repository);
        const info = await client.verifyRepositoryAccess(owner, repo);
        const branch =
          body.defaultBranch !== undefined
            ? body.defaultBranch
            : body.defaultRepository !== undefined && body.defaultRepository !== current.defaultRepository
              ? info.defaultBranch
              : current.defaultBranch;
        if (branch) await client.getBranch(owner, repo, branch);
        await updateGithubConnectionRepository(db, shop.id, {
          repoOwner: info.owner,
          repoName: info.name,
          defaultBranch: info.defaultBranch,
        });
        patch.defaultRepository = info.fullName;
        patch.defaultBranch = branch ?? info.defaultBranch;
      } else {
        patch.defaultRepository = null;
        patch.defaultBranch = null;
      }
    }

    // Theme: must exist in THIS shop.
    if (body.defaultThemeId !== undefined) {
      if (body.defaultThemeId === null) {
        patch.defaultThemeId = null;
        patch.defaultThemeName = null;
      } else {
        const theme = await getTheme(await adminClient(c), body.defaultThemeId);
        if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
        patch.defaultThemeId = theme.id;
        patch.defaultThemeName = theme.name;
      }
    }

    if (body.syncPreferences) {
      patch.syncPreferences = { ...current.syncPreferences, ...body.syncPreferences };
    }

    const settings = await upsertSettings(db, shop.id, patch);
    c.get('logger').info('settings.updated', { fields: Object.keys(patch) });
    return ok<SettingsResponse>(c, { shop: toShopInfo(shop), settings }, 'Settings saved');
  });
