/**
 * Builds the plan for an update, a publish to Live or a go-back — without
 * changing the theme. The plan is what the Checks and Review screens show and
 * exactly what POST /api/updates/:id/confirm later applies.
 *
 * What changes is computed from the repository trees, not from individual
 * commit diffs: the theme moves from its last synced update (base) to the
 * selected update (target), so
 *   - selecting the newest update applies every update in between, in one step
 *     ("Pick the newest. Everything before it comes too."),
 *   - going back to an earlier update undoes every change made after it,
 *   - a file changed and changed back in between is not touched at all.
 * The per-commit file lists are only used to show what each included update did.
 *
 * Safety rules applied here:
 *   - Protected files (brand settings, theme-editor content) that exist in the
 *     theme are never replaced or removed.
 *   - Required files (layout/theme.liquid, config/settings_*.json) are never removed.
 *   - Code check: Liquid / JSON errors block the update before it reaches Shopify.
 *   - Direct edit detection: files edited in Shopify since the last sync are
 *     reported, and the user must choose to replace them.
 */
import type { SyncHistoryRow, SyncKind, ThemeLine } from '../../drizzle/schema';
import type {
  CodeIssue,
  CommitFile,
  DirectEdit,
  IncludedCommit,
  IncludedCommitFile,
  ShopifyTheme,
  SyncPreferences,
  UpdateChecks,
  UpdateDirection,
  UpdateTotals,
} from '../../shared/api-types';
import {
  PROTECTED_THEME_FILES,
  THEME_SYNC_MARKER_PATH,
  isIgnored,
  isProtected,
  repoPathToThemePath,
  validateThemePath,
} from '../../shared/theme-paths';
import { bytesToBase64, gitBlobSha } from '../lib/crypto';
import {
  createRun,
  getFileChecksums,
  getThemeState,
  latestRunForTheme,
  listSyncOperations,
  type NewSyncOperation,
} from '../lib/database';
import type { GitHubClient, TreeEntry } from '../lib/github-client';
import { md5 } from '../lib/md5';
import { ApiError } from '../lib/response';
import { getTheme, getThemeFilesMetadata, listAllThemeFiles, type ThemeFileInfo } from '../lib/shopify-graphql';
import { checkThemeFile, isCheckedFile } from './code-check';
import { commitFilesCached, mapLimit, requireRepo, resolveBranch, type ShopRuntime } from './runtime';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PLANNED_OPERATIONS = 5000;
/** Files downloaded for the code check while planning; the rest are checked as they are applied. */
const MAX_CODE_CHECK_FILES = 150;
/** Files compared with their last synced version when no checksum was recorded. */
const MAX_DIRECT_EDIT_DOWNLOADS = 60;
/** Included updates whose file lists are shown. */
const MAX_COMMIT_DETAILS = 40;
const MAX_HISTORY_WALK = 300;
/** Backups are kept this long (KV expiration). */
export const BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface RunOptions {
  direction: UpdateDirection;
  totals: UpdateTotals;
  warnings: string[];
  /** Theme state before the run, so a restore can put it back. */
  previousState?: {
    lastSyncedSha: string | null;
    lastSyncedMessage: string | null;
    lastSyncedAt: number | null;
    lastSyncId: string | null;
    verifiedOnStagingAt: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------
export type MappedPath = { ok: true; themePath: string } | { ok: false; reason: string; themePath: string | null };

/** Maps a repository path to a theme file, or explains why it is not synced. */
export function mapPath(repoPath: string, prefs: SyncPreferences): MappedPath {
  const themePath = repoPathToThemePath(repoPath, prefs.themeRoot);
  if (themePath === null) return { ok: false, reason: `Outside theme root "${prefs.themeRoot}"`, themePath: null };
  if (themePath === THEME_SYNC_MARKER_PATH) return { ok: false, reason: 'Reserved for Theme Sync', themePath };
  const check = validateThemePath(themePath);
  if (!check.ok) return { ok: false, reason: check.reason, themePath };
  const ignoredBy = isIgnored(themePath, prefs.ignorePatterns);
  if (ignoredBy) return { ok: false, reason: `Matches ignore pattern "${ignoredBy}"`, themePath };
  return { ok: true, themePath };
}

/** Annotates commit files with their theme path (used by GET /api/commits/:sha/files). */
export function annotateCommitFiles(files: CommitFile[], prefs: SyncPreferences): CommitFile[] {
  return files.map((file) => {
    const mapped = mapPath(file.filename, prefs);
    return mapped.ok
      ? { ...file, themePath: mapped.themePath, themePathError: null }
      : { ...file, themePath: mapped.themePath, themePathError: mapped.reason };
  });
}

/** A commit's changed files as the +/~/- list shown on the Updates and Review screens. */
export function toIncludedFiles(files: CommitFile[], prefs: SyncPreferences): IncludedCommitFile[] {
  const out: IncludedCommitFile[] = [];
  const push = (repoPath: string, change: IncludedCommitFile['change']) => {
    const mapped = mapPath(repoPath, prefs);
    const path = mapped.themePath ?? repoPath;
    out.push({
      path,
      change,
      ignored: !mapped.ok,
      protected: mapped.ok && !!isProtected(path, prefs.protectedPatterns),
    });
  };
  for (const file of files) {
    if (file.status === 'unchanged') continue;
    if (file.status === 'removed') push(file.filename, 'removed');
    else if (file.status === 'added' || file.status === 'copied') push(file.filename, 'added');
    else if (file.status === 'renamed') {
      push(file.filename, 'added');
      if (file.previousFilename) push(file.previousFilename, 'removed');
    } else push(file.filename, 'modified');
  }
  return out;
}

interface TreeFile {
  repoPath: string;
  sha: string;
  size: number | null;
}

/** Theme files in a repository tree, keyed by theme path. */
export function themeFilesFromTree(entries: TreeEntry[], prefs: SyncPreferences): Map<string, TreeFile> {
  const files = new Map<string, TreeFile>();
  for (const entry of entries) {
    // Regular files only (skip symlinks 120000 and submodules 160000).
    if (entry.type !== 'blob' || !(entry.mode === '100644' || entry.mode === '100755')) continue;
    const mapped = mapPath(entry.path, prefs);
    if (mapped.ok) files.set(mapped.themePath, { repoPath: entry.path, sha: entry.sha, size: entry.size ?? null });
  }
  return files;
}

export interface PlannedChange {
  path: string;
  action: 'upsert' | 'delete';
  /** Whether the file exists in the target update. */
  repoPath: string | null;
  blobSha: string | null;
  size: number | null;
}

/** Exact difference between two trees (base null: every file of the target is written, nothing is removed). */
export function diffTrees(base: Map<string, TreeFile> | null, target: Map<string, TreeFile>): PlannedChange[] {
  const changes: PlannedChange[] = [];
  for (const [path, file] of target) {
    const before = base?.get(path);
    if (!before || before.sha !== file.sha) {
      changes.push({ path, action: 'upsert', repoPath: file.repoPath, blobSha: file.sha, size: file.size });
    }
  }
  if (base) {
    for (const path of base.keys()) {
      if (!target.has(path)) changes.push({ path, action: 'delete', repoPath: null, blobSha: null, size: null });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export interface PlanInput {
  kind: 'update' | 'publish' | 'rollback';
  line: ThemeLine;
  themeId: string;
  targetSha: string;
  userId: string | null;
  rolloutId?: string | null;
}

interface CommitInfo {
  sha: string;
  message: string;
  treeSha: string;
}

async function getCommitInfo(github: GitHubClient, owner: string, repo: string, sha: string): Promise<CommitInfo> {
  const page = await github.getCommitPage(owner, repo, sha, 1, 1);
  return { sha: page.commit.sha.toLowerCase(), message: page.commit.commit.message, treeSha: page.treeSha };
}

async function getTreeFiles(rt: ShopRuntime, github: GitHubClient, treeSha: string): Promise<Map<string, TreeFile>> {
  const repo = requireRepo(rt);
  const tree = await github.getTree(repo.owner, repo.repo, treeSha);
  if (tree.truncated) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'The repository is too large for GitHub to list in one request. Set the theme folder in Settings so only the theme is read.',
    );
  }
  return themeFilesFromTree(tree.entries, rt.settings.preferences);
}

/** Has `sha` fully completed on this store's Staging theme (now or earlier)? */
export async function verifiedOnStaging(rt: ShopRuntime, sha: string): Promise<Date | null> {
  const stagingId = rt.settings.stagingTheme?.id;
  if (!stagingId) return null;
  const state = await getThemeState(rt.db, rt.shop.id, stagingId);
  if (state?.lastSyncedSha === sha && state.verifiedOnStagingAt) return state.verifiedOnStagingAt;
  const row = await rt.db.query.syncHistory.findFirst({
    where: (h, { and, eq, inArray }) =>
      and(
        eq(h.shopId, rt.shop.id),
        eq(h.themeId, stagingId),
        eq(h.commitSha, sha),
        eq(h.status, 'succeeded'),
        inArray(h.kind, ['update', 'rollback']),
      ),
    orderBy: (h, { desc }) => [desc(h.completedAt)],
  });
  return row?.completedAt ?? null;
}

function assertThemeForKind(rt: ShopRuntime, input: PlanInput, theme: ShopifyTheme): void {
  const stagingId = rt.settings.stagingTheme?.id ?? null;
  if (input.kind === 'update') {
    if (!stagingId) throw new ApiError(400, 'SETUP_INCOMPLETE', 'Choose the Staging theme in Settings first');
    if (theme.id !== stagingId) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'New updates always go to the Staging theme first');
    }
    if (theme.isLive) {
      throw new ApiError(
        409,
        'THEME_NOT_WRITABLE',
        'The Staging theme is now the published theme. Choose an unpublished Staging theme in Settings.',
      );
    }
  }
  if (input.kind === 'publish' && theme.id === stagingId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Choose a Live theme other than the Staging theme');
  }
  if (theme.isLive && input.line !== 'live') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The published theme only receives Staging-verified updates');
  }
}

