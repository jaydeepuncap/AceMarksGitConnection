/**
 * API contract shared by the Worker (worker/routes/*) and the React app
 * (app/lib/api-client.ts). Type-only + plain constants: safe to import from
 * both the browser and the Workers runtime.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'GITHUB_NOT_CONNECTED'
  | 'GITHUB_AUTH_FAILED'
  | 'GITHUB_ACCESS_DENIED'
  | 'GITHUB_NOT_FOUND'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_ERROR'
  | 'SHOPIFY_REAUTH_REQUIRED'
  | 'SHOPIFY_THROTTLED'
  | 'SHOPIFY_ERROR'
  | 'THEME_WRITE_NOT_PERMITTED'
  | 'THEME_NOT_WRITABLE'
  | 'PREVIEW_EXPIRED'
  | 'LIVE_THEME_CONFIRMATION_REQUIRED'
  | 'CODE_ERRORS'
  | 'DIRECT_EDITS_FOUND'
  | 'UPSTREAM_TIMEOUT'
  | 'SERVER_MISCONFIGURED'
  | 'DATABASE_NOT_MIGRATED'
  | 'INTERNAL_ERROR';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
    /** Seconds until the client may retry (429 responses). */
    retryAfter?: number;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
}

// ---------------------------------------------------------------------------
// Shop & settings
// ---------------------------------------------------------------------------
export interface ShopInfo {
  shopDomain: string;
  status: 'installed' | 'uninstalled';
  scopes: string[];
  canReadThemes: boolean;
  canWriteThemes: boolean;
}

export const SYNC_STRATEGY_VALUES = ['commit_changes', 'full_snapshot', 'since_last_sync'] as const;
export type SyncStrategy = (typeof SYNC_STRATEGY_VALUES)[number];

export interface SyncPreferences {
  /**
   * commit_changes – apply only the files the selected commit changed.
   * full_snapshot  – upsert every theme file present in the repository at the commit.
   * since_last_sync – every update between the theme's last synced commit (on this
   *                   branch) and the selected one, applied together in one step.
   */
  strategy: SyncStrategy;
  /** Apply deletions for files removed (or renamed away) in the commit. Off by default. */
  allowDeletes: boolean;
  /** Repository sub-directory that contains the theme, e.g. "theme". Empty = repo root. */
  themeRoot: string;
  /** Theme paths never written or deleted. Supports `*` and `**` globs. */
  ignorePatterns: string[];
}

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  // Push everything from the theme's last synced commit to the selected one.
  strategy: 'since_last_sync',
  allowDeletes: false,
  themeRoot: '',
  // Merchant customizations live in settings_data.json; overwriting it from Git
  // would discard theme editor changes, so it is excluded unless removed here.
  ignorePatterns: ['config/settings_data.json'],
};

export interface AppSettings {
  defaultRepository: string | null;
  defaultBranch: string | null;
  defaultThemeId: string | null;
  defaultThemeName: string | null;
  syncPreferences: SyncPreferences;
  updatedAt: string | null;
}

export interface SettingsResponse {
  shop: ShopInfo;
  settings: AppSettings;
}

