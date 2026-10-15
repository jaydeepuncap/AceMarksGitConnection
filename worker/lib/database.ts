/**
 * Data access for D1 via Drizzle. Every tenant-scoped function takes the
 * `shopId` resolved by authentication middleware and includes it in the WHERE
 * clause, so a request authenticated for shop A can never read or modify rows
 * that belong to shop B, even with a guessed record ID.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../drizzle/schema';
import { classifyFailure } from '../sync/failures';
import {
  appSettings,
  githubConnections,
  sessions,
  shops,
  syncHistory,
  syncOperations,
  themeBranchSync,
  themeMappings,
  type AppSettingsRow,
  type ThemeBranchSyncRow,
  type ThemeMappingRow,
  type GithubConnection,
  type Shop,
  type SyncHistoryRow,
  type SyncOperationRow,
  type SyncStatus,
} from '../../drizzle/schema';
import {
  DEFAULT_SYNC_PREFERENCES,
  SYNC_STRATEGY_VALUES,
  type SyncStrategy,
  type AppSettings,
  type GithubConnectionInfo,
  type IncludedCommit,
  type LastSynced,
  type SyncOperation,
  type SyncPreferences,
  type SyncRun,
  type ThemeMapping,
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
export function normalizePreferences(raw: unknown): SyncPreferences {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<SyncPreferences>;
  return {
    strategy: SYNC_STRATEGY_VALUES.includes(value.strategy as SyncStrategy)
      ? (value.strategy as SyncStrategy)
      : DEFAULT_SYNC_PREFERENCES.strategy,
    allowDeletes: typeof value.allowDeletes === 'boolean' ? value.allowDeletes : DEFAULT_SYNC_PREFERENCES.allowDeletes,
    themeRoot: typeof value.themeRoot === 'string' ? value.themeRoot : DEFAULT_SYNC_PREFERENCES.themeRoot,
    ignorePatterns: Array.isArray(value.ignorePatterns)
      ? value.ignorePatterns.filter((p): p is string => typeof p === 'string')
      : [...DEFAULT_SYNC_PREFERENCES.ignorePatterns],
  };
}

function toSettingsDto(row: AppSettingsRow | undefined): AppSettings {
  return {
    defaultRepository: row?.defaultRepository ?? null,
    defaultBranch: row?.defaultBranch ?? null,
    defaultThemeId: row?.defaultThemeId ?? null,
    defaultThemeName: row?.defaultThemeName ?? null,
    syncPreferences: normalizePreferences(row?.syncPreferences),
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
  defaultThemeId?: string | null;
  defaultThemeName?: string | null;
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
// Sync history & operations
// ---------------------------------------------------------------------------
export type NewSyncRun = Omit<typeof syncHistory.$inferInsert, 'id' | 'shopId' | 'status'> & { id: string };
export type NewSyncOperation = Omit<
  typeof syncOperations.$inferInsert,
  'id' | 'syncId' | 'shopId' | 'attempts' | 'error' | 'updatedAt'
>;

// Upper bound on columns bound per sync_operations row (incl. defaulted ones).
const OPERATION_COLUMNS = 16;

/** Persists a preview: the run row (status "previewed") plus one row per planned file. */
export async function createSyncPreview(
  db: Database,
  shopId: string,
  run: NewSyncRun,
  operations: NewSyncOperation[],
): Promise<void> {
  await db.insert(syncHistory).values({ ...run, shopId, status: 'previewed' });
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

export async function listSyncRuns(
  db: Database,
  shopId: string,
  opts: {
    page: number;
    perPage: number;
    status?: SyncStatus;
    includePreviews?: boolean;
    themeId?: string;
    /** Runs whose commit came from this branch (runs recorded without a branch are included). */
    branch?: string;
    strategy?: SyncStrategy;
    /** YYYY-MM-DD (UTC), inclusive. */
    from?: string;
    to?: string;
  },
): Promise<{ rows: SyncHistoryRow[]; hasNextPage: boolean }> {
  const filters = [eq(syncHistory.shopId, shopId)];
  if (opts.strategy) filters.push(eq(syncHistory.strategy, opts.strategy));
  if (opts.from) filters.push(sql`${syncHistory.initiatedAt} >= ${Date.parse(`${opts.from}T00:00:00Z`)}`);
  if (opts.to) filters.push(sql`${syncHistory.initiatedAt} < ${Date.parse(`${opts.to}T00:00:00Z`) + 86_400_000}`);
  if (opts.themeId) filters.push(eq(syncHistory.themeId, opts.themeId));
  if (opts.branch) filters.push(sql`(${syncHistory.branch} = ${opts.branch} or ${syncHistory.branch} is null)`);
  if (opts.status) filters.push(eq(syncHistory.status, opts.status));
  else if (!opts.includePreviews) {
    filters.push(ne(syncHistory.status, 'previewed'), ne(syncHistory.status, 'expired'));
  }
  const rows = await db
    .select()
    .from(syncHistory)
    .where(and(...filters))
    .orderBy(desc(syncHistory.initiatedAt))
    .limit(opts.perPage + 1)
    .offset((opts.page - 1) * opts.perPage);
  return { rows: rows.slice(0, opts.perPage), hasNextPage: rows.length > opts.perPage };
}

export async function listSyncOperations(db: Database, shopId: string, syncId: string): Promise<SyncOperationRow[]> {
  return db
    .select()
    .from(syncOperations)
    .where(and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId)))
    .orderBy(syncOperations.path);
}

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
      and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId), eq(syncOperations.status, 'pending')),
    )
    .orderBy(syncOperations.action, syncOperations.path)
    .limit(limit);
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

