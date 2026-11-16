import { useState } from 'react';
import { api } from '../lib/api-client';
import { firstLine, formatDate, SYNC_STATUS_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import { ErrorBanner } from './ErrorBanner';
import { Badge, Button, IndexTable, IndexTableCell, IndexTableRow, Paragraph, Stack, Text } from './ui';

/** Syncs applied to one theme from one branch, newest first (persistent, paginated). */
export function SyncRunsTable({
  themeId,
  branch,
  refreshKey = 0,
}: {
  themeId: string;
  branch: string;
  refreshKey?: number;
}) {
  const go = useNavigateHandler();
  const [page, setPage] = useState(1);
  const history = useApiQuery(
    () => api.sync.history({ themeId, branch, page, perPage: 10 }),
    [themeId, branch, page, refreshKey],
  );
  const items = history.data?.items ?? [];

  if (!history.loading && !history.error && items.length === 0 && page === 1) {
    return <Paragraph color="subdued">No syncs applied to this theme from this branch yet.</Paragraph>;
  }

  return (
    <Stack gap="base">
      <ErrorBanner error={history.error} onRetry={history.reload} heading="Sync history could not be loaded" />
      <IndexTable
        variant="auto"
        loading={history.loading}
        paginate
        hasPreviousPage={page > 1}
        hasNextPage={!!history.data?.hasNextPage}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        columns={[
          { title: 'Date', listSlot: 'labeled' },
          { title: 'Updated to', listSlot: 'primary' },
          { title: 'Type', listSlot: 'labeled' },
          { title: 'Status', listSlot: 'inline' },
          { title: 'Files' },
          { title: 'Details' },
        ]}
        rows={items.map((run) => {
          const badge = SYNC_STATUS_BADGE[run.status];
          const commits = run.commitsIncluded.length;
          return (
            <IndexTableRow key={run.id}>
              <IndexTableCell>{formatDate(run.completedAt ?? run.startedAt ?? run.initiatedAt)}</IndexTableCell>
              <IndexTableCell>
                <Stack gap="none">
                  <Text>
                    <Text type="strong">{run.commitSha.slice(0, 7)}</Text> {firstLine(run.commitMessage)}
                  </Text>
                  {commits > 1 && <Text color="subdued">{`${commits} commits included`}</Text>}
                </Stack>
              </IndexTableCell>
              <IndexTableCell>{syncTypeLabel(run.strategy)}</IndexTableCell>
              <IndexTableCell>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </IndexTableCell>
              <IndexTableCell>
                {`${run.filesSucceeded} ok${run.filesFailed ? ` · ${run.filesFailed} failed` : ''}${run.filesIgnored ? ` · ${run.filesIgnored} ignored` : ''}`}
              </IndexTableCell>
              <IndexTableCell>
                <Button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
                  {run.canRetry ? 'Open / retry' : 'Open'}
                </Button>
              </IndexTableCell>
            </IndexTableRow>
          );
        })}
      />
    </Stack>
  );
}
