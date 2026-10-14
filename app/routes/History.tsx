import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { formatDate, KIND_LABEL, LINE_LABEL, STATUS_BADGE } from '../lib/format';
import { useApiQuery } from '../lib/hooks';
import type { ThemeLine } from '../lib/types';

const PER_PAGE = 25;

/** Update history: every run per store and theme, newest first. */
export default function History() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [line, setLine] = useState<ThemeLine | ''>('');
  const history = useApiQuery(() => api.history({ page, perPage: PER_PAGE, line: line || undefined }), [page, line]);
  const stores = useApiQuery(() => api.overview(), []);

  if (history.loading && !history.data) return <LoadingState title="Update history" />;
  const storeName = stores.data?.store.name ?? '';

  return (
    <AppLayout
      title="Update history"
      subtitle="What changed, when, and on which theme"
      secondaryActions={[{ content: 'Refresh', onAction: history.reload, loading: history.loading }]}
      banners={<ErrorBanner error={history.error} onRetry={history.reload} />}
    >
      <s-section>
        <s-stack gap="base">
          <s-box inlineSize="220px">
            <s-select
              label="Theme"
              value={line}
              onChange={(event) => {
                setLine(event.currentTarget.value as ThemeLine | '');
                setPage(1);
              }}
            >
              <s-option value="">Staging and Live</s-option>
              <s-option value="staging">Staging</s-option>
              <s-option value="live">Live</s-option>
            </s-select>
          </s-box>
          {history.data && history.data.items.length === 0 ? (
            <s-text color="subdued">No updates yet.</s-text>
          ) : (
            <s-table
              paginate
              hasPreviousPage={page > 1}
              hasNextPage={!!history.data?.hasNextPage}
              onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setPage((p) => p + 1)}
            >
              <s-table-header-row>
                <s-table-header listSlot="secondary">Date</s-table-header>
                <s-table-header>Store</s-table-header>
                <s-table-header listSlot="primary">Theme</s-table-header>
                <s-table-header>What</s-table-header>
                <s-table-header>Updated to</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {(history.data?.items ?? []).map((run) => (
                  <s-table-row key={run.id}>
                    <s-table-cell>{formatDate(run.confirmedAt)}</s-table-cell>
                    <s-table-cell>{storeName}</s-table-cell>
                    <s-table-cell>
                      <s-text type={run.line === 'live' ? 'strong' : 'generic'}>{`${LINE_LABEL[run.line]} · ${run.theme.name}`}</s-text>
                    </s-table-cell>
                    <s-table-cell>{KIND_LABEL[run.kind]}</s-table-cell>
                    <s-table-cell>{run.target?.shortSha ?? '—'}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={STATUS_BADGE[run.status].tone}>{STATUS_BADGE[run.status].label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-button variant="tertiary" onClick={() => navigate(`/updates/${run.id}`)}>
                        Open
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