export interface UpdateSettingsRequest {
  defaultRepository?: string | null;
  defaultBranch?: string | null;
  defaultThemeId?: string | null;
  syncPreferences?: Partial<SyncPreferences>;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------
export type GithubAuthType = 'fine_grained_pat' | 'classic_pat';

export interface GithubConnectionInfo {
  id: string;
  authType: GithubAuthType;
  accountLogin: string;
  accountType: string;
  repoOwner: string | null;
  repoName: string | null;
  defaultBranch: string | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface GithubConnectionResponse {
  connected: boolean;
  connection: GithubConnectionInfo | null;
}

export interface CreateGithubConnectionRequest {
  /** Fine-grained PAT (github_pat_…) or classic PAT (ghp_…). Never returned by the API. */
  token: string;
  /** Optional `owner/name` to verify immediately. */
  repository?: string;
}

export interface GithubRepository {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string | null;
  permissions: { pull: boolean; push: boolean; admin: boolean };
}

export interface GithubBranch {
  name: string;
  commitSha: string;
  protected: boolean;
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------
export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  date: string | null;
  htmlUrl: string;
  parents: string[];
}

/** The last commit fully synced to a theme from a branch. */
export interface LastSynced {
  themeId: string;
  branch: string;
  sha: string;
  shortSha: string;
  message: string | null;
  syncedAt: string;
  syncId: string | null;
}

/**
 * new         – newer than the theme's last synced commit on this branch (waiting)
 * last_synced – the commit the theme was last synced to from this branch
 * added       – already in the theme (synced before, or older than the last synced commit)
 */
export type CommitSyncStatus = 'new' | 'last_synced' | 'added';

export interface CommitListItem extends CommitSummary {
  syncStatus: CommitSyncStatus | null;
}

export interface CommitsResponse extends Paginated<CommitListItem> {
  /** Present when the list was requested for a theme. */
  lastSynced: LastSynced | null;
  /** Commits newer than the last synced one on this branch. */
  waiting: number;
  waitingMore: boolean;
}

export interface CommitDetail extends CommitSummary {
  stats: { additions: number; deletions: number; total: number };
  /** Number of files GitHub returned (GitHub caps a single commit at 3000 files). */
  filesCount: number;
  /** True when GitHub's 3000-file limit was reached; use the full_snapshot strategy. */
  filesTruncated: boolean;
}

export type CommitFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

export interface CommitFile {
  filename: string;
  previousFilename: string | null;
  status: CommitFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  /** Git blob SHA of the file at this commit (null for removed files). */
  blobSha: string | null;
  /** Theme filename this repo path maps to, or null if it is not syncable. */
  themePath: string | null;
  themePathError: string | null;
}

export interface CommitFilesResponse extends Paginated<CommitFile> {
  /** GitHub stops listing changed files after this many. */
  maxFilesListed: number;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
export type ThemeRole = 'MAIN' | 'UNPUBLISHED' | 'DEVELOPMENT' | 'DEMO' | 'LOCKED' | 'ARCHIVED';

export interface ShopifyTheme {
  /** Admin GraphQL GID, e.g. gid://shopify/OnlineStoreTheme/123456789 */
  id: string;
  numericId: string;
  name: string;
  role: ThemeRole;
  processing: boolean;
  processingFailed: boolean;
  createdAt: string;
  updatedAt: string;
  /** role === MAIN: the published storefront theme. */
  isLive: boolean;
  /** Whether this app will write to it (not LOCKED/DEMO/ARCHIVED, not processing). */
  writable: boolean;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------
export type SyncStatus =
  | 'previewed'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partially_failed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type SyncPlanAction = 'upsert' | 'delete' | 'skip';

export interface SyncPreviewRequest {
  /** `owner/name`; defaults to Settings → default repository. */
  repository?: string;
  branch?: string;
  /** Full 40-character commit SHA. */
  commitSha: string;
  themeId: string;
  strategy?: SyncStrategy;
  allowDeletes?: boolean;
  /** Restrict the plan to these theme paths (subset of the commit's files). */
  includePaths?: string[];
}

export interface SyncPlanOperation {
  path: string;
  sourcePath: string | null;
  previousPath: string | null;
  action: SyncPlanAction;
  changeType: string;
  existsInTheme: boolean | null;
  size: number | null;
  blobSha: string | null;
  skipReason: string | null;
  /** Preview only: short SHAs of the included commits that changed this file (oldest first). */
  commits?: string[];
}

export interface SyncPreviewSummary {
  creates: number;
  updates: number;
  deletes: number;
  skipped: number;
  total: number;
}

export interface CodeIssue {
  path: string;
  line: number | null;
  message: string;
}

export interface DirectEdit {
  path: string;
  updatedAt: string | null;
}

/** Step 3 — automatic checks, run before anything changes. */
export interface SyncChecks {
  code: { status: 'passed' | 'failed'; filesChecked: number; filesDeferred: number; issues: CodeIssue[] };
  directEdits: { status: 'passed' | 'warning' | 'skipped'; files: DirectEdit[]; note: string | null };
}

export interface IncludedCommit {
  sha: string;
  shortSha: string;
  message: string;
}

export interface SyncPreview {
  syncId: string;
  /** The theme's last synced commit on this branch (what it is updated from). */
  base: { sha: string; shortSha: string; message: string | null } | null;
  /** Every update the sync brings in, oldest first. */
  commitsIncluded: IncludedCommit[];
  checks: SyncChecks;
  expiresAt: string;
  repository: string;
  branch: string | null;
  commit: { sha: string; message: string | null };
  theme: ShopifyTheme;
  strategy: SyncStrategy;
  operations: SyncPlanOperation[];
  summary: SyncPreviewSummary;
  warnings: string[];
  requiresLiveConfirmation: boolean;
}

export interface ConfirmSyncRequest {
  syncId: string;
  confirm: true;
  /** Required (true) when the target is the live theme. */
  confirmLiveTheme?: boolean;
  /** Required for the live theme: must equal the theme name exactly. */
  confirmThemeName?: string;
  /** Replace files that were edited directly in Shopify since the last sync. */
  acceptDirectEdits?: boolean;
}

export interface RetrySyncRequest {
  confirmLiveTheme?: boolean;
  confirmThemeName?: string;
}

export interface SyncRun {
  id: string;
  repository: string;
  branch: string | null;
  commitSha: string;
  commitMessage: string | null;
  themeId: string;
  themeName: string;
  themeRole: string;
  strategy: SyncStrategy;
  status: SyncStatus;
  filesChanged: number;
  filesSucceeded: number;
  filesFailed: number;
  filesSkipped: number;
  errorDetails: { code: string; message: string } | null;
  attempt: number;
  initiatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Failed operations can be retried; upserts/deletes are idempotent. */
  canRetry: boolean;
  /** The commit the theme was on before this sync (same branch), when known. */
  baseSha: string | null;
  commitsIncluded: IncludedCommit[];
  /** Files whose previous version was saved before they changed. */
  backedUp: number;
}

export interface SyncOperation {
  id: string;
  path: string;
  sourcePath: string | null;
  previousPath: string | null;
  action: 'upsert' | 'delete';
  changeType: string;
  status: 'pending' | 'succeeded' | 'failed' | 'skipped';
  skipReason: string | null;
  attempts: number;
  error: string | null;
}

export interface SyncRunDetail extends SyncRun {
  operations: SyncOperation[];
}

export interface HealthResponse {
  status: 'ok';
  time: string;
}