interface HistoryResult {
  direction: UpdateDirection;
  /** Updates applied (forward, oldest first) or undone (backward, newest first). */
  commits: { sha: string; message: string; date: string | null; authorName: string | null }[];
  more: number;
}

async function resolveHistory(rt: ShopRuntime, github: GitHubClient, base: string | null, target: string): Promise<HistoryResult> {
  const repo = requireRepo(rt);
  if (!base) return { direction: 'initial', commits: [], more: 0 };
  const forward = await github.listCommitsUntil(repo.owner, repo.repo, target, base, MAX_HISTORY_WALK);
  if (forward.found) {
    const commits = forward.commits.reverse().map((c) => ({ sha: c.sha, message: c.message, date: c.date, authorName: c.authorName }));
    return { direction: 'forward', commits, more: 0 };
  }
  const backward = await github.listCommitsUntil(repo.owner, repo.repo, base, target, MAX_HISTORY_WALK);
  if (backward.found) {
    const commits = backward.commits.map((c) => ({ sha: c.sha, message: c.message, date: c.date, authorName: c.authorName }));
    return { direction: 'backward', commits, more: 0 };
  }
  return { direction: 'rewritten', commits: [], more: 0 };
}

const sameChecksum = (expected: Uint8Array, shopify: string) => {
  const hex = [...expected].map((b) => b.toString(16).padStart(2, '0')).join('');
  return shopify.toLowerCase() === hex || shopify === bytesToBase64(expected);
};

