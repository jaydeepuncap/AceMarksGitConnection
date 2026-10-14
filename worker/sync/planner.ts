/**
 * Builds a sync plan (the "preview") without modifying the theme.
 *
 * commit_changes
 *   Uses the files GitHub lists for the selected commit (diff vs. first parent).
 *   added/modified/copied/changed → upsert; renamed → upsert new path and, if
 *   deletions are allowed, delete the old path; removed → delete if allowed.
 *   GitHub lists at most 3000 files per commit; larger commits produce a warning
 *   and should use full_snapshot.
 *
 * full_snapshot
 *   Uses the commit's full recursive tree, so it does not depend on the diff and
 *   works for any commit size up to GitHub's tree limit. Upserts every theme file
 *   in the tree. Never deletes theme files that are absent from the repository.
 *
 * Every path is validated (traversal, allowed theme directories) and filtered by
 * the ignore patterns before it is planned. Protected files are never deleted.
 */
import type {
  CodeIssue,
  CommitFile,
  DirectEdit,
  IncludedCommit,
  SyncChecks,
  ShopifyTheme,
  SyncPlanOperation,
  SyncPreferences,
  SyncPreview,
  SyncStrategy,
} from '../../shared/api-types';
import {
  PROTECTED_THEME_FILES,
  THEME_SYNC_MARKER_PATH,
  isIgnored,
  repoPathToThemePath,
  validateThemePath,
} from '../../shared/theme-paths';
import { createSyncPreview, type Database, type NewSyncOperation } from '../lib/database';
import { GITHUB_MAX_COMMIT_FILES, type GitHubClient } from '../lib/github-client';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import { resolveLastSynced } from './theme-state';
import {
  getTheme,
  getThemeFilesMetadata,
  listAllThemeFiles,
  type ShopifyGraphqlClient,
  type ThemeFileInfo,
} from '../lib/shopify-graphql';
import { bytesToBase64, gitBlobSha } from '../lib/crypto';
import { md5 } from '../lib/md5';
import { checkThemeFile, isCheckedFile } from './code-check';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PLANNED_OPERATIONS = 5000;
/** Files downloaded for the code check while previewing; the rest are checked as they are applied. */
const MAX_CODE_CHECK_FILES = 150;
/** Files compared with their last synced version when looking for direct edits. */
const MAX_DIRECT_EDIT_DOWNLOADS = 60;

const firstLine = (message: string) => message.split('\n')[0] ?? '';

export interface PlanInput {
  shopId: string;
  userId: string | null;
  owner: string;
  repo: string;
  branch: string | null;
  commitSha: string;
  themeId: string;
  strategy: SyncStrategy;
  allowDeletes: boolean;
  preferences: SyncPreferences;
  includePaths?: string[];
}

type PlannedOp = SyncPlanOperation;

function skip(path: string, sourcePath: string | null, changeType: string, reason: string): PlannedOp {
  return {
    path,
    sourcePath,
    previousPath: null,
    action: 'skip',
    changeType,
    existsInTheme: null,
    size: null,
    blobSha: null,
    skipReason: reason,
  };
}

