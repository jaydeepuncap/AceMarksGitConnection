import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, SYNC_STATUS_BADGE } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncOperation, SyncStatus } from '../lib/types';
import type { Tone } from '../lib/format';

const PER_PAGE = 20;
const POLL_MS = 3000;
const ACTIVE: SyncStatus[] = ['queued', 'running'];

const OP_BADGE: Record<SyncOperation['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'info' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

function RetryLiveModal({
  open,
  themeName,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  themeName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) ref.current?.showOverlay();
    else {
      ref.current?.hideOverlay();
      setName('');
    }
  }, [open]);
  return (
    <s-modal ref={ref} id="retry-live-modal" heading="Retry on the live theme" onHide={onClose}>
      <s-stack gap="base">
        <s-paragraph>
          This sync targets your live theme <s-text type="strong">{themeName}</s-text>. Type its name to retry the failed
          files.
        </s-paragraph>
        <s-text-field
          label="Theme name"
          value={name}
          autocomplete="off"
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        disabled={name !== themeName}
        loading={pending}
        onClick={() => onConfirm(name)}
      >
        Retry on live theme
      </s-button>
      <s-button slot="secondary-actions" onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}

function SyncDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const run = useApiQuery(() => api.sync.get(id), [id]);
  const retry = useMutation(api.sync.retry);
  const [liveModal, setLiveModal] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  // Poll while the background job is active; the Worker also resumes stalled
  // runs on these reads when no queue is configured.
  const active = run.data ? ACTIVE.includes(run.data.status) : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      api.sync.get(id).then(run.setData).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, id, run.setData]);

  if (run.loading && !run.data) return <LoadingState title="Sync details" />;
  const data = run.data;

  const doRetry = async (confirmThemeName?: string) => {
    const result = await retry.run(
      id,
      confirmThemeName ? { confirmLiveTheme: true, confirmThemeName } : {},
    );
    if (result) {
      setLiveModal(false);
      showToast('Retry started');
      run.reload();
    }
  };

  const operations = (data?.operations ?? []).filter((op) => showSkipped || op.status !== 'skipped');
  const done = data ? data.filesSucceeded + data.filesFailed : 0;

  return (
    <AppLayout
      title={data ? `Sync ${data.commitSha.slice(0, 7)} → ${data.themeName}` : 'Sync details'}
      backAction={{ content: 'Sync history', onAction: onBack }}
      primaryAction={
        data?.canRetry
          ? {
              content: 'Retry failed files',
              loading: retry.pending,
              onAction: () => (data.themeRole === 'MAIN' ? setLiveModal(true) : doRetry()),
            }
          : undefined
      }
      secondaryActions={[{ content: 'Refresh', onAction: run.reload }]}
      banners={
        <>
          <ErrorBanner error={run.error} onRetry={run.reload} />
          <ErrorBanner error={retry.error} heading="Retry failed" onDismiss={retry.clearError} />
          {data?.errorDetails && (
            <s-banner tone="critical" heading={data.errorDetails.code}>
              <s-paragraph>{data.errorDetails.message}</s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      {data && (
        <s-section heading="Summary">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={SYNC_STATUS_BADGE[data.status].tone}>{SYNC_STATUS_BADGE[data.status].label}</s-badge>
              {data.themeRole === 'MAIN' && <s-badge tone="warning">Live theme</s-badge>}
              <s-text color="subdued">Attempt {data.attempt}</s-text>
            </s-stack>
            {active && (
              <s-progress
                accessibilityLabel="Sync progress"
                max={Math.max(1, data.filesChanged)}
                value={done}
              />
            )}
            <s-paragraph>
              <s-text type="strong">{data.repository}</s-text> @ {data.commitSha}
              {data.branch ? ` (${data.branch})` : ''}
            </s-paragraph>
            <s-text color="subdued">{firstLine(data.commitMessage)}</s-text>
            <s-text>
              {data.filesSucceeded} succeeded · {data.filesFailed} failed · {data.filesSkipped} skipped ·{' '}
              {data.filesChanged} planned
            </s-text>
            <s-text color="subdued">
              Started {formatDate(data.startedAt ?? data.initiatedAt)} · Completed {formatDate(data.completedAt)}
            </s-text>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Files">
        <s-checkbox
          slot="secondary-actions"
          label="Show skipped"
          checked={showSkipped}
          onChange={(event) => setShowSkipped(event.currentTarget.checked)}
        />
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="primary">Theme file</s-table-header>
            <s-table-header listSlot="kicker">Action</s-table-header>
            <s-table-header listSlot="secondary">Details</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {operations.map((op) => (
              <s-table-row key={op.id}>
                <s-table-cell>
                  <s-badge tone={OP_BADGE[op.status].tone}>{OP_BADGE[op.status].label}</s-badge>
                </s-table-cell>
                <s-table-cell>{op.path}</s-table-cell>
                <s-table-cell>{op.action === 'delete' ? 'Delete' : 'Write'}</s-table-cell>
                <s-table-cell>
                  <s-text color="subdued">
                    {op.error ?? op.skipReason ?? (op.previousPath ? `renamed from ${op.previousPath}` : op.changeType)}
                    {op.attempts > 1 ? ` · ${op.attempts} attempts` : ''}
                  </s-text>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {data && (
        <RetryLiveModal
          open={liveModal}
          themeName={data.themeName}
          pending={retry.pending}
          onClose={() => setLiveModal(false)}
          onConfirm={(name) => doRetry(name)}
        />
      )}
    </AppLayout>
  );
}

function SyncList({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SyncStatus | ''>('');
  const history = useApiQuery(
    () => api.sync.history({ page, perPage: PER_PAGE, status: status || undefined }),
    [page, status],
  );

  return (
    <AppLayout
      title="Sync history"
      secondaryActions={[{ content: 'Refresh', onAction: history.reload }]}
      banners={<ErrorBanner error={history.error} onRetry={history.reload} />}
    >
      <s-section padding="none" accessibilityLabel="Sync history">
        <s-table
          variant="auto"
          loading={history.loading}
          paginate
          hasPreviousPage={page > 1}
          hasNextPage={!!history.data?.hasNextPage}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
        >
          <s-select
            slot="filters"
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value as SyncStatus | '');
              setPage(1);
            }}
          >
            <s-option value="">All statuses</s-option>
            {(Object.keys(SYNC_STATUS_BADGE) as SyncStatus[]).map((s) => (
              <s-option key={s} value={s}>
                {SYNC_STATUS_BADGE[s].label}
              </s-option>
            ))}
          </s-select>
          <s-table-header-row>
            <s-table-header listSlot="primary">Commit</s-table-header>
            <s-table-header listSlot="secondary">Repository → theme</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header format="numeric">Files</s-table-header>
            <s-table-header listSlot="labeled">Started</s-table-header>
            <s-table-header listSlot="labeled">Completed</s-table-header>
            <s-table-header>Details</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(history.data?.items ?? []).map((run) => (
              <s-table-row key={run.id}>
                <s-table-cell>
                  <s-stack gap="none">
                    <s-text type="strong">{run.commitSha.slice(0, 7)}</s-text>
                    <s-text color="subdued">{firstLine(run.commitMessage)}</s-text>
                    {run.errorDetails && <s-text tone="critical">{run.errorDetails.message}</s-text>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  {run.repository} → {run.themeName}
                  {run.themeRole === 'MAIN' ? ' (live)' : ''}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  {run.filesSucceeded}/{run.filesChanged}
                  {run.filesFailed > 0 ? ` (${run.filesFailed} failed)` : ''}
                </s-table-cell>
                <s-table-cell>{formatDate(run.startedAt ?? run.initiatedAt)}</s-table-cell>
                <s-table-cell>{formatDate(run.completedAt)}</s-table-cell>
                <s-table-cell>
                  <s-button variant="tertiary" accessibilityLabel={`Open sync ${run.id}`} onClick={() => onOpen(run.id)}>
                    {run.canRetry ? 'View / retry' : 'View'}
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {!history.loading && history.data?.items.length === 0 && (
          <s-box padding="base">
            <s-paragraph color="subdued">No synchronizations yet. Preview a commit from the Commits page.</s-paragraph>
          </s-box>
        )}
      </s-section>
    </AppLayout>
  );
}

export default function SyncHistory() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  return id ? (
    <SyncDetail
      id={id}
      onBack={() =>
        setParams((prev) => {
          prev.delete('id');
          return prev;
        })
      }
    />
  ) : (
    <SyncList
      onOpen={(syncId) =>
        setParams((prev) => {
          prev.set('id', syncId);
          return prev;
        })
      }
    />
  );
}
