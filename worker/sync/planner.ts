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
  CommitFile,
  ShopifyTheme,
  SyncPlanOperation,
  SyncPreferences,
  SyncPreview,
  SyncStrategy,
} from '@shared/api-types';
import {
  PROTECTED_THEME_FILES,
  isIgnored,
  repoPathToThemePath,
  validateThemePath,
} from '@shared/theme-paths';
import { createSyncPreview, type Database, type NewSyncOperation } from '../lib/database';
import { GITHUB_MAX_COMMIT_FILES, type GitHubClient } from '../lib/github-client';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import {
  getTheme,
  getThemeFilesMetadata,
  listAllThemeFiles,
  type ShopifyGraphqlClient,
} from '../lib/shopify-graphql';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PLANNED_OPERATIONS = 5000;

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

export async function buildSyncPreview(
  deps: { db: Database; github: GitHubClient; admin: ShopifyGraphqlClient; logger: Logger },
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

  const warnings: string[] = [];
  let ops: PlannedOp[];

  if (input.strategy === 'commit_changes') {
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
    const tree = await github.getTree(input.owner, input.repo, commitData.treeSha);
    if (tree.truncated) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'The repository tree is too large for GitHub to list in one request. Set a theme root folder in Settings ' +
          'so only the theme directory is synced.',
      );
    }
    ops = [];
    let outside = 0;
    for (const entry of tree.entries) {
      // Regular files only (skip symlinks 120000 and submodules 160000).
      if (entry.type !== 'blob' || !(entry.mode === '100644' || entry.mode === '100755')) continue;
      const mapped = mapPath(entry.path, input.preferences);
      if (!mapped.ok) {
        if (mapped.themePath === null || !mapped.reason.startsWith('Matches ignore')) {
          outside++;
          continue;
        }
        ops.push(skip(mapped.themePath, entry.path, 'snapshot', mapped.reason));
        continue;
      }
      if ((entry.size ?? 0) > MAX_FILE_BYTES) {
        ops.push(skip(mapped.themePath, entry.path, 'snapshot', 'File exceeds the 10 MB sync limit'));
        continue;
      }
      ops.push({
        path: mapped.themePath,
        sourcePath: entry.path,
        previousPath: null,
        action: 'upsert',
        changeType: 'snapshot',
        existsInTheme: null,
        size: entry.size ?? null,
        blobSha: entry.sha,
        skipReason: null,
      });
    }
    if (outside > 0) warnings.push(`${outside} repository file(s) are not theme files and were ignored.`);
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
    input.strategy === 'full_snapshot'
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

  const summary = {
    creates: ops.filter((op) => op.action === 'upsert' && !op.existsInTheme).length,
    updates: ops.filter((op) => op.action === 'upsert' && op.existsInTheme).length,
    deletes: ops.filter((op) => op.action === 'delete').length,
    skipped: ops.filter((op) => op.action === 'skip').length,
    total: ops.length,
  };

  // 4. Persist the plan so POST /api/sync executes exactly what was previewed.
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
      strategy: input.strategy,
      filesChanged: summary.creates + summary.updates + summary.deletes,
      filesSkipped: summary.skipped,
      options: { allowDeletes: input.allowDeletes, themeRoot: input.preferences.themeRoot },
      initiatedBy: input.userId,
      previewExpiresAt: expiresAt,
    },
    persisted,
  );

  logger.info('sync.previewed', { syncId, commitSha: input.commitSha, themeId: theme.id, ...summary });

  return {
    syncId,
    expiresAt: expiresAt.toISOString(),
    repository: `${input.owner}/${input.repo}`,
    branch: input.branch,
    commit: { sha: input.commitSha, message: commitData.commit.commit.message },
    theme,
    strategy: input.strategy,
    operations: ops,
    summary,
    warnings,
    requiresLiveConfirmation: theme.isLive,
  };
}