/** Maps a repository path to a validated theme path, or returns a skip reason. */
export function mapPath(
  repoPath: string,
  prefs: SyncPreferences,
): { ok: true; themePath: string } | { ok: false; reason: string; themePath: string | null } {
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

/** Pure planning step for commit_changes (exported for tests). */
export function planCommitChanges(
  files: CommitFile[],
  prefs: SyncPreferences,
  allowDeletes: boolean,
): { ops: PlannedOp[]; warnings: string[] } {
  const ops = new Map<string, PlannedOp>();
  const skipped: PlannedOp[] = [];
  const warnings: string[] = [];
  let deletesDisabled = 0;

  const put = (op: PlannedOp) => {
    const existing = ops.get(op.path);
    // An upsert of a path always wins over a delete of the same path (e.g. A→B rename + new A).
    if (!existing || (existing.action === 'delete' && op.action === 'upsert')) ops.set(op.path, op);
  };

  const planDelete = (repoPath: string, changeType: string) => {
    const mapped = mapPath(repoPath, prefs);
    if (!mapped.ok) {
      if (mapped.themePath !== null) skipped.push(skip(mapped.themePath, repoPath, changeType, mapped.reason));
      return;
    }
    if (PROTECTED_THEME_FILES.includes(mapped.themePath)) {
      skipped.push(skip(mapped.themePath, repoPath, changeType, 'Protected file is never deleted'));
      return;
    }
    if (!allowDeletes) {
      deletesDisabled++;
      skipped.push(skip(mapped.themePath, repoPath, changeType, 'Deletions are disabled for this sync'));
      return;
    }
    put({
      path: mapped.themePath,
      sourcePath: repoPath,
      previousPath: null,
      action: 'delete',
      changeType,
      existsInTheme: null,
      size: null,
      blobSha: null,
      skipReason: null,
    });
  };

  for (const file of files) {
    switch (file.status) {
      case 'added':
      case 'modified':
      case 'changed':
      case 'copied':
      case 'renamed': {
        const mapped = mapPath(file.filename, prefs);
        if (!mapped.ok) {
          skipped.push(skip(mapped.themePath ?? file.filename, file.filename, file.status, mapped.reason));
        } else if (!file.blobSha) {
          skipped.push(skip(mapped.themePath, file.filename, file.status, 'GitHub did not report a blob SHA'));
        } else {
          const previous = file.previousFilename ? mapPath(file.previousFilename, prefs) : null;
          put({
            path: mapped.themePath,
            sourcePath: file.filename,
            previousPath: previous && previous.ok ? previous.themePath : null,
            action: 'upsert',
            changeType: file.status,
            existsInTheme: null,
            size: null,
            blobSha: file.blobSha,
            skipReason: null,
          });
        }
        // A rename removes the old path; a copy does not.
        if (file.status === 'renamed' && file.previousFilename) planDelete(file.previousFilename, 'renamed');
        break;
      }
      case 'removed':
        planDelete(file.filename, 'removed');
        break;
      case 'unchanged':
        break;
    }
  }

  if (deletesDisabled > 0) {
    warnings.push(
      `${deletesDisabled} file(s) were removed or renamed away in this commit but will stay in the theme ` +
        'because deletions are disabled.',
    );
  }
  // Drop skips for paths that are otherwise planned.
  const finalSkips = skipped.filter((s) => !ops.has(s.path));
  return { ops: [...ops.values(), ...finalSkips], warnings };
}

interface TreeFile {
  repoPath: string;
  sha: string;
  size: number | null;
}

async function themeTree(
  github: GitHubClient,
  owner: string,
  repo: string,
  treeSha: string,
  prefs: SyncPreferences,
): Promise<Map<string, TreeFile> & { outside?: number }> {
  const tree = await github.getTree(owner, repo, treeSha);
  if (tree.truncated) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'The repository tree is too large for GitHub to list in one request. Set a theme root folder in Settings so only the theme directory is synced.',
    );
  }
  const files: Map<string, TreeFile> & { outside?: number } = new Map<string, TreeFile>();
  let outside = 0;
  for (const entry of tree.entries) {
    // Regular files only (skip symlinks 120000 and submodules 160000).
    if (entry.type !== 'blob' || !(entry.mode === '100644' || entry.mode === '100755')) continue;
    const mapped = mapPath(entry.path, prefs);
    if (mapped.ok) files.set(mapped.themePath, { repoPath: entry.path, sha: entry.sha, size: entry.size ?? null });
    else outside++;
  }
  files.outside = outside;
  return files;
}

const md5Matches = (bytes: Uint8Array, checksum: string) => {
  const digest = md5(bytes);
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  return checksum.toLowerCase() === hex || checksum === bytesToBase64(digest);
};

