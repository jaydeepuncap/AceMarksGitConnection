import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { CommitFiles } from '../components/CommitFiles';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingInline, LoadingState } from '../components/LoadingState';
import { ApiClientError, api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { CommitFileStats, CommitListItem, UpdateRun } from '../lib/types';

const PER_PAGE = 20;
/** Select value for "the store's branch" (an empty option value is not reliable in <s-select>). */
const STORE_BRANCH = '__store_branch__';

function FileCounts({ stats }: { stats: CommitFileStats | null }) {
  if (!stats) return <s-text color="subdued">—</s-text>;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-text type="strong">{`${stats.total}${stats.truncated ? '+' : ''} ${stats.total === 1 ? 'file' : 'files'}`}</s-text>
      {stats.added > 0 && <s-badge tone="success">{`${stats.added} added`}</s-badge>}
      {stats.modified > 0 && <s-badge tone="caution">{`${stats.modified} modified`}</s-badge>}
      {stats.renamed > 0 && <s-badge tone="info">{`${stats.renamed} renamed`}</s-badge>}
      {stats.removed > 0 && <s-badge tone="critical">{`${stats.removed} deleted`}</s-badge>}
    </s-stack>
  );
}

/**
 * Commits of a branch with their changed files. Select one and a theme, then
 * preview the synchronization: the review (checks, files, backup) opens and
 * nothing changes until it is confirmed there.
 */
