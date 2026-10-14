/**
 * Data access for D1 via Drizzle. Every tenant-scoped function takes the
 * `shopId` resolved by authentication middleware and includes it in the WHERE
 * clause, so a request authenticated for shop A can never read or modify rows
 * that belong to shop B, even with a guessed record ID.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../drizzle/schema';
import {
  appSettings,
  githubConnections,
  sessions,
  shops,
  syncHistory,
  syncOperations,
  themeFileChecksums,
  themeStates,
  type AppSettingsRow,
  type GithubConnection,
  type Shop,
  type SyncHistoryRow,
  type SyncOperationRow,
  type SyncStatus,
  type ThemeLine,
  type ThemeStateRow,
} from '../../drizzle/schema';
import {
  DEFAULT_PROTECTED_PATTERNS,
  DEFAULT_SYNC_PREFERENCES,
  type AppSettings,
  type GithubConnectionInfo,
  type SyncPreferences,
  type SyncedUpdate,
} from '../../shared/api-types';

export type Database = DrizzleD1Database<typeof schema>;

export function getDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}

/** D1 allows at most 100 bound parameters per statement. */
const D1_MAX_PARAMS = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------
export async function findShopByDomain(db: Database, shopDomain: string): Promise<Shop | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.shopDomain, shopDomain) });
}

export async function findShopById(db: Database, shopId: string): Promise<Shop | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.id, shopId) });
}

export interface ShopTokenWrite {
  scopes: string;
  accessTokenEncrypted: string;
  accessTokenExpiresAt: Date | null;
  refreshTokenEncrypted: string | null;
  refreshTokenExpiresAt: Date | null;
}