async function runCodeCheck(
  rt: ShopRuntime,
  github: GitHubClient,
  commitSha: string,
  ops: NewSyncOperation[],
): Promise<UpdateChecks['code']> {
  const repo = requireRepo(rt);
  const candidates = ops.filter(
    (op) => op.status === 'pending' && op.action === 'upsert' && op.contentSource === 'github' && isCheckedFile(op.path),
  );
  const checked = candidates.slice(0, MAX_CODE_CHECK_FILES);
  const issues: CodeIssue[] = [];
  await mapLimit(checked, 6, async (op) => {
    const bytes = await github.getFileAtCommit(repo.owner, repo.repo, op.sourcePath ?? op.path, op.sourceCommitSha ?? commitSha);
    if (op.blobSha && (await gitBlobSha(bytes)) !== op.blobSha) {
      issues.push({ path: op.path, line: null, message: 'Downloaded content does not match the update (integrity check failed)' });
      return;
    }
    issues.push(...checkThemeFile(op.path, bytes));
  });
  issues.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  return {
    status: issues.length > 0 ? 'failed' : 'passed',
    filesChecked: checked.length,
    filesDeferred: candidates.length - checked.length,
    issues,
  };
}

async function detectDirectEdits(
  rt: ShopRuntime,
  github: GitHubClient,
  themeId: string,
  baseFiles: Map<string, TreeFile> | null,
  ops: NewSyncOperation[],
  existing: Map<string, ThemeFileInfo>,
): Promise<UpdateChecks['directEdits']> {
  if (!baseFiles) {
    return {
      status: 'skipped',
      files: [],
      note: 'This theme has no last synced update yet, so there is nothing to compare with.',
    };
  }
  const repo = requireRepo(rt);
  const touched = ops.filter((op) => op.status === 'pending' && op.contentSource !== 'marker' && existing.has(op.path));
  const recorded = await getFileChecksums(rt.db, rt.shop.id, themeId, touched.map((op) => op.path));
  const found: DirectEdit[] = [];
  const toDownload: { path: string; sha: string; checksum: string; updatedAt: string | null }[] = [];

  for (const op of touched) {
    const current = existing.get(op.path)!;
    if (!current.checksumMd5) continue;
    const saved = recorded.get(op.path);
    if (saved) {
      if (saved.toLowerCase() !== current.checksumMd5.toLowerCase()) {
        found.push({ path: op.path, updatedAt: current.updatedAt, reason: 'edited' });
      }
      continue;
    }
    const before = baseFiles.get(op.path);
    if (!before) {
      found.push({ path: op.path, updatedAt: current.updatedAt, reason: 'added' });
      continue;
    }
    toDownload.push({ path: op.path, sha: before.sha, checksum: current.checksumMd5, updatedAt: current.updatedAt });
  }

  const compared = toDownload.slice(0, MAX_DIRECT_EDIT_DOWNLOADS);
  await mapLimit(compared, 6, async (item) => {
    const bytes = await github.getBlob(repo.owner, repo.repo, item.sha);
    if (!sameChecksum(md5(bytes), item.checksum)) found.push({ path: item.path, updatedAt: item.updatedAt, reason: 'edited' });
  });
  const notCompared = toDownload.length - compared.length;
  found.sort((a, b) => a.path.localeCompare(b.path));
  return {
    status: found.length > 0 ? 'warning' : 'passed',
    files: found,
    note: notCompared > 0 ? `${notCompared} more file(s) were not compared because the update is very large.` : null,
  };
}

