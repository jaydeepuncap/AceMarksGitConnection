import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, KIND_LABEL, STATUS_BADGE } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { UpdateRun, UpdateStatus } from '../lib/types';

const PER_PAGE = 25;
const STATUS_FILTERS: { value: UpdateStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'succeeded', label: 'Complete' },
  { value: 'partially_failed', label: 'Incomplete' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Updating' },
  { value: 'queued', label: 'Queued' },
];

/** Sync history: every synchronization with its commit, theme, files, timings and errors. */
export default function History() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [themeId, setThemeId] = useState('');
  const [status, setStatus] = useState<UpdateStatus | ''>('');
  const [retrying, setRetrying] = useState<UpdateRun | null>(null);
  const history = useApiQuery(
    () => api.history({ page, perPage: PER_PAGE, themeId: themeId || undefined, status: status || undefined }),
    [page, themeId, status],
  );
  const themes = useApiQuery(() => api.themes.list(), []);
  const retry = useMutation(api.updates.retry);
  const published = new Set((themes.data ?? []).filter((t) => t.isLive).map((t) => t.id));

  if (history.loading && !history.data) return <LoadingState title="Sync history" />;
  const items = history.data?.items ?? [];

  const doRetry = async () => {
    if (!retrying) return;
    const result = await retry.run(retrying.id);
    if (result) {
      showToast(`Retrying ${retrying.progress.failed} failed file(s) on ${retrying.theme.name}`);
      setRetrying(null);
      history.reload();
    }
  };

  return (
    <AppLayout
      title="Sync history"
      subtitle="Every synchronization: commit, repository, theme, files, timings and errors"
      secondaryActions={[{ content: 'Refresh', onAction: history.reload, loading: history.loading }]}
      banners={
        <>
          <ErrorBanner error={history.error} onRetry={history.reload} heading="The sync history could not be loaded" />
          <ErrorBanner error={retry.error} heading="The retry did not start" onDismiss={retry.clearError} />
        </>
      }
    >
      <s-section>
        <s-stack gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            <s-select
              label="Theme"
              value={themeId || 'all'}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setThemeId(value === 'all' ? '' : value);
                setPage(1);
              }}
            >
              <s-option value="all">All themes</s-option>
              {(themes.data ?? []).map((t) => (
                <s-option key={t.id} value={t.id}>
                  {t.isLive ? `${t.name} (Live)` : t.name}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Status"
              value={status || 'all'}
              onChange={(event) => {
                const value = event.currentTarget.value as UpdateStatus | 'all';
                setStatus(value === 'all' ? '' : value);
                setPage(1);
              }}
            >
              {STATUS_FILTERS.map((f) => (
                <s-option key={f.value} value={f.value}>
                  {f.label}
                </s-option>
              ))}
            </s-select>
          </s-grid>

          {items.length === 0 ? (
            <s-empty-state heading="No synchronizations yet">
              <s-paragraph>Choose a commit on the Commits page and preview a sync to get started.</s-paragraph>
              <s-button slot="primary-action" variant="primary" onClick={() => navigate('/commits')}>
                Open commits
              </s-button>
            </s-empty-state>
          ) : (
            <s-table
              loading={history.loading}
              paginate
              hasPreviousPage={page > 1}
              hasNextPage={!!history.data?.hasNextPage}
              onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => p + 1)}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Commit</s-table-header>
                <s-table-header>Repository</s-table-header>
                <s-table-header>Shopify theme</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Files</s-table-header>
                <s-table-header listSlot="secondary">Started / finished</s-table-header>
                <s-table-header>Error</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {items.map((run) => {
                  const files = run.progress.total;
                  return (
                    <s-table-row key={run.id}>
                      <s-table-cell>
                        <s-stack gap="small-300">
                          <s-text type="strong">{run.target?.shortSha ?? '—'}</s-text>
                          <s-text color="subdued">{`${KIND_LABEL[run.kind]} · ${firstLine(run.target?.message)}`}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-300">
                          <s-text>{run.repository}</s-text>
                          {run.branch && <s-text color="subdued">{run.branch}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text>{run.theme.name}</s-text>
                          {published.has(run.theme.id) && <s-badge tone="success">Live</s-badge>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={STATUS_BADGE[run.status].tone}>{STATUS_BADGE[run.status].label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-300">
                          <s-text>{`${files} changed`}</s-text>
                          {(run.progress.succeeded > 0 || run.progress.failed > 0) && (
                            <s-text color="subdued">{`${run.progress.succeeded} done · ${run.progress.failed} failed`}</s-text>
                          )}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-300">
                          <s-text>{formatDate(run.startedAt ?? run.confirmedAt)}</s-text>
                          <s-text color="subdued">{run.completedAt ? `→ ${formatDate(run.completedAt)}` : 'in progress'}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {run.errorDetails ? (
                          <s-text tone="critical">{run.errorDetails.message}</s-text>
                        ) : (
                          <s-text color="subdued">—</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200">
                          <s-button variant="tertiary" onClick={() => navigate(`/updates/${run.id}`)}>
                            Open
                          </s-button>
                          {run.actions.canRetry && (
                            <s-button variant="secondary" onClick={() => setRetrying(run)}>
                              Retry
                            </s-button>
                          )}
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <ConfirmDialog
        id="retry-sync-dialog"
        open={!!retrying}
        heading="Retry failed files?"
        confirmLabel="Retry failed files"
        pending={retry.pending}
        onConfirm={doRetry}
        onClose={() => setRetrying(null)}
      >
        {retrying && (
          <>
            <s-paragraph>
              {`Only the ${retrying.progress.failed} file(s) that failed in ${retrying.target?.shortSha ?? 'this sync'} are tried again on ${retrying.theme.name}. Files that already succeeded are not written again.`}
            </s-paragraph>
            <s-paragraph color="subdued">
              Retrying is safe: each file gets exactly the content of the same commit, and a backup of the theme&apos;s
              files was saved before the sync started.
            </s-paragraph>
          </>
        )}
      </ConfirmDialog>
    </AppLayout>
  );
}
