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
  | 'SETUP_INCOMPLETE'
  | 'CODE_ERRORS'
  | 'DIRECT_EDITS_FOUND'
  | 'NOT_VERIFIED_ON_STAGING'
  | 'UPDATE_IN_PROGRESS'
  | 'BACKUP_UNAVAILABLE'
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
  name: string | null;
  status: 'installed' | 'uninstalled';
  scopes: string[];
  canReadThemes: boolean;
  canWriteThemes: boolean;
}

export interface SyncPreferences {
  /** Repository sub-directory that contains the theme, e.g. "theme". Empty = repo root. */
  themeRoot: string;
  /**
   * Protected files are never replaced or removed once they exist in a theme:
   * brand settings and content edited in the Shopify theme editor. A protected
   * file that does not exist in the theme yet (a new template) is still created.
   */
  protectedPatterns: string[];
  /** Theme paths never written, created or removed. Supports `*` and `**` globs. */
  ignorePatterns: string[];
}

export const DEFAULT_PROTECTED_PATTERNS: readonly string[] = [
  'config/settings_data.json',
  'templates/**/*.json',
  'sections/*-group.json',
];

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  themeRoot: '',
  protectedPatterns: [...DEFAULT_PROTECTED_PATTERNS],
  ignorePatterns: [],
};

export interface ThemeRef {
  id: string;
  name: string;
}

export interface AppSettings {
  /** `owner/name` of the master theme repository. */
  repository: string | null;
  branch: string | null;
  /** Unpublished theme that receives every new update first. */
  stagingTheme: ThemeRef | null;
  /** Theme that receives Staging-verified updates only (normally the published theme). */
  liveTheme: ThemeRef | null;
  preferences: SyncPreferences;
  updatedAt: string | null;
}

export interface SettingsResponse {
  shop: ShopInfo;
  settings: AppSettings;
  /** Repository used when none is set for this store (Worker variable MASTER_REPOSITORY). */
  masterRepository: string | null;
}

export interface UpdateSettingsRequest {
  repository?: string | null;
  branch?: string | null;
  stagingThemeId?: string | null;
  liveThemeId?: string | null;
  preferences?: Partial<SyncPreferences>;
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}