/** Creates or re-activates a shop with fresh offline credentials (install / reinstall / token exchange). */
export async function upsertInstalledShop(db: Database, shopDomain: string, tokens: ShopTokenWrite): Promise<Shop> {
  const now = new Date();
  const [row] = await db
    .insert(shops)
    .values({ shopDomain, status: 'installed', installedAt: now, ...tokens, tokenVersion: 1 })
    .onConflictDoUpdate({
      target: shops.shopDomain,
      set: {
        ...tokens,
        status: 'installed',
        uninstalledAt: null,
        installedAt: sql`coalesce(${shops.installedAt}, ${now.getTime()})`,
        tokenVersion: sql`${shops.tokenVersion} + 1`,
        updatedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error('Failed to persist shop');
  return row;
}

/**
 * Compare-and-set token write used after a refresh: succeeds only if nobody
 * else rotated the tokens since `expectedVersion` was read.
 */
export async function updateShopTokensIfVersion(
  db: Database,
  shopId: string,
  expectedVersion: number,
  tokens: ShopTokenWrite,
): Promise<Shop | undefined> {
  const [row] = await db
    .update(shops)
    .set({ ...tokens, tokenVersion: expectedVersion + 1 })
    .where(and(eq(shops.id, shopId), eq(shops.tokenVersion, expectedVersion)))
    .returning();
  return row;
}

export async function clearShopTokens(db: Database, shopId: string): Promise<void> {
  await db
    .update(shops)
    .set({
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      refreshTokenEncrypted: null,
      refreshTokenExpiresAt: null,
      tokenVersion: sql`${shops.tokenVersion} + 1`,
    })
    .where(eq(shops.id, shopId));
}

export async function markShopUninstalled(db: Database, shopDomain: string): Promise<void> {
  await db
    .update(shops)
    .set({
      status: 'uninstalled',
      uninstalledAt: new Date(),
      accessTokenEncrypted: null,
      accessTokenExpiresAt: null,
      refreshTokenEncrypted: null,
      refreshTokenExpiresAt: null,
      tokenVersion: sql`${shops.tokenVersion} + 1`,
    })
    .where(eq(shops.shopDomain, shopDomain));
}

export async function findShopsByDomains(db: Database, domains: string[]): Promise<Shop[]> {
  if (domains.length === 0) return [];
  return db.select().from(shops).where(inArray(shops.shopDomain, domains));
}

export async function updateShopName(db: Database, shopId: string, shopName: string): Promise<void> {
  await db.update(shops).set({ shopName }).where(eq(shops.id, shopId));
}

export async function updateShopScopes(db: Database, shopDomain: string, scopes: string): Promise<void> {
  await db.update(shops).set({ scopes }).where(eq(shops.shopDomain, shopDomain));
}

/** shop/redact: remove every row for the shop (children cascade). */
export async function deleteShopData(db: Database, shopDomain: string): Promise<void> {
  await db.delete(shops).where(eq(shops.shopDomain, shopDomain));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function recordSession(
  db: Database,
  input: { id: string; shopId: string; userId: string | null; expiresAt: Date },
): Promise<void> {
  const now = new Date();
  await db
    .insert(sessions)
    .values({ ...input, isOnline: true, lastSeenAt: now })
    .onConflictDoUpdate({
      target: sessions.id,
      set: { lastSeenAt: now, expiresAt: input.expiresAt },
      // Never let a session ID move between shops.
      setWhere: eq(sessions.shopId, input.shopId),
    });
}

export async function deleteExpiredSessions(db: Database, before = new Date()): Promise<void> {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < ${before.getTime()}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : null;

export function normalizePreferences(raw: unknown): SyncPreferences {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ignore = strings(value.ignorePatterns);
  const protectedPatterns = strings(value.protectedPatterns);
  return {
    themeRoot: typeof value.themeRoot === 'string' ? value.themeRoot : DEFAULT_SYNC_PREFERENCES.themeRoot,
    protectedPatterns: protectedPatterns ?? [...DEFAULT_PROTECTED_PATTERNS],
    // Settings saved before protected files existed excluded settings_data.json via the
    // ignore list; it is a protected file now.
    ignorePatterns: protectedPatterns
      ? (ignore ?? [])
      : (ignore ?? []).filter((p) => p !== 'config/settings_data.json'),
  };
}

function toSettingsDto(row: AppSettingsRow | undefined): AppSettings {
  return {
    repository: row?.defaultRepository ?? null,
    branch: row?.defaultBranch ?? null,
    stagingTheme: row?.stagingThemeId ? { id: row.stagingThemeId, name: row.stagingThemeName ?? 'Staging' } : null,
    liveTheme: row?.liveThemeId ? { id: row.liveThemeId, name: row.liveThemeName ?? 'Live' } : null,
    preferences: normalizePreferences(row?.syncPreferences),
    updatedAt: iso(row?.updatedAt),
  };
}

export async function getSettings(db: Database, shopId: string): Promise<AppSettings> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.shopId, shopId) });
  return toSettingsDto(row);
}

export interface SettingsWrite {
  defaultRepository?: string | null;
  defaultBranch?: string | null;
  stagingThemeId?: string | null;
  stagingThemeName?: string | null;
  liveThemeId?: string | null;
  liveThemeName?: string | null;
  syncPreferences?: SyncPreferences;
}

export async function upsertSettings(db: Database, shopId: string, patch: SettingsWrite): Promise<AppSettings> {
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as SettingsWrite;
  const [row] = await db
    .insert(appSettings)
    .values({
      shopId,
      ...values,
      syncPreferences: values.syncPreferences ?? DEFAULT_SYNC_PREFERENCES,
    })
    .onConflictDoUpdate({ target: appSettings.shopId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return toSettingsDto(row);
}

// ---------------------------------------------------------------------------
// GitHub connections
// ---------------------------------------------------------------------------
export async function getGithubConnection(db: Database, shopId: string): Promise<GithubConnection | undefined> {
  return db.query.githubConnections.findFirst({ where: eq(githubConnections.shopId, shopId) });
}

export type GithubConnectionWrite = Omit<
  typeof githubConnections.$inferInsert,
  'id' | 'shopId' | 'createdAt' | 'updatedAt'
>;

export async function upsertGithubConnection(
  db: Database,
  shopId: string,
  values: GithubConnectionWrite,
): Promise<GithubConnection> {
  const [row] = await db
    .insert(githubConnections)
    .values({ shopId, ...values })
    .onConflictDoUpdate({ target: githubConnections.shopId, set: { ...values, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error('Failed to persist GitHub connection');
  return row;
}

export async function updateGithubConnectionRepository(
  db: Database,
  shopId: string,
  repo: { repoOwner: string; repoName: string; defaultBranch: string },
): Promise<void> {
  await db
    .update(githubConnections)
    .set({ ...repo, lastVerifiedAt: new Date() })
    .where(eq(githubConnections.shopId, shopId));
}

export async function deleteGithubConnection(db: Database, shopId: string): Promise<boolean> {
  const rows = await db
    .delete(githubConnections)
    .where(eq(githubConnections.shopId, shopId))
    .returning({ id: githubConnections.id });
  return rows.length > 0;
}

export function toGithubConnectionDto(row: GithubConnection): GithubConnectionInfo {
  return {
    id: row.id,
    authType: row.authType,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    defaultBranch: row.defaultBranch,
    tokenExpiresAt: iso(row.tokenExpiresAt),
    lastVerifiedAt: iso(row.lastVerifiedAt),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Theme states ("last synced update") and file checksums
// ---------------------------------------------------------------------------
export function toSyncedUpdate(row: ThemeStateRow | undefined | null): SyncedUpdate | null {
  if (!row?.lastSyncedSha) return null;
  return {
    sha: row.lastSyncedSha,
    shortSha: row.lastSyncedSha.slice(0, 7),
    message: row.lastSyncedMessage,
    syncedAt: iso(row.lastSyncedAt),
    verifiedOnStagingAt: iso(row.verifiedOnStagingAt),
  };
}

export async function getThemeState(db: Database, shopId: string, themeId: string): Promise<ThemeStateRow | undefined> {
  return db.query.themeStates.findFirst({ where: and(eq(themeStates.shopId, shopId), eq(themeStates.themeId, themeId)) });
}

export async function getThemeStates(db: Database, shopId: string, themeIds: string[]): Promise<Map<string, ThemeStateRow>> {
  if (themeIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(themeStates)
    .where(and(eq(themeStates.shopId, shopId), inArray(themeStates.themeId, themeIds)));
  return new Map(rows.map((r) => [r.themeId, r]));
}

export type ThemeStateWrite = Omit<typeof themeStates.$inferInsert, 'id' | 'shopId' | 'themeId' | 'createdAt' | 'updatedAt'>;

export async function upsertThemeState(db: Database, shopId: string, themeId: string, values: ThemeStateWrite): Promise<void> {
  await db
    .insert(themeStates)
    .values({ shopId, themeId, ...values })
    .onConflictDoUpdate({ target: [themeStates.shopId, themeStates.themeId], set: { ...values, updatedAt: new Date() } });
}

export async function getFileChecksums(
  db: Database,
  shopId: string,
  themeId: string,
  paths: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(paths, 90)) {
    const rows = await db
      .select({ path: themeFileChecksums.path, checksum: themeFileChecksums.checksumMd5 })
      .from(themeFileChecksums)
      .where(
        and(eq(themeFileChecksums.shopId, shopId), eq(themeFileChecksums.themeId, themeId), inArray(themeFileChecksums.path, part)),
      );
    for (const row of rows) out.set(row.path, row.checksum);
  }
  return out;
}

export async function saveFileChecksums(
  db: Database,
  shopId: string,
  themeId: string,
  entries: { path: string; checksumMd5: string | null; commitSha: string | null }[],
): Promise<void> {
  for (const part of chunk(entries, 15)) {
    await db
      .insert(themeFileChecksums)
      .values(part.map((e) => ({ shopId, themeId, ...e })))
      .onConflictDoUpdate({
        target: [themeFileChecksums.shopId, themeFileChecksums.themeId, themeFileChecksums.path],
        set: { checksumMd5: sql`excluded.checksum_md5`, commitSha: sql`excluded.commit_sha`, updatedAt: new Date() },
      });
  }
}

export async function deleteFileChecksums(db: Database, shopId: string, themeId: string, paths: string[]): Promise<void> {
  for (const part of chunk(paths, 90)) {
    await db
      .delete(themeFileChecksums)
      .where(
        and(eq(themeFileChecksums.shopId, shopId), eq(themeFileChecksums.themeId, themeId), inArray(themeFileChecksums.path, part)),
      );
  }
}

// ---------------------------------------------------------------------------
// Runs (sync_history) & operations
// ---------------------------------------------------------------------------
export type NewSyncRun = Omit<typeof syncHistory.$inferInsert, 'id' | 'shopId' | 'status'> & { id: string };
export type NewSyncOperation = Omit<
  typeof syncOperations.$inferInsert,
  'id' | 'syncId' | 'shopId' | 'attempts' | 'error' | 'updatedAt'
>;

// Upper bound on columns bound per sync_operations row (incl. defaulted ones).
const OPERATION_COLUMNS = 23;

/** Persists a run (status "previewed" unless given) plus one row per planned file. */
export async function createRun(
  db: Database,
  shopId: string,
  run: NewSyncRun,
  operations: NewSyncOperation[],
  status: SyncStatus = 'previewed',
): Promise<void> {
  await db.insert(syncHistory).values({ ...run, shopId, status });
  try {
    const rows = operations.map((op) => ({ ...op, id: crypto.randomUUID(), syncId: run.id, shopId }));
    const statements = chunk(rows, Math.floor(D1_MAX_PARAMS / OPERATION_COLUMNS)).map((part) =>
      db.insert(syncOperations).values(part),
    );
    for (const group of chunk(statements, 50)) {
      const [first, ...rest] = group;
      if (first) await db.batch([first, ...rest]);
    }
  } catch (err) {
    await db.delete(syncHistory).where(and(eq(syncHistory.id, run.id), eq(syncHistory.shopId, shopId)));
    throw err;
  }
}

export async function getSyncRun(db: Database, shopId: string, syncId: string): Promise<SyncHistoryRow | undefined> {
  return db.query.syncHistory.findFirst({
    where: and(eq(syncHistory.id, syncId), eq(syncHistory.shopId, shopId)),
  });
}

/** Update history: confirmed runs only (previews that were never confirmed are not history). */
export async function listHistory(
  db: Database,
  shopId: string,
  opts: { page: number; perPage: number; line?: ThemeLine; themeId?: string; status?: SyncStatus },
): Promise<{ rows: SyncHistoryRow[]; hasNextPage: boolean }> {
  const filters = [eq(syncHistory.shopId, shopId), isNotNull(syncHistory.confirmedAt)];
  if (opts.line) filters.push(eq(syncHistory.line, opts.line));
  if (opts.themeId) filters.push(eq(syncHistory.themeId, opts.themeId));
  if (opts.status) filters.push(eq(syncHistory.status, opts.status));
  const rows = await db
    .select()
    .from(syncHistory)
    .where(and(...filters))
    .orderBy(desc(syncHistory.confirmedAt))
    .limit(opts.perPage + 1)
    .offset((opts.page - 1) * opts.perPage);
  return { rows: rows.slice(0, opts.perPage), hasNextPage: rows.length > opts.perPage };
}

export async function latestRunForTheme(db: Database, shopId: string, themeId: string): Promise<SyncHistoryRow | undefined> {
  const [row] = await db
    .select()
    .from(syncHistory)
    .where(and(eq(syncHistory.shopId, shopId), eq(syncHistory.themeId, themeId), isNotNull(syncHistory.confirmedAt)))
    .orderBy(desc(syncHistory.confirmedAt))
    .limit(1);
  return row;
}

export async function listSyncOperations(db: Database, shopId: string, syncId: string): Promise<SyncOperationRow[]> {
  return db
    .select()
    .from(syncOperations)
    .where(and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId)))
    .orderBy(syncOperations.path);
}

/** Pending file writes, excluding the assets/theme-sync.json marker (written last). */
export async function listPendingOperations(
  db: Database,
  shopId: string,
  syncId: string,
  limit: number,
): Promise<SyncOperationRow[]> {
  return db
    .select()
    .from(syncOperations)
    .where(
      and(
        eq(syncOperations.syncId, syncId),
        eq(syncOperations.shopId, shopId),
        eq(syncOperations.status, 'pending'),
        ne(syncOperations.contentSource, 'marker'),
      ),
    )
    .orderBy(syncOperations.action, syncOperations.path)
    .limit(limit);
}

/** Operations whose current theme file has not been saved to the backup yet. */
export async function listOperationsNeedingBackup(
  db: Database,
  shopId: string,
  syncId: string,
  limit: number,
): Promise<SyncOperationRow[]> {
  return db
    .select()
    .from(syncOperations)
    .where(
      and(
        eq(syncOperations.syncId, syncId),
        eq(syncOperations.shopId, shopId),
        eq(syncOperations.status, 'pending'),
        eq(syncOperations.backupState, 'pending'),
      ),
    )
    .orderBy(syncOperations.path)
    .limit(limit);
}

export async function getMarkerOperation(db: Database, shopId: string, syncId: string): Promise<SyncOperationRow | undefined> {
  const [row] = await db
    .select()
    .from(syncOperations)
    .where(
      and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId), eq(syncOperations.contentSource, 'marker')),
    )
    .limit(1);
  return row;
}

/** Atomic state transition. Returns the updated row, or undefined if the run was not in an allowed state. */
export async function transitionSyncRun(
  db: Database,
  shopId: string,
  syncId: string,
  from: SyncStatus[],
  to: SyncStatus,
  extra: Partial<typeof syncHistory.$inferInsert> = {},
): Promise<SyncHistoryRow | undefined> {
  const [row] = await db
    .update(syncHistory)
    .set({ ...extra, status: to })
    .where(and(eq(syncHistory.id, syncId), eq(syncHistory.shopId, shopId), inArray(syncHistory.status, from)))
    .returning();
  return row;
}

/** True when the database refused a second active run for the same theme. */
export function isActiveRunConflict(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
    if (/UNIQUE constraint failed: sync_history\.shop_id, sync_history\.theme_id|sync_history_one_active_per_theme/i.test(e.message)) {
      return true;
    }
  }
  return false;
}

export async function updateOperations(
  db: Database,
  shopId: string,
  ids: string[],
  values: Partial<Pick<SyncOperationRow, 'status' | 'error' | 'errorKind' | 'backupState' | 'backupKey' | 'skipReason'>> & {
    incrementAttempts?: boolean;
  },
): Promise<void> {
  if (ids.length === 0) return;
  const { incrementAttempts, ...rest } = values;
  for (const part of chunk(ids, 90)) {
    await db
      .update(syncOperations)
      .set({
        ...rest,
        ...(incrementAttempts ? { attempts: sql`${syncOperations.attempts} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(and(inArray(syncOperations.id, part), eq(syncOperations.shopId, shopId)));
  }
}

/** Resets failed files (and the marker) to pending so a retry re-applies only them. */
export async function resetFailedOperations(db: Database, shopId: string, syncId: string): Promise<number> {
  const rows = await db
    .update(syncOperations)
    .set({ status: 'pending', error: null, errorKind: null, skipReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(syncOperations.syncId, syncId),
        eq(syncOperations.shopId, shopId),
        sql`(${syncOperations.status} = 'failed' or ${syncOperations.contentSource} = 'marker')`,
      ),
    )
    .returning({ id: syncOperations.id, source: syncOperations.contentSource });
  return rows.filter((r) => r.source !== 'marker').length;
}

export interface OperationCounts {
  pending: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Files whose previous version is saved (or that did not exist before). */
  backedUp: number;
  /** Files that need a backup before they are changed. */
  backupTotal: number;
}

/** Counts file operations (the theme-sync.json marker is not a file of the update). */
export async function countOperations(db: Database, shopId: string, syncId: string): Promise<OperationCounts> {
  const rows = await db
    .select({ status: syncOperations.status, backup: syncOperations.backupState, count: sql<number>`count(*)` })
    .from(syncOperations)
    .where(
      and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId), ne(syncOperations.contentSource, 'marker')),
    )
    .groupBy(syncOperations.status, syncOperations.backupState);
  const counts: OperationCounts = { pending: 0, succeeded: 0, failed: 0, skipped: 0, backedUp: 0, backupTotal: 0 };
  for (const row of rows) {
    const n = Number(row.count);
    counts[row.status] += n;
    if (row.backup) counts.backupTotal += n;
    if (row.backup === 'saved' || row.backup === 'absent') counts.backedUp += n;
  }
  return counts;
}

/** Is another run already writing to this theme? */
export async function findActiveSyncForTheme(
  db: Database,
  shopId: string,
  themeId: string,
  excludeId?: string,
): Promise<SyncHistoryRow | undefined> {
  const rows = await db
    .select()
    .from(syncHistory)
    .where(
      and(
        eq(syncHistory.shopId, shopId),
        eq(syncHistory.themeId, themeId),
        inArray(syncHistory.status, ['queued', 'running']),
        ...(excludeId ? [ne(syncHistory.id, excludeId)] : []),
      ),
    )
    .limit(1);
  return rows[0];
}
