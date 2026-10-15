import { useState } from 'react';
import { api } from '../lib/api-client';
import { firstLine, formatDate, SYNC_STATUS_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import { ErrorBanner } from './ErrorBanner';

/** Syncs applied to one theme from one branch, newest first (persistent, paginated). */
export function SyncRunsTable({ themeId, branch, refreshKey = 0 }: { themeId: string; branch: string; refreshKey?: number }) {
  const go = useNavigateHandler();
  const [page, setPage] = useState(1);
  const history = useApiQuery(
    () => api.sync.history({ themeId, branch, page, perPage: 10 }),
    [themeId, branch, page, refreshKey],
  );
  const items = history.data?.items ?? [];

  if (!history.loading && !history.error && items.length === 0 && page === 1) {
    return <s-paragraph color="subdued">No syncs applied to this theme from this branch yet.</s-paragraph>;
  }

  return (
    <s-stack gap="base">
      <ErrorBanner error={history.error} onRetry={history.reload} heading="Sync history could not be loaded" />
      <s-table
        variant="auto"
        loading={history.loading}
        paginate
        hasPreviousPage={page > 1}
        hasNextPage={!!history.data?.hasNextPage}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
      >
        <s-table-header-row>
          <s-table-header listSlot="labeled">Date</s-table-header>
          <s-table-header listSlot="primary">Updated to</s-table-header>
          <s-table-header listSlot="labeled">Type</s-table-header>
          <s-table-header listSlot="inline">Status</s-table-header>
          <s-table-header>Files</s-table-header>
          <s-table-header>Details</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {items.map((run) => {
            const badge = SYNC_STATUS_BADGE[run.status];
            const commits = run.commitsIncluded.length;
            return (
              <s-table-row key={run.id}>
                <s-table-cell>{formatDate(run.completedAt ?? run.startedAt ?? run.initiatedAt)}</s-table-cell>
                <s-table-cell>
                  <s-stack gap="none">
                    <s-text>
                      <s-text type="strong">{run.commitSha.slice(0, 7)}</s-text> {firstLine(run.commitMessage)}
                    </s-text>
                    {commits > 1 && <s-text color="subdued">{`${commits} commits included`}</s-text>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{syncTypeLabel(run.strategy)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={badge.tone}>{badge.label}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  {`${run.filesSucceeded} ok${run.filesFailed ? ` · ${run.filesFailed} failed` : ''}${run.filesIgnored ? ` · ${run.filesIgnored} ignored` : ''}`}
                </s-table-cell>
                <s-table-cell>
                  <s-button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
                    {run.canRetry ? 'Open / retry' : 'Open'}
                  </s-button>
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}
