/**
 * GET /api/settings   → { shop, settings } for the authenticated shop
 * PUT /api/settings   → partial update; repository/branch/theme are verified upstream
 * POST /api/settings/ignore-preview { patterns } → which theme files on the selected branch each pattern matches
 */
import { Hono } from 'hono';
import type { IgnorePreviewResponse, SettingsResponse, ShopInfo } from '../../shared/api-types';
import { describeIgnorePattern, isIgnored, matchesGlob, repoPathToThemePath, validateThemePath } from '../../shared/theme-paths';
import type { AppEnv } from '../env';
import { cached } from '../lib/cache';
import { adminClient, githubClient, resolveRepository } from '../lib/clients';
import {
  getDb,
  getSettings,
  reconcileGithubAccount,
  removeMappingsExcept,
  updateGithubConnectionRepository,
  upsertSettings,
  type SettingsWrite,
} from '../lib/database';
import { ok, ApiError } from '../lib/response';
import { parseScopes, scopeGrants } from '../lib/sessions';
import { getTheme } from '../lib/shopify-graphql';
import { ignorePreviewSchema, parseOrThrow, readJsonBody, splitRepository, updateSettingsSchema } from '../lib/validators';
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
    await reconcileGithubAccount(getDb(c.env.DB), shop.id);
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
        const { client, connection } = await githubClient(c);
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
        patch.githubAccount = connection.accountLogin;
      } else {
        patch.defaultRepository = null;
        patch.defaultBranch = null;
      }
      // The app syncs from one repository: mappings of any other repository are removed (their sync
      // history and the themes' last synced commits are kept).
      if ((patch.defaultRepository ?? '').toLowerCase() !== (current.defaultRepository ?? '').toLowerCase()) {
        const removed = await removeMappingsExcept(db, shop.id, patch.defaultRepository ?? null, 'settings:repository');
        if (removed) c.get('logger').info('mappings.removed_for_repository_change', { removed });
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
  })
  .post('/ignore-preview', async (c) => {
    const { shop } = c.get('auth');
    const body = parseOrThrow(ignorePreviewSchema, await readJsonBody(c.req.raw));
    const settings = await getSettings(getDb(c.env.DB), shop.id);
    const { client, connection } = await githubClient(c);
    const target = await resolveRepository(c, connection);
    const branch = target.defaultBranch ?? (await client.getRepository(target.owner, target.repo)).defaultBranch;
    const head = await client.getBranch(target.owner, target.repo, branch);
    // The tree of a commit never changes, so it is cached by the branch head's SHA.
    const paths = await cached<string[]>(
      c.env.KV,
      `cache:${shop.id}:gh:${target.fullName}:tree-paths:${head.commitSha}`,
      600,
      async () => {
        const tree = await client.getTree(target.owner, target.repo, head.commitSha);
        return tree.entries.filter((e) => e.type === 'blob').map((e) => e.path);
      },
      c.get('logger'),
    );
    const themeFiles = paths
      .map((p) => repoPathToThemePath(p, settings.syncPreferences.themeRoot))
      .filter((p): p is string => p !== null && validateThemePath(p).ok);
    const patterns = body.patterns.map((pattern) => {
      const matched = themeFiles.filter((path) => matchesGlob(path, pattern));
      return { pattern, description: describeIgnorePattern(pattern), matches: matched.length, examples: matched.slice(0, 5) };
    });
    return ok<IgnorePreviewResponse>(c, {
      repository: target.fullName,
      branch,
      themeFiles: themeFiles.length,
      ignoredFiles: themeFiles.filter((path) => isIgnored(path, body.patterns)).length,
      patterns,
    });
  });