export async function updateOperations(
  db: Database,
  shopId: string,
  ids: string[],
  values: Partial<Pick<SyncOperationRow, 'status' | 'error' | 'skipReason'>> & { incrementAttempts?: boolean },
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

/** Resets failed operations to pending so a retry re-applies them (idempotent writes). */
export async function resetFailedOperations(db: Database, shopId: string, syncId: string): Promise<number> {
  const rows = await db
    .update(syncOperations)
    .set({ status: 'pending', error: null, updatedAt: new Date() })
    .where(
      and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId), eq(syncOperations.status, 'failed')),
    )
    .returning({ id: syncOperations.id });
  return rows.length;
}

export interface OperationCounts {
  pending: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export async function countOperations(db: Database, shopId: string, syncId: string): Promise<OperationCounts> {
  const rows = await db
    .select({ status: syncOperations.status, count: sql<number>`count(*)` })
    .from(syncOperations)
    .where(and(eq(syncOperations.syncId, syncId), eq(syncOperations.shopId, shopId)))
    .groupBy(syncOperations.status);
  const counts: OperationCounts = { pending: 0, succeeded: 0, failed: 0, skipped: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

/** Is another run already writing to this theme? (prevents concurrent conflicting writes) */
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

const RETRYABLE_STATUSES: SyncStatus[] = ['failed', 'partially_failed'];

export function toSyncRunDto(row: SyncHistoryRow): SyncRun {
  const details = row.errorDetails as { code?: string; message?: string } | null;
  const options = (row.options ?? {}) as Record<string, unknown>;
  const backedUp = typeof options.backedUp === 'number' ? options.backedUp : 0;
  const restoredAt = typeof options.restoredAt === 'string' ? options.restoredAt : null;
  return {
    id: row.id,
    repository: row.repository,
    branch: row.branch,
    commitSha: row.commitSha,
    commitMessage: row.commitMessage,
    themeId: row.themeId,
    themeName: row.themeName,
    themeRole: row.themeRole,
    strategy: row.strategy,
    status: row.status,
    filesChanged: row.filesChanged,
    filesSucceeded: row.filesSucceeded,
    filesFailed: row.filesFailed,
    filesSkipped: row.filesSkipped,
    filesIgnored: typeof options.ignored === 'number' ? options.ignored : 0,
    errorDetails: details?.message ? { code: details.code ?? 'ERROR', message: details.message } : null,
    attempt: row.attempt,
    initiatedAt: iso(row.initiatedAt) ?? new Date(0).toISOString(),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    // After a restore the theme is back as before; a fresh update is the way forward.
    canRetry: RETRYABLE_STATUSES.includes(row.status) && !restoredAt,
    baseSha: typeof options.baseSha === 'string' ? options.baseSha : null,
    commitsIncluded: Array.isArray(options.commitsIncluded) ? (options.commitsIncluded as IncludedCommit[]) : [],
    backedUp,
    allowDeletes: options.allowDeletes === true,
    canRestore: RETRYABLE_STATUSES.includes(row.status) && backedUp > 0 && !restoredAt,
    restoredAt,
    restoredFiles: typeof options.restoredFiles === 'number' ? options.restoredFiles : 0,
  };
}

export function toSyncOperationDto(row: SyncOperationRow): SyncOperation {
  return {
    id: row.id,
    path: row.path,
    sourcePath: row.sourcePath,
    previousPath: row.previousPath,
    action: row.action,
    changeType: row.changeType,
    status: row.status,
    skipReason: row.skipReason,
    attempts: row.attempts,
    error: row.error,
    failure: row.status === 'failed' ? classifyFailure(row.error) : null,
    lastAttemptAt: row.attempts > 0 ? row.updatedAt.toISOString() : null,
    sourceCommitSha: row.sourceCommitSha,
  };
}

/** Adds `n` to a numeric counter in the run's options (backedUp, ignored). */
async function addToRunCounter(db: Database, shopId: string, syncId: string, key: 'backedUp' | 'ignored', n: number): Promise<void> {
  if (n <= 0) return;
  const path = `$.${key}`;
  await db
    .update(syncHistory)
    .set({
      options: sql`json_set(${syncHistory.options}, ${path}, coalesce(json_extract(${syncHistory.options}, ${path}), 0) + ${n})`,
    })
    .where(and(eq(syncHistory.id, syncId), eq(syncHistory.shopId, shopId)));
}

/** Adds `n` to options.backedUp (files saved before they changed). */
export const addBackedUp = (db: Database, shopId: string, syncId: string, n: number) => addToRunCounter(db, shopId, syncId, 'backedUp', n);

/** Adds `n` to options.ignored (files excluded by ignore patterns). */
export const addIgnored = (db: Database, shopId: string, syncId: string, n: number) => addToRunCounter(db, shopId, syncId, 'ignored', n);

/**
 * Commits of `shas` fully synced to the theme from `branch`: the commit of
 * every succeeded run plus all commits it brought in (multiple commits, since
 * last sync). Runs recorded without a branch count as the given branch.
 */
export async function syncedCommits(
  db: Database,
  shopId: string,
  themeId: string,
  branch: string | null,
  shas: string[],
): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  const wanted = new Set(shas.map((s) => s.toLowerCase()));
  const branchFilter = branch ? sql`and (h.branch = ${branch} or h.branch is null)` : sql``;
  const rows = await db.all<{ sha: string | null }>(sql`
    select h.commit_sha as sha from sync_history h
      where h.shop_id = ${shopId} and h.theme_id = ${themeId} and h.status = 'succeeded' ${branchFilter}
    union
    select json_extract(j.value, '$.sha') as sha
      from sync_history h, json_each(h.options, '$.commitsIncluded') j
      where h.shop_id = ${shopId} and h.theme_id = ${themeId} and h.status = 'succeeded' ${branchFilter}
  `);
  return new Set(rows.map((r) => r.sha?.toLowerCase()).filter((sha): sha is string => !!sha && wanted.has(sha)));
}

// ---------------------------------------------------------------------------
// Last synced commit per theme and branch
// ---------------------------------------------------------------------------
export function toLastSynced(row: ThemeBranchSyncRow | undefined | null): LastSynced | null {
  if (!row) return null;
  return {
    themeId: row.themeId,
    branch: row.branch,
    sha: row.commitSha,
    shortSha: row.commitSha.slice(0, 7),
    message: row.commitMessage,
    syncedAt: row.syncedAt.toISOString(),
    syncId: row.syncId,
  };
}

export async function getLastSynced(
  db: Database,
  shopId: string,
  themeId: string,
  branch: string,
): Promise<ThemeBranchSyncRow | undefined> {
  return db.query.themeBranchSync.findFirst({
    where: and(eq(themeBranchSync.shopId, shopId), eq(themeBranchSync.themeId, themeId), eq(themeBranchSync.branch, branch)),
  });
}

/** The most recent sync of each theme (any branch). */
export async function latestSyncPerTheme(db: Database, shopId: string): Promise<Map<string, ThemeBranchSyncRow>> {
  const rows = await db
    .select()
    .from(themeBranchSync)
    .where(eq(themeBranchSync.shopId, shopId))
    .orderBy(desc(themeBranchSync.syncedAt));
  const out = new Map<string, ThemeBranchSyncRow>();
  for (const row of rows) if (!out.has(row.themeId)) out.set(row.themeId, row);
  return out;
}

export async function saveLastSynced(
  db: Database,
  shopId: string,
  values: { themeId: string; branch: string; commitSha: string; commitMessage: string | null; syncId: string | null; syncedAt: Date },
): Promise<void> {
  await db
    .insert(themeBranchSync)
    .values({ shopId, ...values })
    .onConflictDoUpdate({
      target: [themeBranchSync.shopId, themeBranchSync.themeId, themeBranchSync.branch],
      set: {
        commitSha: values.commitSha,
        commitMessage: values.commitMessage,
        syncId: values.syncId,
        syncedAt: values.syncedAt,
        updatedAt: new Date(),
      },
    });
}

/**
 * The most recent fully succeeded sync of a theme — on `branch` (runs recorded
 * without a branch count as any branch), or on any branch when `branch` is null.
 */
export async function latestSucceededRun(
  db: Database,
  shopId: string,
  themeId: string,
  branch: string | null,
  repository: string | null,
): Promise<SyncHistoryRow | undefined> {
  const [row] = await db
    .select()
    .from(syncHistory)
    .where(
      and(
        eq(syncHistory.shopId, shopId),
        eq(syncHistory.themeId, themeId),
        eq(syncHistory.status, 'succeeded'),
        ...(repository ? [sql`lower(${syncHistory.repository}) = ${repository.toLowerCase()}`] : []),
        branch
          ? sql`(${syncHistory.branch} = ${branch} or ${syncHistory.branch} is null)`
          : sql`${syncHistory.branch} is not null`,
      ),
    )
    .orderBy(desc(syncHistory.completedAt))
    .limit(1);
  return row;
}

/** Merges `patch` into a run's options (JSON). */
export async function mergeRunOptions(db: Database, shopId: string, syncId: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .update(syncHistory)
    .set({ options: sql`json_patch(${syncHistory.options}, ${JSON.stringify(patch)})` })
    .where(and(eq(syncHistory.id, syncId), eq(syncHistory.shopId, shopId)));
}

/**
 * Claims an incomplete run for "Restore backup" so two requests cannot restore
 * at once (a claim older than 5 minutes is considered abandoned).
 */
export async function claimRestore(db: Database, shopId: string, syncId: string): Promise<SyncHistoryRow | undefined> {
  const now = Date.now();
  const [row] = await db
    .update(syncHistory)
    .set({ options: sql`json_set(${syncHistory.options}, '$.restoring', ${now})` })
    .where(
      and(
        eq(syncHistory.id, syncId),
        eq(syncHistory.shopId, shopId),
        inArray(syncHistory.status, ['failed', 'partially_failed']),
        sql`json_extract(${syncHistory.options}, '$.restoredAt') is null`,
        sql`coalesce(json_extract(${syncHistory.options}, '$.restoring'), 0) < ${now - 5 * 60_000}`,
      ),
    )
    .returning();
  return row;
}

/** Every branch's last synced commit for one theme, most recent first. */
export async function listLastSyncedForTheme(db: Database, shopId: string, themeId: string): Promise<ThemeBranchSyncRow[]> {
  return db
    .select()
    .from(themeBranchSync)
    .where(and(eq(themeBranchSync.shopId, shopId), eq(themeBranchSync.themeId, themeId)))
    .orderBy(desc(themeBranchSync.syncedAt));
}

// ---------------------------------------------------------------------------
// Theme mappings (repository branch ↔ Shopify theme)
// ---------------------------------------------------------------------------
export function toThemeMappingDto(row: ThemeMappingRow): ThemeMapping {
  return {
    id: row.id,
    repository: row.repository,
    branch: row.branch,
    themeId: row.themeId,
    themeName: row.themeName,
    createdAt: row.createdAt.toISOString(),
  };
}

const activeMapping = (shopId: string) => and(eq(themeMappings.shopId, shopId), isNull(themeMappings.removedAt));

export async function listActiveMappings(db: Database, shopId: string): Promise<ThemeMappingRow[]> {
  return db.select().from(themeMappings).where(activeMapping(shopId)).orderBy(themeMappings.repository, themeMappings.branch);
}

export async function getMappingById(db: Database, shopId: string, id: string): Promise<ThemeMappingRow | undefined> {
  return db.query.themeMappings.findFirst({ where: and(eq(themeMappings.shopId, shopId), eq(themeMappings.id, id)) });
}

export async function getActiveMappingForTheme(db: Database, shopId: string, themeId: string): Promise<ThemeMappingRow | undefined> {
  return db.query.themeMappings.findFirst({ where: and(activeMapping(shopId), eq(themeMappings.themeId, themeId)) });
}

export async function getActiveMappingForBranch(
  db: Database,
  shopId: string,
  repository: string,
  branch: string,
): Promise<ThemeMappingRow | undefined> {
  return db.query.themeMappings.findFirst({
    where: and(
      activeMapping(shopId),
      sql`lower(${themeMappings.repository}) = ${repository.toLowerCase()}`,
      eq(themeMappings.branch, branch),
    ),
  });
}

/** SQLite/D1 unique-index violation (possibly wrapped by Drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) return true;
    if (typeof e !== 'object') break;
  }
  return false;
}

type MappingValues = { repository: string; branch: string; themeId: string; themeName: string; createdBy: string | null };

/** Inserts a mapping; the partial unique indexes reject a second active mapping for the branch or theme. */
export async function createMapping(db: Database, shopId: string, values: MappingValues): Promise<ThemeMappingRow> {
  const [row] = await db.insert(themeMappings).values({ shopId, ...values }).returning();
  return row!;
}

/** Atomically retires `previousId` and inserts its replacement (one transaction). */
export async function replaceMapping(
  db: Database,
  shopId: string,
  previousId: string,
  values: MappingValues,
): Promise<ThemeMappingRow> {
  const now = new Date();
  const [, inserted] = await db.batch([
    db
      .update(themeMappings)
      .set({ removedAt: now, removedBy: values.createdBy, updatedAt: now })
      .where(and(activeMapping(shopId), eq(themeMappings.id, previousId)))
      .returning({ id: themeMappings.id }),
    db.insert(themeMappings).values({ shopId, ...values }).returning(),
  ]);
  return inserted[0]!;
}

/** Retires an active mapping (kept for the audit trail). */
export async function removeMapping(
  db: Database,
  shopId: string,
  id: string,
  removedBy: string | null,
): Promise<ThemeMappingRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(themeMappings)
    .set({ removedAt: now, removedBy, updatedAt: now })
    .where(and(activeMapping(shopId), eq(themeMappings.id, id)))
    .returning();
  return row;
}

/** The most recent sync of a theme that produced a result (succeeded, partially failed or failed). */
export async function latestCompletedRun(
  db: Database,
  shopId: string,
  themeId: string,
  branch: string | null,
): Promise<SyncHistoryRow | undefined> {
  const [row] = await db
    .select()
    .from(syncHistory)
    .where(
      and(
        eq(syncHistory.shopId, shopId),
        eq(syncHistory.themeId, themeId),
        inArray(syncHistory.status, ['succeeded', 'partially_failed', 'failed']),
        sql`${syncHistory.completedAt} is not null`,
        ...(branch ? [eq(syncHistory.branch, branch)] : []),
      ),
    )
    .orderBy(desc(syncHistory.completedAt))
    .limit(1);
  return row;
}