export default function Commits() {
  const navigate = useNavigate();
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CommitListItem | null>(null);
  const [themeId, setThemeId] = useState('');

  const settings = useApiQuery(() => api.settings.get(), []);
  const branches = useApiQuery(() => api.github.branches({ perPage: 100 }), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const commits = useApiQuery(
    () => api.commits.list({ branch: branch || undefined, page, perPage: PER_PAGE, withFiles: true }),
    [branch, page],
  );
  const preview = useMutation(async (sha: string, target: string, isLive: boolean, branchName?: string): Promise<UpdateRun> => {
    if (isLive) return api.updates.plan({ kind: 'publish', targetSha: sha, themeId: target });
    try {
      return await api.updates.plan({ kind: 'update', targetSha: sha, themeId: target, branch: branchName });
    } catch (err) {
      // An older commit than the one the theme runs is applied as "go back".
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR' && /older/.test(err.message)) {
        return api.updates.plan({ kind: 'rollback', targetSha: sha, themeId: target, branch: branchName });
      }
      throw err;
    }
  });

  // Default target: an unpublished theme (updates are tested before Live).
  useEffect(() => {
    if (themeId || !themes.data?.length) return;
    const first = themes.data.find((t) => !t.isLive && t.writable) ?? themes.data[0];
    if (first) setThemeId(first.id);
  }, [themes.data, themeId]);

  const storeBranch = settings.data?.settings.branch ?? '';
  const target = themes.data?.find((t) => t.id === themeId) ?? null;

  const toggle = (sha: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });

  const startPreview = async () => {
    if (!selected || !target) return;
    const run = await preview.run(selected.sha, target.id, target.isLive, branch || storeBranch || undefined);
    if (run) {
      showToast('Preview ready. Nothing has changed yet.');
      navigate(`/updates/${run.id}`);
    }
  };

  if (commits.loading && !commits.data && !commits.error) return <LoadingState title="Commits" />;
  const items = commits.data?.items ?? [];

  return (
    <AppLayout
      title="Commits"
      subtitle="Choose a commit and a theme, then preview the synchronization. Nothing changes until you confirm."
      primaryAction={{
        content: 'Preview sync',
        onAction: startPreview,
        loading: preview.pending,
        disabled: !selected || !target || !target.writable,
      }}
      secondaryActions={[{ content: 'Refresh', onAction: commits.reload, loading: commits.loading }]}
      banners={
        <>
          <ErrorBanner error={commits.error} onRetry={commits.reload} heading="Commits could not be loaded" />
          <ErrorBanner error={preview.error} heading="The preview could not be created" onDismiss={preview.clearError} />
        </>
      }
    >
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          <s-select
            label="Branch"
            value={branch || STORE_BRANCH}
            details={branches.error ? branches.error.message : undefined}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setBranch(value === STORE_BRANCH ? '' : value);
              setPage(1);
              setSelected(null);
            }}
          >
            <s-option value={STORE_BRANCH}>{storeBranch ? `${storeBranch} (store branch)` : 'Repository default'}</s-option>
            {(branches.data?.items ?? [])
              .filter((b) => b.name !== storeBranch)
              .map((b) => (
                <s-option key={b.name} value={b.name}>
                  {b.name}
                </s-option>
              ))}
          </s-select>
          <s-select
            label="Sync to theme"
            value={themeId || 'none'}
            details={
              target?.isLive
                ? 'The published theme only receives commits already tested on an unpublished theme.'
                : 'Test on an unpublished theme first, then publish to Live.'
            }
            onChange={(event) => setThemeId(event.currentTarget.value === 'none' ? '' : event.currentTarget.value)}
          >
            {!themeId && <s-option value="none">Loading themes…</s-option>}
            {(themes.data ?? []).map((t) => (
              <s-option key={t.id} value={t.id} disabled={!t.writable}>
                {`${t.name}${t.isLive ? ' (Live)' : ''}${t.writable ? '' : ' — read-only'}`}
              </s-option>
            ))}
          </s-select>
        </s-grid>
      </s-section>

      {selected && (
        <s-banner tone="info" heading={`Selected ${selected.shortSha}: ${firstLine(selected.message)}`}>
          <s-paragraph>
            {target
              ? `Preview syncing this commit to ${target.name}. You will see every file, the checks and the backup before anything changes.`
              : 'Choose the theme to sync to.'}
          </s-paragraph>
          <s-button slot="secondary-actions" variant="primary" loading={preview.pending} disabled={!target} onClick={startPreview}>
            Preview sync
          </s-button>
          <s-button slot="secondary-actions" onClick={() => setSelected(null)}>
            Clear selection
          </s-button>
        </s-banner>
      )}

      <s-section heading={`Commits${commits.data ? ` · page ${page}` : ''}`}>
        {commits.loading && <LoadingInline label="Loading commits…" />}
        {!commits.loading && !commits.error && items.length === 0 && (
          <s-empty-state heading="No commits found">
            <s-paragraph>This branch has no commits, or the repository is not set up yet. Check Settings.</s-paragraph>
          </s-empty-state>
        )}
        <s-stack gap="base">
          {items.map((commit) => {
            const isSelected = selected?.sha === commit.sha;
            const expanded = open.has(commit.sha);
            return (
              <s-box key={commit.sha} border="base" borderRadius="base" padding="base" background={isSelected ? 'subdued' : 'base'}>
                <s-stack gap="small-200">
                  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="start">
                    <s-stack gap="small-300">
                      <s-text type="strong">{firstLine(commit.message)}</s-text>
                      <s-text color="subdued">
                        {`${commit.shortSha} · ${commit.authorName ?? commit.authorLogin ?? 'Unknown author'} · ${formatDate(commit.date)}`}
                      </s-text>
                      <FileCounts stats={commit.fileStats} />
                    </s-stack>
                    {isSelected && <s-badge tone="success">Selected</s-badge>}
                  </s-grid>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-button variant={isSelected ? 'secondary' : 'primary'} onClick={() => setSelected(isSelected ? null : commit)}>
                      {isSelected ? 'Unselect' : 'Select'}
                    </s-button>
                    <s-button variant="tertiary" onClick={() => toggle(commit.sha)}>
                      {expanded ? 'Hide changed files' : 'Show changed files'}
                    </s-button>
                    <s-link href={commit.htmlUrl} target="_blank">
                      View on GitHub
                    </s-link>
                    <s-text color="subdued">{commit.sha}</s-text>
                  </s-stack>
                  {expanded && (
                    <s-box padding="small" background="subdued" borderRadius="base">
                      <CommitFiles sha={commit.sha} />
                    </s-box>
                  )}
                </s-stack>
              </s-box>
            );
          })}
          {items.length > 0 && (
            <s-stack direction="inline" gap="small-200">
              <s-button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Newer
              </s-button>
              <s-button disabled={!commits.data?.hasNextPage} onClick={() => setPage((p) => p + 1)}>
                Older
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