function markerOperation(): NewSyncOperation {
  return {
    path: THEME_SYNC_MARKER_PATH,
    sourcePath: null,
    previousPath: null,
    action: 'upsert',
    changeType: 'marker',
    blobSha: null,
    size: null,
    existsInTheme: null,
    status: 'pending',
    skipReason: null,
    contentSource: 'marker',
    backupState: 'pending',
  };
}

export function totalsOf(ops: NewSyncOperation[]): UpdateTotals {
  const files = ops.filter((op) => op.contentSource !== 'marker');
  return {
    added: files.filter((op) => op.status === 'pending' && op.action === 'upsert' && !op.existsInTheme).length,
    updated: files.filter((op) => op.status === 'pending' && op.action === 'upsert' && op.existsInTheme).length,
    removed: files.filter((op) => op.status === 'pending' && op.action === 'delete').length,
    protectedUntouched: files.filter((op) => op.status === 'skipped' && op.skipReason?.startsWith('Protected')).length,
    skipped: files.filter((op) => op.status === 'skipped' && !op.skipReason?.startsWith('Protected')).length,
  };
}

/** Creates the plan (status "previewed") and returns the stored run. */
export async function planRun(rt: ShopRuntime, input: PlanInput): Promise<SyncHistoryRow> {
  const repo = requireRepo(rt);
  const admin = await rt.admin();
  const github = await rt.github();
  const prefs = rt.settings.preferences;

  // 1. Theme of THIS store, and the rules for this kind of run.
  const theme = await getTheme(admin, input.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
  if (!theme.writable) {
    throw new ApiError(
      409,
      'THEME_NOT_WRITABLE',
      theme.processing ? 'The theme is still processing; try again shortly' : `A ${theme.role} theme cannot be changed`,
    );
  }
  assertThemeForKind(rt, input, theme);

  let verifiedAt: Date | null = null;
  if (input.kind === 'publish' || (input.kind === 'rollback' && input.line === 'live')) {
    verifiedAt = await verifiedOnStaging(rt, input.targetSha);
    if (!verifiedAt) {
      const previouslyLive = await rt.db.query.syncHistory.findFirst({
        where: (h, { and, eq }) =>
          and(eq(h.shopId, rt.shop.id), eq(h.themeId, theme.id), eq(h.commitSha, input.targetSha), eq(h.status, 'succeeded')),
      });
      if (input.kind === 'publish' || !previouslyLive) {
        throw new ApiError(
          422,
          'NOT_VERIFIED_ON_STAGING',
          'Only updates that fully completed on this store\'s Staging theme can be published to Live.',
        );
      }
    }
  }

  // 2. Where the theme is (base) and where it goes (target).
  const state = await getThemeState(rt.db, rt.shop.id, theme.id);
  const baseSha = state?.lastSyncedSha ?? null;
  if (baseSha === input.targetSha) {
    throw new ApiError(409, 'CONFLICT', `${theme.name} already runs update ${input.targetSha.slice(0, 7)}`);
  }
  const target = await getCommitInfo(github, repo.owner, repo.repo, input.targetSha);
  if (target.sha !== input.targetSha) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The update did not resolve exactly; use the full 40-character SHA');
  }
  let base: CommitInfo | null = null;
  const warnings: string[] = [];
  if (baseSha) {
    try {
      base = await getCommitInfo(github, repo.owner, repo.repo, baseSha);
    } catch (err) {
      if (!(err instanceof ApiError && (err.code === 'GITHUB_NOT_FOUND' || err.code === 'VALIDATION_ERROR'))) throw err;
      warnings.push(
        `The last synced update ${baseSha.slice(0, 7)} no longer exists in the repository. Every file of the selected ` +
          'update is written and nothing is removed.',
      );
    }
  }

  const [targetFiles, baseFiles] = await Promise.all([
    getTreeFiles(rt, github, target.treeSha),
    base ? getTreeFiles(rt, github, base.treeSha) : Promise.resolve(null),
  ]);
  const history = base ? await resolveHistory(rt, github, base.sha, target.sha) : { direction: baseSha ? 'rewritten' : 'initial', commits: [], more: 0 } as HistoryResult;

  if (input.kind === 'update' && history.direction === 'backward') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'This update is older than the one Staging runs. Use "Go back" instead.');
  }
  if (input.kind === 'rollback' && history.direction === 'forward') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'This update is newer than the one the theme runs; it is not going back.');
  }
  if (history.direction === 'initial') {
    warnings.push('This theme has no last synced update yet. The complete theme from the selected update is applied; nothing is removed.');
  }
  if (history.direction === 'rewritten' && base) {
    warnings.push(
      `The last synced update ${base.sha.slice(0, 7)} is not in this branch's history (the history was rewritten). ` +
        'The theme is changed to match the selected update exactly.',
    );
  }

  // 3. Exact file changes, compared with what is in the theme now.
  const changes = diffTrees(baseFiles, targetFiles);
  if (changes.length > MAX_PLANNED_OPERATIONS) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `This update would change ${changes.length} files (limit ${MAX_PLANNED_OPERATIONS}). Set the theme folder or ignore patterns in Settings.`,
    );
  }
  const existing =
    history.direction === 'initial' || changes.length > 250
      ? new Map((await listAllThemeFiles(admin, theme.id)).map((f) => [f.filename, f]))
      : await getThemeFilesMetadata(admin, theme.id, changes.map((c) => c.path));

  // Included updates and the files each one changed.
  const commitList =
    history.direction === 'forward' || history.direction === 'backward'
      ? history.commits
      : [{ sha: target.sha, message: target.message, date: null, authorName: null }];
  const detailed = commitList.slice(0, MAX_COMMIT_DETAILS);
  const included: IncludedCommit[] = await mapLimit(detailed, 5, async (commit) => {
    const files = await commitFilesCached(rt, commit.sha);
    return {
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      message: commit.message,
      date: commit.date,
      authorName: commit.authorName,
      files: history.direction === 'initial' ? [] : toIncludedFiles(files.files, prefs),
      filesTruncated: files.truncated || history.direction === 'initial',
    };
  });
  for (const commit of commitList.slice(MAX_COMMIT_DETAILS)) {
    included.push({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      message: commit.message,
      date: commit.date,
      authorName: commit.authorName,
      files: [],
      filesTruncated: true,
    });
  }
  // Which included update last touched each file (newest first).
  const touchedBy = new Map<string, string>();
  const newestFirst = history.direction === 'forward' ? [...included].reverse() : included;
  for (const commit of newestFirst) {
    for (const file of commit.files) if (!touchedBy.has(file.path)) touchedBy.set(file.path, commit.shortSha);
  }

  const ops: NewSyncOperation[] = changes.map((change) => {
    const inTheme = existing.get(change.path);
    const base = {
      path: change.path,
      sourcePath: change.repoPath,
      previousPath: null,
      action: change.action,
      blobSha: change.blobSha,
      size: change.size ?? inTheme?.size ?? null,
      existsInTheme: !!inTheme,
      contentSource: 'github' as const,
      sourceCommitSha: target.sha,
      introducedBy: touchedBy.get(change.path) ?? target.sha.slice(0, 7),
      backupState: 'pending' as const,
      skipReason: null as string | null,
      status: 'pending' as const,
    };
    const changeType = change.action === 'delete' ? 'removed' : inTheme ? 'modified' : 'added';
    const skip = (reason: string): NewSyncOperation => ({ ...base, changeType, status: 'skipped', skipReason: reason, backupState: null });

    if (change.action === 'delete') {
      if (!inTheme) return skip('Already removed from the theme');
      if (PROTECTED_THEME_FILES.includes(change.path)) return skip('Required theme file is never removed');
      if (isProtected(change.path, prefs.protectedPatterns)) return skip('Protected — kept as it is in Shopify');
    } else {
      if (inTheme && isProtected(change.path, prefs.protectedPatterns)) return skip('Protected — kept as it is in Shopify');
      if ((change.size ?? 0) > MAX_FILE_BYTES) return skip('File exceeds the 10 MB limit');
    }
    return { ...base, changeType };
  });
  ops.push(markerOperation());

  const writes = ops.filter((op) => op.status === 'pending' && op.contentSource !== 'marker');
  if (writes.length === 0) warnings.push('No theme file changes: only the last synced update is recorded.');

  // 4. Checks.
  const [code, directEdits] = await Promise.all([
    runCodeCheck(rt, github, target.sha, ops),
    detectDirectEdits(rt, github, theme.id, baseFiles, ops, existing),
  ]);
  if (code.filesDeferred > 0) {
    warnings.push(`${code.filesDeferred} more file(s) are checked for code errors as they are applied.`);
  }

  // 5. Persist the plan.
  const totals = totalsOf(ops);
  const id = crypto.randomUUID();
  const options: RunOptions = { direction: history.direction, totals, warnings };
  await createRun(rt.db, rt.shop.id, {
    id,
    repository: repo.fullName,
    branch: await resolveBranch(rt).catch(() => repo.branch),
    commitSha: target.sha,
    commitMessage: target.message.slice(0, 1000),
    themeId: theme.id,
    themeName: theme.name,
    themeRole: theme.role,
    strategy: history.direction === 'initial' ? 'full_snapshot' : 'commit_changes',
    kind: input.kind as SyncKind,
    line: input.line,
    baseSha: base?.sha ?? baseSha,
    baseMessage: base?.message.slice(0, 1000) ?? state?.lastSyncedMessage ?? null,
    commitsIncluded: included,
    checks: { code, directEdits } satisfies UpdateChecks,
    filesChanged: writes.length,
    filesSkipped: ops.filter((op) => op.status === 'skipped').length,
    options,
    initiatedBy: input.userId,
    verifiedOnStagingAt: verifiedAt,
    rolloutId: input.rolloutId ?? null,
    previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  }, ops);

  rt.logger.info('update.planned', { syncId: id, kind: input.kind, line: input.line, direction: history.direction, ...totals });
  const row = await rt.db.query.syncHistory.findFirst({ where: (h, { eq }) => eq(h.id, id) });
  return row!;
}