/** Step 3: code check (Liquid / JSON) of the files that will be written. */
async function runCodeCheck(
  github: GitHubClient,
  input: PlanInput,
  ops: PlannedOp[],
): Promise<SyncChecks['code']> {
  const candidates = ops.filter((op) => op.action === 'upsert' && isCheckedFile(op.path));
  const checked = candidates.slice(0, MAX_CODE_CHECK_FILES);
  const issues: CodeIssue[] = [];
  for (let i = 0; i < checked.length; i += 6) {
    await Promise.all(
      checked.slice(i, i + 6).map(async (op) => {
        const bytes = await github.getFileAtCommit(input.owner, input.repo, op.sourcePath ?? op.path, input.commitSha);
        if (op.blobSha && (await gitBlobSha(bytes)) !== op.blobSha) {
          issues.push({ path: op.path, line: null, message: 'Downloaded content does not match the commit (integrity check failed)' });
          return;
        }
        issues.push(...checkThemeFile(op.path, bytes));
      }),
    );
  }
  issues.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  return {
    status: issues.length > 0 ? 'failed' : 'passed',
    filesChecked: checked.length,
    filesDeferred: candidates.length - checked.length,
    issues,
  };
}

/**
 * Step 3: files the sync replaces or removes that were edited directly in
 * Shopify since the last sync — the theme's copy no longer matches the file
 * at the last synced commit.
 */
async function detectDirectEdits(
  github: GitHubClient,
  input: PlanInput,
  baseFiles: Map<string, TreeFile> | null,
  ops: PlannedOp[],
  existing: Map<string, ThemeFileInfo>,
): Promise<SyncChecks['directEdits']> {
  if (!baseFiles) {
    return { status: 'skipped', files: [], note: 'This theme has no last synced commit on this branch yet, so there is nothing to compare with.' };
  }
  const touched = ops.filter((op) => op.action !== 'skip' && existing.has(op.path));
  const found: DirectEdit[] = [];
  const compare: { path: string; sha: string; checksum: string; updatedAt: string | null }[] = [];
  for (const op of touched) {
    const current = existing.get(op.path)!;
    if (!current.checksumMd5) continue;
    const before = baseFiles.get(op.path);
    if (!before) found.push({ path: op.path, updatedAt: current.updatedAt });
    else compare.push({ path: op.path, sha: before.sha, checksum: current.checksumMd5, updatedAt: current.updatedAt });
  }
  const limited = compare.slice(0, MAX_DIRECT_EDIT_DOWNLOADS);
  for (let i = 0; i < limited.length; i += 6) {
    await Promise.all(
      limited.slice(i, i + 6).map(async (item) => {
        const bytes = await github.getBlob(input.owner, input.repo, item.sha);
        if (!md5Matches(bytes, item.checksum)) found.push({ path: item.path, updatedAt: item.updatedAt });
      }),
    );
  }
  found.sort((a, b) => a.path.localeCompare(b.path));
  const notCompared = compare.length - limited.length;
  return {
    status: found.length > 0 ? 'warning' : 'passed',
    files: found,
    note: notCompared > 0 ? `${notCompared} more file(s) were not compared because the sync is very large.` : null,
  };
}

