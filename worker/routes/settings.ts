/**
 * GET  /api/settings        connections and theme rules of the authenticated store
 * PUT  /api/settings        partial update; repository, branch and themes are verified upstream
 * POST /api/settings/test   "Test connection": GitHub, Shopify and theme write access (changes nothing)
 */
import { Hono } from 'hono';
import type { ConnectionTestResponse, SettingsResponse } from '../../shared/api-types';
import type { AppEnv } from '../env';
import { invalidate, cacheKeys } from '../lib/cache';
import { adminClient, githubClient } from '../lib/clients';
import { getDb, getSettings, updateGithubConnectionRepository, upsertSettings, type SettingsWrite } from '../lib/database';
import { ApiError, ok } from '../lib/response';
import { canWriteThemeFiles, getShopDetails, getTheme, listThemes } from '../lib/shopify-graphql';
import { parseOrThrow, readJsonBody, splitRepository, updateSettingsSchema } from '../lib/validators';
import { requireRepo, resolveBranch } from '../sync/runtime';
import { importThemeMarker, requestRuntime, toShopInfo } from './helpers';

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const settingsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rt = await requestRuntime(c);
    return ok<SettingsResponse>(c, {
      shop: toShopInfo(rt.shop),
      settings: rt.settings,
      masterRepository: c.env.MASTER_REPOSITORY?.trim() || null,
    });
  })
  .put('/', async (c) => {
    const { shop } = c.get('auth');
    const body = parseOrThrow(updateSettingsSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);
    const current = await getSettings(db, shop.id);
    const patch: SettingsWrite = {};

    // Repository + branch: the GitHub token must be able to read them.
    if (body.repository !== undefined || body.branch !== undefined) {
      const repository = body.repository === undefined ? current.repository : body.repository;
      if (repository) {
        const { client, connection } = await githubClient(c);
        const { owner, repo } = splitRepository(repository);
        const info = await client.verifyRepositoryAccess(owner, repo);
        const branch = body.branch !== undefined ? body.branch : body.repository !== undefined ? null : current.branch;
        if (branch) await client.getBranch(owner, repo, branch);
        if (connection) {
          await updateGithubConnectionRepository(db, shop.id, {
            repoOwner: info.owner,
            repoName: info.name,
            defaultBranch: info.defaultBranch,
          });
        }
        patch.defaultRepository = info.fullName;
        patch.defaultBranch = branch ?? info.defaultBranch;
      } else {
        patch.defaultRepository = null;
        patch.defaultBranch = null;
      }
    }

    // Themes: must exist in THIS store. Staging must be unpublished and differ from Live.
    const stagingId = body.stagingThemeId === undefined ? current.stagingTheme?.id ?? null : body.stagingThemeId;
    const liveId = body.liveThemeId === undefined ? current.liveTheme?.id ?? null : body.liveThemeId;
    if (stagingId && liveId && stagingId === liveId) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Staging and Live must be different themes');
    }
    if (body.stagingThemeId !== undefined || body.liveThemeId !== undefined) {
      const admin = await adminClient(c);
      if (body.stagingThemeId !== undefined) {
        if (body.stagingThemeId === null) {
          patch.stagingThemeId = null;
          patch.stagingThemeName = null;
        } else {
          const theme = await getTheme(admin, body.stagingThemeId);
          if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Staging theme not found in this store');
          if (theme.isLive) throw new ApiError(422, 'VALIDATION_ERROR', 'The Staging theme must be an unpublished theme');
          if (!theme.writable) throw new ApiError(422, 'VALIDATION_ERROR', `A ${theme.role} theme cannot be used for Staging`);
          patch.stagingThemeId = theme.id;
          patch.stagingThemeName = theme.name;
        }
      }
      if (body.liveThemeId !== undefined) {
        if (body.liveThemeId === null) {
          patch.liveThemeId = null;
          patch.liveThemeName = null;
        } else {
          const theme = await getTheme(admin, body.liveThemeId);
          if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Live theme not found in this store');
          if (!theme.writable) throw new ApiError(422, 'VALIDATION_ERROR', `A ${theme.role} theme cannot be used for Live`);
          patch.liveThemeId = theme.id;
          patch.liveThemeName = theme.name;
        }
      }
    }

    if (body.preferences) {
      patch.syncPreferences = { ...current.preferences, ...body.preferences };
    }

    const settings = await upsertSettings(db, shop.id, patch);
    await invalidate(c.env.KV, cacheKeys.themes(shop.id));
    const rt = await requestRuntime(c);
    for (const theme of [settings.stagingTheme, settings.liveTheme]) if (theme) await importThemeMarker(rt, theme.id);
    c.get('logger').info('settings.updated', { fields: Object.keys(patch) });
    return ok<SettingsResponse>(
      c,
      { shop: toShopInfo(shop), settings, masterRepository: c.env.MASTER_REPOSITORY?.trim() || null },
      'Settings saved',
    );
  })
  .post('/test', async (c) => {
    const rt = await requestRuntime(c);
    const result: ConnectionTestResponse = {
      github: { ok: false, message: '', repository: rt.repo?.fullName ?? null, branch: null, account: null },
      shopify: { ok: false, message: '', shopName: null },
      themeWrites: { ok: false, message: '', allowed: null },
    };

    try {
      const repo = requireRepo(rt);
      const github = await rt.github();
      const user = await github.getAuthenticatedUser();
      await github.verifyRepositoryAccess(repo.owner, repo.repo);
      const branch = await resolveBranch(rt);
      await github.getBranch(repo.owner, repo.repo, branch);
      Object.assign(result.github, {
        ok: true,
        message: `Connected as ${user.login}; ${repo.fullName} (${branch}) is readable.`,
        branch,
        account: user.login,
      });
    } catch (err) {
      result.github.message = describeError(err);
    }

    try {
      const admin = await rt.admin();
      const details = await getShopDetails(admin);
      Object.assign(result.shopify, { ok: true, message: `Connected to ${details.name} (${rt.shop.shopDomain}).`, shopName: details.name });
      // Any unpublished theme will do: the check never changes a file.
      const themes = await listThemes(admin);
      const target = (themes.find((t) => !t.isLive && t.writable) ?? themes.find((t) => t.writable))?.id ?? null;
      if (!target) {
        result.themeWrites.message = 'The store has no theme the app can check.';
      } else {
        const check = await canWriteThemeFiles(admin, target);
        Object.assign(result.themeWrites, { ok: check.allowed, allowed: check.allowed, message: check.message });
      }
    } catch (err) {
      if (!result.shopify.ok) result.shopify.message = describeError(err);
      else result.themeWrites.message = describeError(err);
    }
    return ok<ConnectionTestResponse>(c, result);
  });