export interface ConnectionTestResponse {
  github: ConnectionCheck & { repository: string | null; branch: string | null; account: string | null };
  shopify: ConnectionCheck & { shopName: string | null };
  /** Whether Shopify lets this app change theme files (scope + theme-modification exemption). */
  themeWrites: ConnectionCheck & { allowed: boolean | null };
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
  /** True when no store token is saved but the Worker has a shared GITHUB_TOKEN. */
  usingSharedToken: boolean;
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
// Theme Sync: lines of work, updates and runs
// ---------------------------------------------------------------------------
/** staging / live: the store's configured themes; other: any other unpublished theme. */
export type ThemeLine = 'staging' | 'live' | 'other';
export type UpdateKind = 'update' | 'publish' | 'rollback' | 'restore' | 'baseline';

export type UpdateStatus =
  | 'previewed'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partially_failed'
  | 'failed'
  | 'cancelled'
  | 'expired';

/** The update a theme runs: saved only when every file of an update succeeded. */
export interface SyncedUpdate {
  sha: string;
  shortSha: string;
  message: string | null;
  /** Branch the update was chosen from (null when unknown). */
  branch: string | null;
  syncedAt: string | null;
  verifiedOnStagingAt: string | null;
}

export interface CommitRef {
  sha: string;
  shortSha: string;
  message: string | null;
}

export type FileChange = 'added' | 'modified' | 'removed';

export interface IncludedCommitFile {
  path: string;
  change: FileChange;
  /** Matches a protected pattern (left untouched if it already exists in the theme). */
  protected: boolean;
  /** Not a theme file, outside the theme root, or ignored. */
  ignored: boolean;
}

export interface IncludedCommit {
  sha: string;
  shortSha: string;
  message: string;
  date: string | null;
  authorName: string | null;
  files: IncludedCommitFile[];
  filesTruncated: boolean;
}

export interface CodeIssue {
  path: string;
  line: number | null;
  message: string;
}

export interface DirectEdit {
  path: string;
  updatedAt: string | null;
  /** edited – changed in Shopify since the last sync; added – created in Shopify, not in the last synced update. */
  reason: 'edited' | 'added';
}

export interface UpdateChecks {
  code: {
    status: 'passed' | 'failed';
    filesChecked: number;
    /** Files checked when they are applied instead (very large updates). */
    filesDeferred: number;
    issues: CodeIssue[];
  };
  directEdits: {
    status: 'passed' | 'warning' | 'skipped';
    files: DirectEdit[];
    note: string | null;
  };
}

export interface UpdateTotals {
  added: number;
  updated: number;
  removed: number;
  /** Protected files the update would have replaced or removed, left as they are. */
  protectedUntouched: number;
  skipped: number;
}

export type UpdatePhase = 'review' | 'backup' | 'applying' | 'done';

export interface UpdateProgress {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  backedUp: number;
}

/**
 * forward   – applying newer updates (includes every update in between)
 * backward  – going back to an earlier update
 * initial   – the theme has no last synced update: the complete theme is applied
 * rewritten – the branch history no longer contains the last synced update
 * none      – the theme already runs the target update
 */
export type UpdateDirection = 'forward' | 'backward' | 'initial' | 'rewritten' | 'none';

export interface UpdateActions {
  canConfirm: boolean;
  needsDirectEditApproval: boolean;
  blockedByCodeErrors: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canRerun: boolean;
  canRestore: boolean;
  canPublish: boolean;
}

/** Choices made on the review page (like the earlier sync flow). */
export interface UpdateSelection {
  /** Remove files the update removes. When off, they stay in the theme. */
  allowDeletes: boolean;
  /** Files you chose not to apply; they stay as they are in the theme. */
  skippedPaths: string[];
}

export interface UpdateRun {
  id: string;
  selection: UpdateSelection;
  kind: UpdateKind;
  line: ThemeLine;
  status: UpdateStatus;
  phase: UpdatePhase;
  shopDomain: string;
  theme: { id: string; name: string; role: string };
  repository: string;
  branch: string | null;
  base: CommitRef | null;
  target: CommitRef | null;
  direction: UpdateDirection;
  commits: IncludedCommit[];
  checks: UpdateChecks | null;
  totals: UpdateTotals;
  progress: UpdateProgress;
  warnings: string[];
  errorDetails: { code: string; message: string } | null;
  attempt: number;
  verifiedOnStagingAt: string | null;
  restoredFromId: string | null;
  rolloutId: string | null;
  previewExpiresAt: string | null;
  initiatedAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  actions: UpdateActions;
}

export type UpdateFileStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export interface UpdateFile {
  id: string;
  path: string;
  action: 'upsert' | 'delete';
  change: FileChange | 'skipped';
  status: UpdateFileStatus;
  introducedBy: string | null;
  skipReason: string | null;
  error: string | null;
  /** transient – can be retried; code – needs a developer fix. */
  errorKind: 'transient' | 'code' | 'other' | null;
  backup: 'pending' | 'saved' | 'absent' | null;
  attempts: number;
}

export interface UpdateRunDetail extends UpdateRun {
  files: UpdateFile[];
}

export interface CreateUpdatePlanRequest {
  /** update – Staging; publish – a Live theme; rollback – Staging or Live to an earlier update. */
  kind: 'update' | 'publish' | 'rollback';
  /** Full 40-character commit SHA of the update to apply (or go back to). */
  targetSha: string;
  /**
   * update: any unpublished theme (default: Staging). publish: the Live theme.
   * rollback: defaults to the line's theme.
   */
  themeId?: string;
  line?: ThemeLine;
  /** Branch the update was chosen from (recorded in the history). */
  branch?: string;
}

export type UpdateSelectionRequest = UpdateSelection;

export interface ConfirmUpdateRequest {
  /** "Replace and continue": replace files that were edited directly in Shopify. */
  acceptDirectEdits?: boolean;
}

export interface BaselineRequest {
  line: ThemeLine;
  /** The update the theme already runs. Nothing in the theme is changed. */
  sha: string;
  /** Any theme of the store (overrides `line`). */
  themeId?: string;
  /** Branch the update was chosen from. */
  branch?: string;
}

// ---------------------------------------------------------------------------
// Overview, updates list, publish options
// ---------------------------------------------------------------------------
export interface StoreSummary {
  shopDomain: string;
  name: string;
  installed: boolean;
  /** Opens this app inside that store's Shopify Admin. */
  adminUrl: string;
  current: boolean;
}

export interface ThemeLineState {
  line: ThemeLine;
  configured: ThemeRef | null;
  /** Current Shopify data for the configured theme (null if it no longer exists). */
  theme: ShopifyTheme | null;
  lastSynced: SyncedUpdate | null;
  /** Staging: updates waiting in the repository. Live: Staging-verified updates to publish. */
  waiting: number;
  /** True when more updates are waiting than were counted. */
  waitingMore: boolean;
  activeRun: UpdateRun | null;
  lastRun: UpdateRun | null;
}

export interface OverviewResponse {
  store: StoreSummary;
  repository: string | null;
  branch: string | null;
  githubConnected: boolean;
  /** What is still missing before updates can be applied. */
  setupMissing: string[];
  staging: ThemeLineState;
  live: ThemeLineState;
  /** Staging's last synced update when it can be published to Live. */
  publishable: SyncedUpdate | null;
  /** Non-fatal problems while loading (for example GitHub unreachable). */
  notices: string[];
}

export type UpdateListState = 'new' | 'current' | 'older';

export interface UpdateListItem extends CommitSummary {
  state: UpdateListState;
  /** This commit was already applied to the theme (a completed update, publish, go back or recorded baseline). */
  applied: boolean;
  /** Fully completed on an unpublished theme of the store, so it can be published to Live. */
  verified: boolean;
  counts: { added: number; modified: number; removed: number } | null;
}

export interface UpdatesResponse {
  line: ThemeLine;
  /** Shopify data of the theme (null when it no longer exists). */
  shopifyTheme: ShopifyTheme | null;
  theme: ThemeRef | null;
  repository: string;
  branch: string | null;
  current: SyncedUpdate | null;
  /** Whether the current update was found in the listed history. */
  currentFound: boolean;
  waiting: number;
  waitingMore: boolean;
  items: UpdateListItem[];
  page: number;
  hasNextPage: boolean;
}

export interface PublishThemeOption {
  theme: ShopifyTheme;
  lastSynced: SyncedUpdate | null;
  isConfiguredLive: boolean;
}

export interface PublishOptionsResponse {
  /** Staging's last synced update. */
  update: SyncedUpdate | null;
  verified: boolean;
  reason: string | null;
  themes: PublishThemeOption[];
  defaultThemeId: string | null;
}

/** assets/theme-sync.json in a theme: the theme's own record of its last synced update. */
export interface ThemeSyncFile {
  path: string;
  present: boolean;
  sha: string | null;
  branch: string | null;
  syncedOn: string | null;
  /** The file names the same update as Theme Sync's record. */
  matchesRecord: boolean;
}

/** One theme of the store with its last synced update (from assets/theme-sync.json). */
export interface ThemeOverviewItem {
  theme: ShopifyTheme;
  line: ThemeLine;
  lastSynced: SyncedUpdate | null;
  activeRun: UpdateRun | null;
  lastRun: UpdateRun | null;
  /** Only on GET /api/themes/:id. */
  syncFile?: ThemeSyncFile | null;
}

// ---------------------------------------------------------------------------
// Roll-out across stores
// ---------------------------------------------------------------------------
export type RolloutStagingState =
  | 'up_to_date'
  | 'behind'
  | 'ahead'
  | 'queued'
  | 'updating'
  | 'failed'
  | 'not_configured'
  | 'not_installed';

export type RolloutLiveState = 'published' | 'ready_to_publish' | 'behind' | 'updating' | 'not_configured' | 'none';

export interface RolloutStore {
  shopDomain: string;
  name: string;
  current: boolean;
  adminUrl: string;
  /** Unpublished themes of the store the update can be tested on. */
  themes: ThemeRef[];
  /** The test theme shown and updated for this store. */
  themeId: string | null;
  /** State of the test theme. */
  staging: { state: RolloutStagingState; sha: string | null; runId: string | null; progress: { done: number; total: number } | null };
  /** State of the published (Live) theme. */
  live: { state: RolloutLiveState; sha: string | null };
}

export interface RolloutResponse {
  /** False when the Worker has no STORE_GROUP configured. */
  enabled: boolean;
  target: CommitRef | null;
  stores: RolloutStore[];
}

export interface RolloutPreviewRequest {
  sha: string;
  /** The test (unpublished) theme to update in each store. */
  targets: { shopDomain: string; themeId: string }[];
}

export interface RolloutPreviewResult {
  shopDomain: string;
  name: string;
  run: UpdateRun | null;
  error: { code: string; message: string } | null;
}

export interface RolloutConfirmRequest {
  runs: { shopDomain: string; runId: string; acceptDirectEdits?: boolean }[];
}

export interface RolloutConfirmResult {
  shopDomain: string;
  run: UpdateRun | null;
  error: { code: string; message: string } | null;
}

export interface HealthResponse {
  status: 'ok';
  time: string;
}