export async function buildSyncPreview(
  deps: { db: Database; github: GitHubClient; admin: ShopifyGraphqlClient; kv: KVNamespace; logger: Logger },
  input: PlanInput,
): Promise<SyncPreview> {
  const { db, github, admin, logger } = deps;

  // 1. Theme must exist in THIS shop (queried with this shop's own token).
  const theme: ShopifyTheme | null = await getTheme(admin, input.themeId);
  if (!theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
  if (!theme.writable) {
    throw new ApiError(
      409,
      'THEME_NOT_WRITABLE',
      theme.processing ? 'The theme is still processing; try again shortly' : `A ${theme.role} theme cannot be modified`,
    );
  }

  // 2. Commit (exact SHA) and its files.
  const commitData = await github.getAllCommitFiles(input.owner, input.repo, input.commitSha);
  if (commitData.commit.sha.toLowerCase() !== input.commitSha) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Commit SHA did not resolve exactly; use the full 40-character SHA');
  }

  // The commit this theme was last synced to from this branch (the "current" update),
  // recovered from the sync history or the theme's assets/theme-sync.json when needed.
  const last = input.branch
    ? await resolveLastSynced(deps, {
        shopId: input.shopId,
        themeId: theme.id,
        branch: input.branch,
        repository: `${input.owner}/${input.repo}`,
      })
    : undefined;
  if (input.strategy === 'since_last_sync' && last?.commitSha === input.commitSha) {
    throw new ApiError(409, 'CONFLICT', `${theme.name} is already on ${input.commitSha.slice(0, 7)} from ${input.branch}`);
  }

  // Updates between the last synced commit and the selected one. When some of
  // them are not in the theme yet, they are applied together with the selected
  // commit (a theme never skips an update).
  let since: Awaited<ReturnType<GitHubClient['listCommitsUntil']>> | null = null;
  let strategy: SyncStrategy = input.strategy;
  const warnings: string[] = [];
  if (last && last.commitSha !== input.commitSha && strategy !== 'full_snapshot') {
    since = await github.listCommitsUntil(input.owner, input.repo, input.commitSha, last.commitSha, 300);
    const earlier = since.found ? since.commits.length - 1 : 0;
    if (strategy === 'commit_changes' && earlier > 0 && !(input.includePaths && input.includePaths.length > 0)) {
      strategy = 'since_last_sync';
      warnings.push(
        `${earlier} earlier update(s) on ${input.branch} are not in ${theme.name} yet, so they are applied together with this one.`,
      );
    }
  }
  let baseFiles: Map<string, TreeFile> | null = null;
  let baseMessage: string | null = last?.commitMessage ?? null;
  if (last) {
    try {
      const baseCommit = await github.getCommitPage(input.owner, input.repo, last.commitSha, 1, 1);
      baseMessage = baseCommit.commit.commit.message;
      baseFiles = await themeTree(github, input.owner, input.repo, baseCommit.treeSha, input.preferences);
    } catch (err) {
      if (!(err instanceof ApiError && (err.code === 'GITHUB_NOT_FOUND' || err.code === 'VALIDATION_ERROR'))) throw err;
    }
  }

  let ops: PlannedOp[];
  let commitsIncluded: IncludedCommit[] = [
    { sha: input.commitSha, shortSha: input.commitSha.slice(0, 7), message: commitData.commit.commit.message },
  ];

  if (strategy === 'since_last_sync' && !baseFiles) {
    warnings.push(
      last
        ? `The last synced commit ${last.commitSha.slice(0, 7)} no longer exists in the repository, so the complete theme from this commit is applied (nothing is removed).`
        : 'This theme has no last synced commit on this branch yet, so the complete theme from this commit is applied (nothing is removed).',
    );
    strategy = 'full_snapshot';
  }

  if (strategy === 'since_last_sync' && baseFiles && last) {
    // Every update between the last synced commit and the selected one, in one step.
    const targetFiles = await themeTree(github, input.owner, input.repo, commitData.treeSha, input.preferences);
    const walk = since ?? (await github.listCommitsUntil(input.owner, input.repo, input.commitSha, last.commitSha, 300));
    if (walk.found) {
      commitsIncluded = walk.commits
        .reverse()
        .map((c) => ({ sha: c.sha, shortSha: c.shortSha, message: c.message }));
    } else {
      const back = await github.listCommitsUntil(input.owner, input.repo, last.commitSha, input.commitSha, 300);
      if (back.found) {
        warnings.push(`This commit is older than the theme's last synced commit ${last.commitSha.slice(0, 7)}: the changes made after it are undone.`);
        commitsIncluded = back.commits.map((c) => ({ sha: c.sha, shortSha: c.shortSha, message: `Undo: ${firstLine(c.message)}` }));
      } else {
        warnings.push(`The last synced commit ${last.commitSha.slice(0, 7)} is not in this commit's history; the theme is changed to match this commit exactly.`);
      }
    }
    ops = [];
    let deletesDisabled = 0;
    for (const [path, file] of targetFiles) {
      const before = baseFiles.get(path);
      if (!before || before.sha !== file.sha) {
        ops.push({
          path,
          sourcePath: file.repoPath,
          previousPath: null,
          action: (file.size ?? 0) > MAX_FILE_BYTES ? 'skip' : 'upsert',
          changeType: before ? 'modified' : 'added',
          existsInTheme: null,
          size: file.size,
          blobSha: file.sha,
          skipReason: (file.size ?? 0) > MAX_FILE_BYTES ? 'File exceeds the 10 MB sync limit' : null,
        });
      }
    }
    for (const [path, file] of baseFiles) {
      if (targetFiles.has(path)) continue;
      if (PROTECTED_THEME_FILES.includes(path)) {
        ops.push(skip(path, file.repoPath, 'removed', 'Protected file is never deleted'));
      } else if (!input.allowDeletes) {
        deletesDisabled++;
        ops.push(skip(path, file.repoPath, 'removed', 'Deletions are disabled for this sync'));
      } else {
        ops.push({ path, sourcePath: file.repoPath, previousPath: null, action: 'delete', changeType: 'removed', existsInTheme: null, size: null, blobSha: null, skipReason: null });
      }
    }
    if (deletesDisabled > 0) {
      warnings.push(`${deletesDisabled} file(s) removed since the last sync stay in the theme because deletions are disabled.`);
    }
  } else if (strategy === 'commit_changes') {
    if (commitData.truncated) {
      warnings.push(
        `GitHub lists at most ${GITHUB_MAX_COMMIT_FILES} changed files per commit and this commit reached that ` +
          'limit. Some changes are missing from this plan; use the "Full snapshot" strategy instead.',
      );
    }
    if (commitData.commit.parents.length > 1) {
      warnings.push('This is a merge commit. Changed files are computed against its first parent.');
    }
    if (commitData.commit.parents.length === 0) {
      warnings.push('This is the repository\'s first commit; every file it contains is listed as added.');
    }
    const planned = planCommitChanges(commitData.files, input.preferences, input.allowDeletes);
    ops = planned.ops;
    warnings.push(...planned.warnings);
  } else {
    const targetFiles = await themeTree(github, input.owner, input.repo, commitData.treeSha, input.preferences);
    ops = [];
    for (const [path, file] of targetFiles) {
      if ((file.size ?? 0) > MAX_FILE_BYTES) {
        ops.push(skip(path, file.repoPath, 'snapshot', 'File exceeds the 10 MB sync limit'));
        continue;
      }
      ops.push({
        path,
        sourcePath: file.repoPath,
        previousPath: null,
        action: 'upsert',
        changeType: 'snapshot',
        existsInTheme: null,
        size: file.size,
        blobSha: file.sha,
        skipReason: null,
      });
    }
    if (targetFiles.outside) warnings.push(`${targetFiles.outside} repository file(s) are not theme files and were ignored.`);
    warnings.push('Full snapshot never deletes theme files that are missing from the repository.');
  }

  if (input.includePaths && input.includePaths.length > 0) {
    const wanted = new Set(input.includePaths);
    ops = ops.filter((op) => wanted.has(op.path));
  }

  if (ops.length > MAX_PLANNED_OPERATIONS) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `This sync would touch ${ops.length} files (limit ${MAX_PLANNED_OPERATIONS}). Narrow it with a theme root or ignore patterns.`,
    );
  }

  // 3. Compare against the target theme (metadata only).
  const writes = ops.filter((op) => op.action !== 'skip');
  const existing =
    strategy === 'full_snapshot' || writes.length > 250
      ? new Map((await listAllThemeFiles(admin, theme.id)).map((f) => [f.filename, f]))
      : await getThemeFilesMetadata(
          admin,
          theme.id,
          writes.map((op) => op.path),
        );

  ops = ops.map((op) => {
    if (op.action === 'skip') return op;
    const exists = existing.has(op.path);
    if (op.action === 'delete' && !exists) {
      return { ...op, action: 'skip', existsInTheme: false, skipReason: 'File is not present in the theme' };
    }
    return { ...op, existsInTheme: exists, size: op.size ?? existing.get(op.path)?.size ?? null };
  });

  if (input.preferences.ignorePatterns.includes('config/settings_data.json')) {
    // Only mention it when the commit actually touched it.
    if (ops.some((op) => op.path === 'config/settings_data.json')) {
      warnings.push('config/settings_data.json is excluded to preserve theme editor customizations.');
    }
  }
  if (theme.isLive) {
    warnings.push('This is the LIVE theme. Changes are visible to customers immediately after sync.');
  }

  // 4. Automatic checks (step 3) — before anything changes.
  const [code, directEdits] = await Promise.all([
    runCodeCheck(github, input, ops),
    detectDirectEdits(github, input, baseFiles, ops, existing),
  ]);
  if (code.filesDeferred > 0) warnings.push(`${code.filesDeferred} more file(s) are checked for code errors as they are applied.`);
  const checks: SyncChecks = { code, directEdits };

  const summary = {
    creates: ops.filter((op) => op.action === 'upsert' && !op.existsInTheme).length,
    updates: ops.filter((op) => op.action === 'upsert' && op.existsInTheme).length,
    deletes: ops.filter((op) => op.action === 'delete').length,
    skipped: ops.filter((op) => op.action === 'skip').length,
    total: ops.length,
  };

  // 5. Persist the plan so POST /api/sync executes exactly what was previewed.
  const syncId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
  const persisted: NewSyncOperation[] = ops.map((op) => ({
    path: op.path,
    sourcePath: op.sourcePath,
    previousPath: op.previousPath,
    action: op.action === 'delete' ? 'delete' : 'upsert',
    changeType: op.changeType,
    blobSha: op.blobSha,
    size: op.size,
    existsInTheme: op.existsInTheme,
    status: op.action === 'skip' ? 'skipped' : 'pending',
    skipReason: op.skipReason,
  }));

  const base = last && baseFiles ? { sha: last.commitSha, shortSha: last.commitSha.slice(0, 7), message: baseMessage } : null;
  await createSyncPreview(
    db,
    input.shopId,
    {
      id: syncId,
      repository: `${input.owner}/${input.repo}`,
      branch: input.branch,
      commitSha: input.commitSha,
      commitMessage: commitData.commit.commit.message.slice(0, 1000),
      themeId: theme.id,
      themeName: theme.name,
      themeRole: theme.role,
      strategy,
      filesChanged: summary.creates + summary.updates + summary.deletes,
      filesSkipped: summary.skipped,
      options: {
        allowDeletes: input.allowDeletes,
        themeRoot: input.preferences.themeRoot,
        baseSha: base?.sha ?? null,
        commitsIncluded: commitsIncluded.slice(0, 100),
        checks,
      },
      initiatedBy: input.userId,
      previewExpiresAt: expiresAt,
    },
    persisted,
  );

  logger.info('sync.previewed', { syncId, commitSha: input.commitSha, themeId: theme.id, strategy, ...summary });

  return {
    syncId,
    expiresAt: expiresAt.toISOString(),
    base,
    commitsIncluded,
    checks,
    repository: `${input.owner}/${input.repo}`,
    branch: input.branch,
    commit: { sha: input.commitSha, message: commitData.commit.commit.message },
    theme,
    strategy,
    operations: ops,
    summary,
    warnings,
    requiresLiveConfirmation: theme.isLive,
  };
}
