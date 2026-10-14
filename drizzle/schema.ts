/**
 * D1 (SQLite) schema for Ace Marks Git Connection.
 *
 * Conventions
 * - Primary keys are UUID strings generated in the Worker (crypto.randomUUID()).
 * - Timestamps are INTEGER milliseconds since epoch (Drizzle `timestamp_ms`).
 * - Every tenant-owned row carries `shop_id`; all queries in worker/lib/database.ts
 *   filter by the shop resolved from a verified Shopify credential.
 * - Credentials are stored only as AES-256-GCM ciphertext (worker/lib/crypto.ts),
 *   bound to the shop domain via additional authenticated data so a ciphertext
 *   copied into another shop's row fails to decrypt.
 *
 * After editing this file run `npm run db:generate` to emit a SQL migration into
 * ./migrations and `npm run db:migrate:local` to apply it.
 */
import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdateFn(() => new Date());

// ---------------------------------------------------------------------------
// shops — one row per Shopify store that has installed the app.
// ---------------------------------------------------------------------------
export const SHOP_STATUSES = ['installed', 'uninstalled'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const shops = sqliteTable(
  'shops',
  {
    id: id(),
    /** Canonical `{handle}.myshopify.com` domain, lowercase. */
    shopDomain: text('shop_domain').notNull(),
    status: text('status', { enum: SHOP_STATUSES }).notNull().default('installed'),
    /** Comma-separated scopes actually granted by Shopify. */
    scopes: text('scopes').notNull().default(''),
    /** Encrypted offline Admin API access token. */
    accessTokenEncrypted: text('access_token_encrypted'),
    /** Null for legacy non-expiring offline tokens. */
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    /** Encrypted refresh token for expiring offline tokens. */
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    /** Incremented on every token write; used as a compare-and-set guard on refresh. */
    tokenVersion: integer('token_version').notNull().default(0),
    installedAt: integer('installed_at', { mode: 'timestamp_ms' }),
    uninstalledAt: integer('uninstalled_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shops_shop_domain_unique').on(t.shopDomain),
    index('shops_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// sessions — Shopify admin user sessions seen through verified session tokens.
// Used for auditing (who initiated a sync) and to avoid re-recording the same
// session on every request. Session tokens themselves are never stored.
// ---------------------------------------------------------------------------
export const sessions = sqliteTable(
  'sessions',
  {
    /** The `sid` claim of the Shopify session token. */
    id: text('id').primaryKey(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** The `sub` claim: Shopify staff user ID. */
    userId: text('user_id'),
    isOnline: integer('is_online', { mode: 'boolean' }).notNull().default(true),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_shop_idx').on(t.shopId), index('sessions_expires_idx').on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// github_connections — the GitHub credential for a shop (one per shop for now).
// ---------------------------------------------------------------------------
export const GITHUB_AUTH_TYPES = ['fine_grained_pat', 'classic_pat'] as const;
export type GithubAuthType = (typeof GITHUB_AUTH_TYPES)[number];

export const githubConnections = sqliteTable(
  'github_connections',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    authType: text('auth_type', { enum: GITHUB_AUTH_TYPES }).notNull(),
    /** Login of the GitHub user (or bot) the token authenticates as. */
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull().default('User'),
    /** Repository verified for this connection. */
    repoOwner: text('repo_owner'),
    repoName: text('repo_name'),
    /** The repository's default branch as reported by GitHub. */
    defaultBranch: text('default_branch'),
    tokenEncrypted: text('token_encrypted').notNull(),
    /** From the `github-authentication-token-expiration` header, when present. */
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }),
    lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('github_connections_shop_unique').on(t.shopId)],
);

// ---------------------------------------------------------------------------
// app_settings — per-shop defaults used by the UI and sync workflow.
// ---------------------------------------------------------------------------
export const appSettings = sqliteTable(
  'app_settings',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** `owner/name` */
    defaultRepository: text('default_repository'),
    defaultBranch: text('default_branch'),
    /** Shopify GID, e.g. gid://shopify/OnlineStoreTheme/123 */
    defaultThemeId: text('default_theme_id'),
    defaultThemeName: text('default_theme_name'),
    /** JSON-encoded SyncPreferences (shared/api-types.ts). */
    syncPreferences: text('sync_preferences', { mode: 'json' }).notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('app_settings_shop_unique').on(t.shopId)],
);

// ---------------------------------------------------------------------------
// sync_history — one row per preview / synchronization run.
// ---------------------------------------------------------------------------
export const SYNC_STATUSES = [
  'previewed',
  'queued',
  'running',
  'succeeded',
  'partially_failed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_STRATEGIES = ['commit_changes', 'full_snapshot'] as const;
export type SyncStrategy = (typeof SYNC_STRATEGIES)[number];

export const syncHistory = sqliteTable(
  'sync_history',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** `owner/name` at the time of the sync. */
    repository: text('repository').notNull(),
    branch: text('branch'),
    /** Full 40-character commit SHA — the single source of truth for file contents. */
    commitSha: text('commit_sha').notNull(),
    commitMessage: text('commit_message'),
    themeId: text('theme_id').notNull(),
    themeName: text('theme_name').notNull(),
    themeRole: text('theme_role').notNull(),
    strategy: text('strategy', { enum: SYNC_STRATEGIES }).notNull(),
    status: text('status', { enum: SYNC_STATUSES }).notNull(),
    /** Number of planned write operations (upserts + deletes). */
    filesChanged: integer('files_changed').notNull().default(0),
    filesSucceeded: integer('files_succeeded').notNull().default(0),
    filesFailed: integer('files_failed').notNull().default(0),
    filesSkipped: integer('files_skipped').notNull().default(0),
    /** JSON: { code, message, details? } for run-level failures. */
    errorDetails: text('error_details', { mode: 'json' }),
    /** JSON: SyncOptions used to build the plan. */
    options: text('options', { mode: 'json' }).notNull().default(sql`'{}'`),
    initiatedBy: text('initiated_by'),
    attempt: integer('attempt').notNull().default(0),
    previewExpiresAt: integer('preview_expires_at', { mode: 'timestamp_ms' }),
    initiatedAt: integer('initiated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sync_history_shop_initiated_idx').on(t.shopId, t.initiatedAt),
    index('sync_history_shop_status_idx').on(t.shopId, t.status),
    index('sync_history_shop_commit_idx').on(t.shopId, t.commitSha),
  ],
);

// ---------------------------------------------------------------------------
// sync_operations — durable per-file job state for a sync run.
// ---------------------------------------------------------------------------
export const SYNC_OPERATION_ACTIONS = ['upsert', 'delete'] as const;
export type SyncOperationAction = (typeof SYNC_OPERATION_ACTIONS)[number];

export const SYNC_OPERATION_STATUSES = ['pending', 'succeeded', 'failed', 'skipped'] as const;
export type SyncOperationStatus = (typeof SYNC_OPERATION_STATUSES)[number];

export const syncOperations = sqliteTable(
  'sync_operations',
  {
    id: id(),
    syncId: text('sync_id')
      .notNull()
      .references(() => syncHistory.id, { onDelete: 'cascade' }),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** Destination theme filename, e.g. `sections/header.liquid`. */
    path: text('path').notNull(),
    /** Repository path the content comes from (differs when a theme root is set). */
    sourcePath: text('source_path'),
    /** Previous theme filename for renames. */
    previousPath: text('previous_path'),
    action: text('action', { enum: SYNC_OPERATION_ACTIONS }).notNull(),
    /** added | modified | renamed | removed | copied | snapshot */
    changeType: text('change_type').notNull(),
    /** Git blob SHA at the selected commit; downloaded bytes are verified against it. */
    blobSha: text('blob_sha'),
    size: integer('size'),
    /** Whether the file existed in the theme when the preview was generated. */
    existsInTheme: integer('exists_in_theme', { mode: 'boolean' }),
    status: text('status', { enum: SYNC_OPERATION_STATUSES }).notNull().default('pending'),
    skipReason: text('skip_reason'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sync_operations_sync_path_unique').on(t.syncId, t.path),
    index('sync_operations_sync_status_idx').on(t.syncId, t.status),
    index('sync_operations_shop_idx').on(t.shopId),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle relational queries)
// ---------------------------------------------------------------------------
export const shopsRelations = relations(shops, ({ many, one }) => ({
  sessions: many(sessions),
  githubConnection: one(githubConnections),
  settings: one(appSettings),
  syncs: many(syncHistory),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
}));

export const githubConnectionsRelations = relations(githubConnections, ({ one }) => ({
  shop: one(shops, { fields: [githubConnections.shopId], references: [shops.id] }),
}));

export const appSettingsRelations = relations(appSettings, ({ one }) => ({
  shop: one(shops, { fields: [appSettings.shopId], references: [shops.id] }),
}));

export const syncHistoryRelations = relations(syncHistory, ({ one, many }) => ({
  shop: one(shops, { fields: [syncHistory.shopId], references: [shops.id] }),
  operations: many(syncOperations),
}));

export const syncOperationsRelations = relations(syncOperations, ({ one }) => ({
  sync: one(syncHistory, { fields: [syncOperations.syncId], references: [syncHistory.id] }),
}));

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type GithubConnection = typeof githubConnections.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type SyncHistoryRow = typeof syncHistory.$inferSelect;
export type SyncOperationRow = typeof syncOperations.$inferSelect;
