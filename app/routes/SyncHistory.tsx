import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, SYNC_STATUS_BADGE, syncTypeLabel, themeFileLabel } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncOperation, SyncPreview, SyncStatus, SyncStrategy } from '../lib/types';
import type { Tone } from '../lib/format';

const PER_PAGE = 20;
const POLL_MS = 2000;
const ACTIVE: SyncStatus[] = ['queued', 'running'];

const OP_BADGE: Record<SyncOperation['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'info' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

/**
 * Confirmation for retry / restore. On the live theme the user must type the
 * theme's exact name (the server enforces the same rule).
 */
function ConfirmActionModal({
  open,
  heading,
  message,
  actionLabel,
  themeName,
  requireName,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  heading: string;
  message: string;
  actionLabel: string;
  themeName: string;
  requireName: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (name?: string) => void;
}) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) ref.current?.showOverlay?.();
    else {
      ref.current?.hideOverlay?.();
      setName('');
    }
  }, [open]);
  return (
    <s-modal ref={ref} id="confirm-action-modal" heading={heading} onHide={onClose}>
      <s-stack gap="base">
        <s-paragraph>{message}</s-paragraph>
        {requireName && (
          <s-text-field
            label={`This is your live theme. Type "${themeName}" to confirm`}
            value={name}
            autocomplete="off"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        )}
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        disabled={requireName && name !== themeName}
        loading={pending}
        onClick={() => onConfirm(requireName ? name : undefined)}
      >
        {actionLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}

/** Client guide, section 7: what each option on an incomplete update is for. */
const INCOMPLETE_OPTIONS: { option: string; when: string }[] = [
  {
    option: 'Retry Failed Files',
    when: 'A temporary issue, such as Shopify being busy. Only the failed files are tried again.',
  },
  {
    option: 'Run Full Update Again',
    when: 'The theme was changed in the meantime, or you want a complete fresh check.',
  },
  { option: 'Restore Backup', when: 'You want the theme back exactly as it was before this update.' },
  { option: 'Ask your developer', when: 'The file has a code error. Once it is fixed, you apply the new update.' },
];

function SyncDetail({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const run = useApiQuery(() => api.sync.get(id), [id]);
  const retry = useMutation(api.sync.retry);
  const restore = useMutation(api.sync.restore);
  const rerunPreview = useMutation(api.sync.preview);
  const rerunConfirm = useMutation(api.sync.confirm);
  const [confirmAction, setConfirmAction] = useState<'retry' | 'restore' | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // Poll while the background job is active; the Worker also resumes stalled
  // runs on these reads when no queue is configured.
  const active = run.data ? ACTIVE.includes(run.data.status) : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      api.sync
        .get(id)
        .then(run.setData)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, id, run.setData]);

  if (run.loading && !run.data) return <LoadingState title="Sync details" />;
  const data = run.data;

  const live = data?.themeRole === 'MAIN';
  const liveBody = (confirmThemeName?: string) =>
    confirmThemeName ? { confirmLiveTheme: true, confirmThemeName } : {};

  const doRetry = async (confirmThemeName?: string) => {
    const result = await retry.run(id, liveBody(confirmThemeName));
    if (result) {
      setConfirmAction(null);
      showToast('Retry started');
      run.reload();
    }
  };

  const doRestore = async (confirmThemeName?: string) => {
    const result = await restore.run(id, liveBody(confirmThemeName));
    if (result) {
      setConfirmAction(null);
      showToast('Backup restored');
      run.reload();
    }
  };

  /** A fresh preview of the same update: new checks against the theme as it is now. */
  const doRerun = async () => {
    if (!data) return;
    rerunConfirm.clearError();
    const result = await rerunPreview.run({
      repository: data.repository,
      branch: data.branch ?? undefined,
      commitSha: data.commitSha,
      themeId: data.themeId,
      strategy: data.strategy,
      allowDeletes: data.allowDeletes,
    });
    if (result) setPreview(result);
  };

  const confirmRerun = async (confirmation: {
    confirmLiveTheme?: boolean;
    confirmThemeName?: string;
    acceptDirectEdits?: boolean;
  }) => {
    if (!preview) return;
    const started = await rerunConfirm.run({ syncId: preview.syncId, confirm: true, ...confirmation });
    if (started) {
      setPreview(null);
      showToast('Full update started');
      onOpen(started.id);
    }
  };

  const failed = (data?.operations ?? []).filter((op) => op.status === 'failed');
  const incomplete = data?.status === 'partially_failed' || data?.status === 'failed';
  // Retrying cannot fix a code error; the developer has to.
  const retryHelps = failed.length === 0 || failed.some((op) => op.failure?.kind !== 'code');

  const operations = (data?.operations ?? []).filter((op) => showSkipped || op.status !== 'skipped');
  // Files written or failed so far (live while the update runs).
  const done = data ? Math.min(data.filesChanged, data.filesSucceeded + data.filesFailed) : 0;

  return (
    <AppLayout
      title={data ? `Sync ${data.commitSha.slice(0, 7)} → ${data.themeName}` : 'Sync details'}
      backAction={{ content: 'Sync history', onAction: onBack }}
      secondaryActions={[{ content: 'Refresh', onAction: run.reload }]}
      banners={
        <>
          <ErrorBanner error={run.error} onRetry={run.reload} />
          <ErrorBanner error={retry.error} heading="Retry failed" onDismiss={retry.clearError} />
          <ErrorBanner
            error={restore.error}
            heading="Backup could not be fully restored"
            onDismiss={restore.clearError}
          />
          <ErrorBanner
            error={rerunPreview.error}
            heading="The full update could not be prepared"
            onDismiss={rerunPreview.clearError}
          />
          {data?.errorDetails && !incomplete && (
            <s-banner tone="critical" heading={data.errorDetails.code}>
              <s-paragraph>{data.errorDetails.message}</s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      {data && active && (
        <s-banner
          tone="info"
          heading={
            data.status === 'queued'
              ? `Starting the update of ${data.themeName}…`
              : `Updating ${data.themeName} · ${done} of ${data.filesChanged} files`
          }
        >
          <s-stack gap="small-200">
            <s-progress accessibilityLabel="Update progress" max={Math.max(1, data.filesChanged)} value={done} />
            <s-paragraph>
              {`${Math.round((done / Math.max(1, data.filesChanged)) * 100)}% · ${data.filesSucceeded} updated${data.filesFailed ? ` · ${data.filesFailed} failed` : ''}${data.backedUp ? ` · ${data.backedUp} backed up first` : ''}`}
            </s-paragraph>
            <s-text color="subdued">
              Each file is backed up right before it changes. You can leave this page; the update continues in the
              background.
            </s-text>
          </s-stack>
        </s-banner>
      )}
      {data?.status === 'succeeded' && (
        <s-banner tone="success" heading="Update complete">
          <s-paragraph>{`Files: ${data.filesSucceeded} of ${data.filesChanged} updated${data.backedUp ? ` · backup of ${data.backedUp} file(s) saved first` : ''}`}</s-paragraph>
          <s-paragraph>{`${data.themeName} is now on ${data.commitSha.slice(0, 7)} ${firstLine(data.commitMessage)}`}</s-paragraph>
          <s-paragraph color="subdued">
            {data.themeRole === 'MAIN'
              ? 'Customers see the update now.'
              : 'Preview the theme in Shopify. When you are happy with it, publish it in Shopify as usual — Theme Sync never publishes a theme on its own.'}
          </s-paragraph>
        </s-banner>
      )}
      {data && incomplete && (
        <s-section accessibilityLabel="Update result">
          <s-stack gap="base">
            {data.restoredAt ? (
              <s-banner tone="info" heading="Backup restored">
                <s-paragraph>
                  {`${data.themeName} is back exactly as it was before this update (${data.restoredFiles} file(s), ${formatDate(data.restoredAt)}). Run the full update again when you are ready.`}
                </s-paragraph>
              </s-banner>
            ) : (
              <s-banner
                tone="critical"
                heading={`Update incomplete · ${data.filesSucceeded} of ${data.filesChanged} files updated`}
              >
                <s-paragraph>
                  The theme is not marked as updated until every file succeeds.
                  {data.errorDetails && data.errorDetails.code !== 'FILES_FAILED'
                    ? ` ${data.errorDetails.message}`
                    : ''}
                </s-paragraph>
              </s-banner>
            )}

            {failed.length > 0 && (
              <s-stack gap="small-200">
                {failed.map((op) => (
                  <s-grid
                    key={op.id}
                    gridTemplateColumns="minmax(0, 1fr) minmax(0, 1.4fr)"
                    gap="small-200"
                    alignItems="start"
                  >
                    <s-stack gap="none">
                      <s-text type="strong">
                        <s-text tone="critical">×</s-text> {themeFileLabel(op.path)}
                      </s-text>
                      <s-text color="subdued">{op.path}</s-text>
                    </s-stack>
                    <s-stack gap="none">
                      <s-text>{op.failure?.reason ?? 'Could not be updated'}</s-text>
                      {op.failure?.detail && <s-text color="subdued">{op.failure.detail}</s-text>}
                    </s-stack>
                  </s-grid>
                ))}
              </s-stack>
            )}

            <s-text>
              {`${data.themeName} remains on `}
              <s-text type="strong">{data.baseSha ? data.baseSha.slice(0, 7) : 'its previous version'}</s-text>
              <s-text color="subdued">{data.baseSha ? ' (its last synced commit)' : ''}</s-text>
            </s-text>

            <s-stack direction="inline" gap="small-200" justifyContent="end">
              {!data.restoredAt && (
                <s-button
                  disabled={!data.canRestore}
                  loading={restore.pending}
                  onClick={() => setConfirmAction('restore')}
                >
                  Restore Backup
                </s-button>
              )}
              <s-button loading={rerunPreview.pending} onClick={doRerun}>
                Run Full Update Again
              </s-button>
              {!data.restoredAt && (
                <s-button
                  variant="primary"
                  disabled={!data.canRetry || !retryHelps}
                  loading={retry.pending}
                  onClick={() => (live ? setConfirmAction('retry') : doRetry())}
                >
                  Retry Failed Files
                </s-button>
              )}
            </s-stack>
            {!retryHelps && !data.restoredAt && (
              <s-text color="subdued">
                Every failed file has a code error: ask your developer to fix it, then apply the new update.
              </s-text>
            )}

            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Option</s-table-header>
                <s-table-header listSlot="secondary">When to use it</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {INCOMPLETE_OPTIONS.map((o) => (
                  <s-table-row key={o.option}>
                    <s-table-cell>
                      <s-text type="strong">{o.option}</s-text>
                    </s-table-cell>
                    <s-table-cell>{o.when}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-banner tone="info">
              <s-paragraph>Temporary issues are usually retried automatically before you see any message.</s-paragraph>
            </s-banner>
          </s-stack>
        </s-section>
      )}
      {data && data.commitsIncluded.length > 0 && (
        <s-section heading={`Updates included (${data.commitsIncluded.length})`}>
          <s-stack gap="small-300">
            {data.baseSha && (
              <s-text color="subdued">{`From ${data.baseSha.slice(0, 7)} (last synced before this update)`}</s-text>
            )}
            {data.commitsIncluded.map((c) => (
              <s-text key={c.sha}>
                <s-text type="strong">{c.shortSha}</s-text> {firstLine(c.message)}
              </s-text>
            ))}
          </s-stack>
        </s-section>
      )}
      {data && (
        <s-section heading="Summary">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={SYNC_STATUS_BADGE[data.status].tone}>{SYNC_STATUS_BADGE[data.status].label}</s-badge>
              {data.themeRole === 'MAIN' && <s-badge tone="warning">Live theme</s-badge>}
              <s-text color="subdued">Attempt {data.attempt}</s-text>
            </s-stack>
            <s-paragraph>
              <s-text type="strong">{data.repository}</s-text> @ {data.commitSha}
              {data.branch ? ` (${data.branch})` : ''}
            </s-paragraph>
            <s-text color="subdued">{firstLine(data.commitMessage)}</s-text>
            <s-text>
              {`${syncTypeLabel(data.strategy)} · ${data.filesSucceeded} succeeded · ${data.filesFailed} failed · ${data.filesSkipped - data.filesIgnored} skipped · ${data.filesIgnored} ignored · ${data.filesChanged} planned`}
            </s-text>
            <s-text color="subdued">{`Job ID ${data.id}`}</s-text>
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
                    {(op.failure ? `${op.failure.reason} · ${op.failure.detail}` : null) ??
                      op.skipReason ??
                      (op.previousPath ? `renamed from ${op.previousPath}` : op.changeType)}
                    {op.sourceCommitSha ? ` · from ${op.sourceCommitSha.slice(0, 7)}` : ''}
                    {op.attempts > 0 ? ` · ${op.attempts} attempt${op.attempts === 1 ? '' : 's'}` : ''}
                    {op.status === 'failed' && op.lastAttemptAt ? ` · failed ${formatDate(op.lastAttemptAt)}` : ''}
                  </s-text>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {data && (
        <ConfirmActionModal
          open={confirmAction !== null}
          heading={confirmAction === 'restore' ? 'Restore backup?' : 'Retry on the live theme'}
          message={
            confirmAction === 'restore'
              ? `Every file this update changed in ${data.themeName} is put back to the version saved right before the update, and files it added are removed. The theme stays on ${data.baseSha ? data.baseSha.slice(0, 7) : 'its previous version'}.`
              : `This sync targets your live theme ${data.themeName}. Only the failed files are tried again.`
          }
          actionLabel={confirmAction === 'restore' ? 'Restore Backup' : 'Retry on live theme'}
          themeName={data.themeName}
          requireName={live}
          pending={confirmAction === 'restore' ? restore.pending : retry.pending}
          onClose={() => setConfirmAction(null)}
          onConfirm={(name) => (confirmAction === 'restore' ? doRestore(name) : doRetry(name))}
        />
      )}
      <ConfirmSyncModal
        open={preview !== null}
        preview={preview}
        submitting={rerunConfirm.pending}
        error={rerunConfirm.error?.message ?? null}
        onClose={() => setPreview(null)}
        onConfirm={confirmRerun}
      />
    </AppLayout>
  );
}

const ALL = 'all';
const SYNC_TYPES: SyncStrategy[] = ['full_snapshot', 'commit_changes', 'selected_commits', 'since_last_sync'];

function SyncList({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SyncStatus | ''>('');
  const [themeId, setThemeId] = useState('');
  const [branch, setBranch] = useState('');
  const [strategy, setStrategy] = useState<SyncStrategy | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const settings = useApiQuery(() => api.settings.get(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const repository = settings.data?.settings.defaultRepository ?? '';
  const branches = useApiQuery(() => api.github.branches({ repository, perPage: 100 }), [repository], !!repository);
  const history = useApiQuery(
    () =>
      api.sync.history({
        page,
        perPage: PER_PAGE,
        status: status || undefined,
        themeId: themeId || undefined,
        branch: branch || undefined,
        strategy: strategy || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    [page, status, themeId, branch, strategy, from, to],
  );
  const filter =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const filtered = !!(status || themeId || branch || strategy || from || to);

  return (
    <AppLayout
      title="Sync history"
      secondaryActions={[{ content: 'Refresh', onAction: history.reload }]}
      banners={<ErrorBanner error={history.error} onRetry={history.reload} />}
    >
      <s-section heading="Filters">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
          <s-select
            label="Theme"
            value={themeId || ALL}
            onChange={(event) => filter(setThemeId)(event.currentTarget.value === ALL ? '' : event.currentTarget.value)}
          >
            <s-option value={ALL}>All themes</s-option>
            {(themes.data ?? []).map((t) => (
              <s-option key={t.id} value={t.id}>
                {t.name}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Branch"
            value={branch || ALL}
            onChange={(event) => filter(setBranch)(event.currentTarget.value === ALL ? '' : event.currentTarget.value)}
          >
            <s-option value={ALL}>All branches</s-option>
            {(branches.data?.items ?? []).map((b) => (
              <s-option key={b.name} value={b.name}>
                {b.name}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Sync type"
            value={strategy || ALL}
            onChange={(event) =>
              filter(setStrategy)(event.currentTarget.value === ALL ? '' : (event.currentTarget.value as SyncStrategy))
            }
          >
            <s-option value={ALL}>All types</s-option>
            {SYNC_TYPES.map((t) => (
              <s-option key={t} value={t}>
                {syncTypeLabel(t)}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Status"
            value={status || ALL}
            onChange={(event) =>
              filter(setStatus)(event.currentTarget.value === ALL ? '' : (event.currentTarget.value as SyncStatus))
            }
          >
            <s-option value={ALL}>All statuses</s-option>
            {(Object.keys(SYNC_STATUS_BADGE) as SyncStatus[]).map((st) => (
              <s-option key={st} value={st}>
                {SYNC_STATUS_BADGE[st].label}
              </s-option>
            ))}
          </s-select>
          <s-date-field label="From" value={from} onChange={(event) => filter(setFrom)(event.currentTarget.value)} />
          <s-date-field label="To" value={to} onChange={(event) => filter(setTo)(event.currentTarget.value)} />
        </s-grid>
        {filtered && (
          <s-button
            slot="secondary-actions"
            variant="tertiary"
            onClick={() => {
              setStatus('');
              setThemeId('');
              setBranch('');
              setStrategy('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            Clear filters
          </s-button>
        )}
      </s-section>

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
          <s-table-header-row>
            <s-table-header listSlot="primary">Commits</s-table-header>
            <s-table-header listSlot="secondary">Repository · branch → theme</s-table-header>
            <s-table-header listSlot="labeled">Type</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header>Files</s-table-header>
            <s-table-header listSlot="labeled">Started</s-table-header>
            <s-table-header listSlot="labeled">Completed</s-table-header>
            <s-table-header>Details</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(history.data?.items ?? []).map((run) => {
              const shas =
                run.commitsIncluded.length > 1
                  ? run.commitsIncluded.map((c) => c.shortSha)
                  : [run.commitSha.slice(0, 7)];
              return (
                <s-table-row key={run.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">
                        {shas.length > 3 ? `${shas[0]} … ${shas[shas.length - 1]} (${shas.length})` : shas.join(', ')}
                      </s-text>
                      <s-text color="subdued">{firstLine(run.commitMessage)}</s-text>
                      {run.errorDetails && <s-text tone="critical">{run.errorDetails.message}</s-text>}
                      <s-text color="subdued">{`Job ${run.id.slice(0, 8)}`}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {`${run.repository} · ${run.branch ?? '—'} → ${run.themeName}${run.themeRole === 'MAIN' ? ' (live)' : ''}`}
                  </s-table-cell>
                  <s-table-cell>{syncTypeLabel(run.strategy)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {`${run.filesSucceeded} ok · ${run.filesFailed} failed · ${run.filesSkipped - run.filesIgnored} skipped · ${run.filesIgnored} ignored`}
                  </s-table-cell>
                  <s-table-cell>{formatDate(run.startedAt ?? run.initiatedAt)}</s-table-cell>
                  <s-table-cell>{formatDate(run.completedAt)}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      accessibilityLabel={`Open sync ${run.id}`}
                      onClick={() => onOpen(run.id)}
                    >
                      {run.canRetry ? 'View / retry' : 'View'}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
        {!history.loading && history.data?.items.length === 0 && (
          <s-box padding="base">
            <s-paragraph color="subdued">
              {filtered
                ? 'No synchronizations match these filters.'
                : 'No synchronizations yet. Start one from Theme mapping or Commit sync.'}
            </s-paragraph>
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
      onOpen={(syncId) =>
        setParams((prev) => {
          prev.set('id', syncId);
          return prev;
        })
      }
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
