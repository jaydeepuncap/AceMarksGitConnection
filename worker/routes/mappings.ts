/**
 * Repository branch ↔ Shopify theme mappings. A branch is connected to at most
 * one theme and a theme to at most one branch; the database enforces both with
 * partial unique indexes, so simultaneous requests cannot create duplicates.
 * Removing or changing a mapping keeps the old row as an audit trail.
 *
 *   GET    /api/mappings          active mappings
 *   POST   /api/mappings          { repository?, branch, themeId }
 *   PUT    /api/mappings/:id      { branch?, themeId?, confirm: true }  (replace)
 *   DELETE /api/mappings/:id      { confirm: true }
 */
import { Hono, type Context } from 'hono';
import type { ThemeMapping, ThemeMappingsResponse } from '../../shared/api-types';
import type { ThemeMappingRow } from '../../drizzle/schema';
import type { AppEnv } from '../env';
import { adminClient, githubClient, resolveRepository } from '../lib/clients';
import {
  createMapping,
  findActiveSyncForTheme,
  getActiveMappingForBranch,
  getActiveMappingForTheme,
  getMappingById,
  getDb,
  isUniqueViolation,
  listActiveMappings,
  removeMapping,
  replaceMapping,
  toThemeMappingDto,
  type Database,
} from '../lib/database';
import { ApiError, ok } from '../lib/response';
import { getTheme } from '../lib/shopify-graphql';
import {
  createMappingSchema,
  parseOrThrow,
  readJsonBody,
  removeMappingSchema,
  updateMappingSchema,
  uuidSchema,
} from '../lib/validators';

const conflictRace = () =>
  new ApiError(409, 'MAPPING_CONFLICT', 'This branch or theme was mapped by another request at the same time. Refresh and try again.');

/** Verifies the repository, branch and theme upstream; returns canonical values. */
async function verifyTarget(c: Context<AppEnv>, input: { repository?: string; branch: string; themeId: string }) {
  const { client, connection } = await githubClient(c);
  const target = await resolveRepository(c, connection, input.repository);
  const repo = await client.verifyRepositoryAccess(target.owner, target.repo);
  await client.getBranch(target.owner, target.repo, input.branch);
  const theme = await getTheme(await adminClient(c), input.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
  if (!theme.writable) {
    throw new ApiError(409, 'THEME_NOT_WRITABLE', `${theme.name} is a ${theme.role.toLowerCase()} theme and cannot be synced`);
  }
  return { repository: repo.fullName, branch: input.branch, theme };
}

/** Friendly 409 when the branch or the theme already has another active mapping. */
async function assertFree(
  db: Database,
  shopId: string,
  value: { repository: string; branch: string; themeId: string; themeName: string },
  except: string | null,
): Promise<void> {
  const forTheme = await getActiveMappingForTheme(db, shopId, value.themeId);
  if (forTheme && forTheme.id !== except) {
    throw new ApiError(409, 'MAPPING_CONFLICT', `${value.themeName} is already mapped to the ${forTheme.branch} branch. Remove that mapping first.`, {
      details: { mappingId: forTheme.id },
    });
  }
  const forBranch = await getActiveMappingForBranch(db, shopId, value.repository, value.branch);
  if (forBranch && forBranch.id !== except) {
    throw new ApiError(409, 'MAPPING_CONFLICT', `The ${value.branch} branch is already mapped to ${forBranch.themeName}. Remove that mapping first.`, {
      details: { mappingId: forBranch.id },
    });
  }
}

async function assertNoRunningSync(db: Database, shopId: string, themeIds: string[]) {
  for (const themeId of themeIds) {
    const active = await findActiveSyncForTheme(db, shopId, themeId);
    if (active) {
      throw new ApiError(409, 'CONFLICT', `A sync to ${active.themeName} is running; wait until it finishes before changing its mapping`, {
        details: { syncId: active.id },
      });
    }
  }
}

async function activeById(db: Database, shopId: string, id: string): Promise<ThemeMappingRow> {
  const row = await getMappingById(db, shopId, id);
  if (!row || row.removedAt) throw new ApiError(404, 'NOT_FOUND', 'Mapping not found (it may have been removed already)');
  return row;
}

export const mappingsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await listActiveMappings(getDb(c.env.DB), c.get('auth').shop.id);
    return ok<ThemeMappingsResponse>(c, { items: rows.map(toThemeMappingDto) });
  })
  .post('/', async (c) => {
    const { shop, userId } = c.get('auth');
    const body = parseOrThrow(createMappingSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);
    const { repository, branch, theme } = await verifyTarget(c, body);

    // Mapping the same branch to the same theme again is a no-op.
    const existing = await getActiveMappingForTheme(db, shop.id, theme.id);
    if (existing && existing.branch === branch && existing.repository.toLowerCase() === repository.toLowerCase()) {
      return ok<ThemeMapping>(c, toThemeMappingDto(existing), 'Already mapped');
    }
    await assertFree(db, shop.id, { repository, branch, themeId: theme.id, themeName: theme.name }, null);
    let row: ThemeMappingRow;
    try {
      row = await createMapping(db, shop.id, { repository, branch, themeId: theme.id, themeName: theme.name, createdBy: userId });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflictRace();
      throw err;
    }
    c.get('logger').info('mapping.created', { mappingId: row.id, repository, branch, themeId: theme.id });
    return ok<ThemeMapping>(c, toThemeMappingDto(row), `${branch} is now mapped to ${theme.name}`, 201);
  })
  .put('/:id', async (c) => {
    const { shop, userId } = c.get('auth');
    const id = parseOrThrow(uuidSchema, c.req.param('id'));
    const body = parseOrThrow(updateMappingSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);
    const current = await activeById(db, shop.id, id);
    const { repository, branch, theme } = await verifyTarget(c, {
      repository: current.repository,
      branch: body.branch ?? current.branch,
      themeId: body.themeId ?? current.themeId,
    });
    await assertFree(db, shop.id, { repository, branch, themeId: theme.id, themeName: theme.name }, current.id);
    await assertNoRunningSync(db, shop.id, [...new Set([current.themeId, theme.id])]);
    let row: ThemeMappingRow;
    try {
      row = await replaceMapping(db, shop.id, current.id, { repository, branch, themeId: theme.id, themeName: theme.name, createdBy: userId });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflictRace();
      throw err;
    }
    c.get('logger').info('mapping.changed', { from: current.id, to: row.id, branch, themeId: theme.id });
    return ok<ThemeMapping>(c, toThemeMappingDto(row), `${branch} is now mapped to ${theme.name}`);
  })
  .delete('/:id', async (c) => {
    const { shop, userId } = c.get('auth');
    const id = parseOrThrow(uuidSchema, c.req.param('id'));
    parseOrThrow(removeMappingSchema, await readJsonBody(c.req.raw));
    const db = getDb(c.env.DB);
    const current = await activeById(db, shop.id, id);
    await assertNoRunningSync(db, shop.id, [current.themeId]);
    const removed = await removeMapping(db, shop.id, id, userId);
    if (!removed) throw new ApiError(404, 'NOT_FOUND', 'Mapping not found (it may have been removed already)');
    c.get('logger').info('mapping.removed', { mappingId: id, branch: removed.branch, themeId: removed.themeId });
    return ok<ThemeMapping>(c, toThemeMappingDto(removed), `${removed.branch} is no longer mapped to ${removed.themeName}`);
  });