// ---------------------------------------------------------------------------
// Restore from backup
// ---------------------------------------------------------------------------
/**
 * Plans putting back the files of `source` exactly as they were before it ran,
 * from the backup it saved. Files the run created are removed again.
 */
export async function planRestore(rt: ShopRuntime, source: SyncHistoryRow, userId: string | null): Promise<SyncHistoryRow> {
  if (!['succeeded', 'partially_failed', 'failed'].includes(source.status) || source.kind === 'baseline') {
    throw new ApiError(409, 'CONFLICT', 'Only a finished update has a backup to restore');
  }
  if (source.completedAt && Date.now() - source.completedAt.getTime() > BACKUP_TTL_SECONDS * 1000) {
    throw new ApiError(410, 'BACKUP_UNAVAILABLE', 'Backups are kept for 30 days; this one has expired.');
  }
  const latest = await latestRunForTheme(rt.db, rt.shop.id, source.themeId);
  if (latest && latest.id !== source.id) {
    throw new ApiError(
      409,
      'CONFLICT',
      'A later update ran on this theme. Restore that one first, or go back to an earlier update instead.',
    );
  }

  const admin = await rt.admin();
  const theme = await getTheme(admin, source.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'The theme no longer exists in this store');
  if (!theme.writable) throw new ApiError(409, 'THEME_NOT_WRITABLE', `A ${theme.role} theme cannot be changed`);
  if (theme.isLive && source.line !== 'live') {
    throw new ApiError(409, 'THEME_NOT_WRITABLE', 'This theme is now published; restore it from the Live line instead.');
  }

  const sourceOps = await listSyncOperations(rt.db, rt.shop.id, source.id);
  // Files the run may have changed: written, or attempted at least once.
  const changed = sourceOps.filter(
    (op) => (op.status === 'succeeded' || (op.status === 'failed' && op.attempts > 0)) && (op.backupState === 'saved' || op.backupState === 'absent'),
  );
  if (changed.length === 0) throw new ApiError(409, 'BACKUP_UNAVAILABLE', 'This update did not change any file, so there is nothing to restore');

  const ops: NewSyncOperation[] = changed.map((op) => ({
    path: op.path,
    sourcePath: null,
    previousPath: null,
    action: op.backupState === 'saved' ? 'upsert' : 'delete',
    changeType: op.backupState === 'saved' ? 'modified' : 'removed',
    blobSha: null,
    size: op.size,
    existsInTheme: true,
    status: 'pending',
    skipReason: null,
    contentSource: op.backupState === 'saved' ? 'backup' : 'github',
    contentKey: op.backupState === 'saved' ? op.backupKey : null,
    introducedBy: source.commitSha.slice(0, 7),
    backupState: 'pending',
  }));

  const id = crypto.randomUUID();
  const totals = totalsOf(ops);
  const options: RunOptions = {
    direction: 'backward',
    totals,
    warnings: source.status === 'succeeded' ? [] : ['This update did not fully complete; only the files it changed are put back.'],
  };
  await createRun(rt.db, rt.shop.id, {
    id,
    repository: source.repository,
    branch: source.branch,
    // A restore returns the theme to the update it ran before ('' = none recorded).
    commitSha: source.baseSha ?? '',
    commitMessage: source.baseMessage,
    themeId: source.themeId,
    themeName: theme.name,
    themeRole: theme.role,
    strategy: 'commit_changes',
    kind: 'restore',
    line: source.line,
    baseSha: source.commitSha,
    baseMessage: source.commitMessage,
    commitsIncluded: source.commitsIncluded,
    checks: {
      code: { status: 'passed', filesChecked: 0, filesDeferred: 0, issues: [] },
      directEdits: { status: 'skipped', files: [], note: 'Restoring puts back the saved copies of the files.' },
    } satisfies UpdateChecks,
    filesChanged: ops.length,
    filesSkipped: 0,
    options,
    initiatedBy: userId,
    restoredFromId: source.id,
    verifiedOnStagingAt: null,
    previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  }, ops);
  const row = await rt.db.query.syncHistory.findFirst({ where: (h, { eq }) => eq(h.id, id) });
  return row!;
}
