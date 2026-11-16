/**
 * Multiple-commit sync: combines several selected commits of one branch.
 *
 * Strategy (per theme file, in branch order oldest → newest):
 *   - each selected commit is planned on its own exactly like a single-commit
 *     sync (same ignore, protection, rename and deletion rules);
 *   - the plans are merged so the NEWEST selected commit that touched a file
 *     decides its final state: its content (taken from that exact commit SHA),
 *     its deletion, or the skip reason. A rename deletes the old path unless a
 *     later selected commit brings that path back.
 * For a contiguous selection this equals the net change between the oldest
 * commit's parent and the newest commit. For a selection with gaps, a file's
 * content at a selected commit can also contain changes from an unselected
 * commit in between: those files are listed as conflicts before anything is
 * written. Commits must belong to the selected branch's history.
 */
import type { IncludedCommit, SyncPlanOperation, SyncPreferences } from '../../shared/api-types';
import type { GitHubClient } from '../lib/github-client';
import { ApiError } from '../lib/response';
import { mapPath, planCommitChanges } from './planner';

/** How far back in the branch the selected commits may be. */
export const BRANCH_HISTORY_LIMIT = 300;
/** Unselected commits in between that are inspected for overlapping changes. */
const MAX_GAP_COMMITS_CHECKED = 30;
const MAX_CONFLICTS_LISTED = 20;

export interface SelectedCommitsPlan {
  ops: SyncPlanOperation[];
  commitsIncluded: IncludedCommit[];
  warnings: string[];
  conflicts: string[];
}

const firstLine = (message: string) => message.split('\n')[0] ?? '';

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function planSelectedCommits(
  github: GitHubClient,
  input: {
    owner: string;
    repo: string;
    branch: string;
    commitShas: string[];
    preferences: SyncPreferences;
    allowDeletes: boolean;
  },
): Promise<SelectedCommitsPlan> {
  const selected = [...new Set(input.commitShas.map((s) => s.toLowerCase()))];

  // 1. Every selected commit must be on the branch; their order comes from the branch history.
  const history = await github.listCommitsUntil(input.owner, input.repo, input.branch, null, BRANCH_HISTORY_LIMIT);
  const position = new Map(history.commits.map((c, i) => [c.sha.toLowerCase(), i])); // 0 = newest
  const outside = selected.filter((sha) => !position.has(sha));
  if (outside.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `${outside.map((s) => s.slice(0, 7)).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not among the last ${BRANCH_HISTORY_LIMIT} commits of ${input.branch}. Only commits of the selected branch can be synced together.`,
    );
  }
  const ordered = [...selected].sort((a, b) => position.get(b)! - position.get(a)!); // oldest first
  const summary = (sha: string) => history.commits[position.get(sha)!]!;

  // 2. Plan each selected commit on its own.
  const plans = await mapLimit(ordered, 4, async (sha) => {
    const data = await github.getAllCommitFiles(input.owner, input.repo, sha);
    return { sha, data, plan: planCommitChanges(data.files, input.preferences, input.allowDeletes) };
  });

  const warnings: string[] = [];
  for (const { sha, data } of plans) {
    if (data.truncated) {
      warnings.push(`${sha.slice(0, 7)} changes more files than GitHub lists (3000); some of its changes are missing. Use a full sync instead.`);
    }
    if (data.commit.parents.length > 1) {
      warnings.push(`${sha.slice(0, 7)} is a merge commit; its changes are computed against its first parent.`);
    }
  }

  // 3. Merge oldest → newest: the newest selected commit decides each file.
  const final = new Map<string, SyncPlanOperation>();
  const touchedBy = new Map<string, string[]>();
  for (const { sha, plan } of plans) {
    for (const op of plan.ops) {
      final.set(op.path, { ...op, sourceCommitSha: sha });
      const list = touchedBy.get(op.path) ?? [];
      list.push(sha.slice(0, 7));
      touchedBy.set(op.path, list);
    }
  }
  const multi = [...touchedBy.values()].filter((l) => l.length > 1).length;
  if (multi > 0) {
    warnings.push(`${multi} file(s) changed in more than one selected commit: the version from the newest of them is used.`);
  }
  const deletesDisabled = [...final.values()].filter((op) => op.skipReason === 'Deletions are disabled for this sync').length;
  if (deletesDisabled > 0) {
    warnings.push(`${deletesDisabled} file(s) removed or renamed away in the selected commits stay in the theme because deletions are disabled.`);
  }

  // 4. Unselected commits between the selected ones that changed the same files.
  const conflicts: string[] = [];
  const oldest = position.get(ordered[0]!)!;
  const newest = position.get(ordered[ordered.length - 1]!)!;
  const gap = history.commits.slice(newest + 1, oldest).filter((c) => !selected.includes(c.sha.toLowerCase())); // newest first
  if (gap.length > 0) {
    const checked = gap.slice(0, MAX_GAP_COMMITS_CHECKED);
    const gapFiles = await mapLimit(checked, 4, (c) => github.getAllCommitFiles(input.owner, input.repo, c.sha));
    checked.forEach((u, i) => {
      for (const file of gapFiles[i]!.files) {
        for (const repoPath of [file.filename, file.previousFilename]) {
          if (!repoPath) continue;
          const mapped = mapPath(repoPath, input.preferences);
          if (!mapped.ok) continue;
          const op = final.get(mapped.themePath);
          if (!op || op.action !== 'upsert' || !op.sourceCommitSha) continue;
          // The file is taken from a selected commit made AFTER the unselected one: it carries that change too.
          if (position.get(op.sourceCommitSha)! < position.get(u.sha.toLowerCase())!) {
            conflicts.push(
              `${mapped.themePath}: the version from ${op.sourceCommitSha.slice(0, 7)} also contains the change from ${u.shortSha} "${firstLine(u.message)}", which is not selected.`,
            );
          }
        }
      }
    });
    if (gap.length > checked.length) {
      warnings.push(`${gap.length} unselected commits lie between the selected ones; only the newest ${checked.length} were checked for overlapping files.`);
    }
  }
  const uniqueConflicts = [...new Set(conflicts)];
  if (uniqueConflicts.length > 0) {
    warnings.push(
      `${uniqueConflicts.length} file(s) overlap with commits that are not selected. A file is always written as a whole, so these files also bring those changes: ${uniqueConflicts
        .slice(0, MAX_CONFLICTS_LISTED)
        .join(' ')}${uniqueConflicts.length > MAX_CONFLICTS_LISTED ? ' …' : ''} Select the missing commits too, or select a continuous range, to avoid surprises.`,
    );
  }

  const ops = [...final.values()].map((op) => ({ ...op, commits: touchedBy.get(op.path) ?? [] }));
  const commitsIncluded = ordered.map((sha) => {
    const c = summary(sha);
    return { sha: c.sha, shortSha: c.shortSha, message: c.message };
  });
  return { ops, commitsIncluded, warnings, conflicts: uniqueConflicts };
}
