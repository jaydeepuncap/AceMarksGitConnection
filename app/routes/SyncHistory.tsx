import { useEffect, useState } from 'react';
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
import {
  Badge,
  Banner,
  Box,
  Button,
  Checkbox,
  Grid,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Modal,
  Option,
  Paragraph,
  ProgressBar,
  Section,
  Select,
  Stack,
  Text,
  TextField,
} from '../components/ui';

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
  const [name, setName] = useState('');
  useEffect(() => {
    if (!open) setName('');
  }, [open]);
  return (
    <Modal id="confirm-action-modal" open={open} heading={heading} onHide={onClose}>
      <Stack gap="base">
        <Paragraph>{message}</Paragraph>
        {requireName && (
          <TextField
            label={`This is your live theme. Type "${themeName}" to confirm`}
            value={name}
            autocomplete="off"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        )}
      </Stack>
      <Button
        slot="primary-action"
        variant="primary"
        tone="critical"
        disabled={requireName && name !== themeName}
        loading={pending}
        onClick={() => onConfirm(requireName ? name : undefined)}
      >
        {actionLabel}
      </Button>
      <Button slot="secondary-actions" onClick={onClose}>
        Cancel
      </Button>
    </Modal>
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
            <Banner tone="critical" heading={data.errorDetails.code}>
              <Paragraph>{data.errorDetails.message}</Paragraph>
            </Banner>
          )}
        </>
      }
    >
      {data && active && (
        <Banner
          tone="info"
          heading={
            data.status === 'queued'
              ? `Starting the update of ${data.themeName}…`
              : `Updating ${data.themeName} · ${done} of ${data.filesChanged} files`
          }
        >
          <Stack gap="small-200">
            <ProgressBar progress={(done / Math.max(1, data.filesChanged)) * 100} tone="info" />
            <Paragraph>
              {`${Math.round((done / Math.max(1, data.filesChanged)) * 100)}% · ${data.filesSucceeded} updated${data.filesFailed ? ` · ${data.filesFailed} failed` : ''}${data.backedUp ? ` · ${data.backedUp} backed up first` : ''}`}
            </Paragraph>
            <Text color="subdued">
              Each file is backed up right before it changes. You can leave this page; the update continues in the
              background.
            </Text>
          </Stack>
        </Banner>
      )}
      {data?.status === 'succeeded' && (
        <Banner tone="success" heading="Update complete">
          <Paragraph>{`Files: ${data.filesSucceeded} of ${data.filesChanged} updated${data.backedUp ? ` · backup of ${data.backedUp} file(s) saved first` : ''}`}</Paragraph>
          <Paragraph>{`${data.themeName} is now on ${data.commitSha.slice(0, 7)} ${firstLine(data.commitMessage)}`}</Paragraph>
          <Paragraph color="subdued">
            {data.themeRole === 'MAIN'
              ? 'Customers see the update now.'
              : 'Preview the theme in Shopify. When you are happy with it, publish it in Shopify as usual — Theme Sync never publishes a theme on its own.'}
          </Paragraph>
        </Banner>
      )}
      {data && incomplete && (
        <Section accessibilityLabel="Update result">
          <Stack gap="base">
            {data.restoredAt ? (
              <Banner tone="info" heading="Backup restored">
                <Paragraph>
                  {`${data.themeName} is back exactly as it was before this update (${data.restoredFiles} file(s), ${formatDate(data.restoredAt)}). Run the full update again when you are ready.`}
                </Paragraph>
              </Banner>
            ) : (
              <Banner
                tone="critical"
                heading={`Update incomplete · ${data.filesSucceeded} of ${data.filesChanged} files updated`}
              >
                <Paragraph>
                  The theme is not marked as updated until every file succeeds.
                  {data.errorDetails && data.errorDetails.code !== 'FILES_FAILED'
                    ? ` ${data.errorDetails.message}`
                    : ''}
                </Paragraph>
              </Banner>
            )}

            {failed.length > 0 && (
              <Stack gap="small-200">
                {failed.map((op) => (
                  <Grid
                    key={op.id}
                    gridTemplateColumns="minmax(0, 1fr) minmax(0, 1.4fr)"
                    gap="small-200"
                    alignItems="start"
                  >
                    <Stack gap="none">
                      <Text type="strong">
                        <Text tone="critical">×</Text> {themeFileLabel(op.path)}
                      </Text>
                      <Text color="subdued">{op.path}</Text>
                    </Stack>
                    <Stack gap="none">
                      <Text>{op.failure?.reason ?? 'Could not be updated'}</Text>
                      {op.failure?.detail && <Text color="subdued">{op.failure.detail}</Text>}
                    </Stack>
                  </Grid>
                ))}
              </Stack>
            )}

            <Text>
              {`${data.themeName} remains on `}
              <Text type="strong">{data.baseSha ? data.baseSha.slice(0, 7) : 'its previous version'}</Text>
              <Text color="subdued">{data.baseSha ? ' (its last synced commit)' : ''}</Text>
            </Text>

            <Stack direction="inline" gap="small-200" justifyContent="end">
              {!data.restoredAt && (
                <Button
                  disabled={!data.canRestore}
                  loading={restore.pending}
                  onClick={() => setConfirmAction('restore')}
                >
                  Restore Backup
                </Button>
              )}
              <Button loading={rerunPreview.pending} onClick={doRerun}>
                Run Full Update Again
              </Button>
              {!data.restoredAt && (
                <Button
                  variant="primary"
                  disabled={!data.canRetry || !retryHelps}
                  loading={retry.pending}
                  onClick={() => (live ? setConfirmAction('retry') : doRetry())}
                >
                  Retry Failed Files
                </Button>
              )}
            </Stack>
            {!retryHelps && !data.restoredAt && (
              <Text color="subdued">
                Every failed file has a code error: ask your developer to fix it, then apply the new update.
              </Text>
            )}

            <IndexTable
              variant="auto"
              columns={[
                { title: 'Option', listSlot: 'primary' },
                { title: 'When to use it', listSlot: 'secondary' },
              ]}
              rows={INCOMPLETE_OPTIONS.map((o) => (
                <IndexTableRow key={o.option}>
                  <IndexTableCell>
                    <Text type="strong">{o.option}</Text>
                  </IndexTableCell>
                  <IndexTableCell>{o.when}</IndexTableCell>
                </IndexTableRow>
              ))}
            />
            <Banner tone="info">
              <Paragraph>Temporary issues are usually retried automatically before you see any message.</Paragraph>
            </Banner>
          </Stack>
        </Section>
      )}
      {data && data.commitsIncluded.length > 0 && (
        <Section heading={`Updates included (${data.commitsIncluded.length})`}>
          <Stack gap="small-300">
            {data.baseSha && (
              <Text color="subdued">{`From ${data.baseSha.slice(0, 7)} (last synced before this update)`}</Text>
            )}
            {data.commitsIncluded.map((c) => (
              <Text key={c.sha}>
                <Text type="strong">{c.shortSha}</Text> {firstLine(c.message)}
              </Text>
            ))}
          </Stack>
        </Section>
      )}
      {data && (
        <Section heading="Summary">
          <Stack gap="small-200">
            <Stack direction="inline" gap="small-200" alignItems="center">
              <Badge tone={SYNC_STATUS_BADGE[data.status].tone}>{SYNC_STATUS_BADGE[data.status].label}</Badge>
              {data.themeRole === 'MAIN' && <Badge tone="warning">Live theme</Badge>}
              <Text color="subdued">Attempt {data.attempt}</Text>
            </Stack>
            <Paragraph>
              <Text type="strong">{data.repository}</Text> @ {data.commitSha}
              {data.branch ? ` (${data.branch})` : ''}
            </Paragraph>
            <Text color="subdued">{firstLine(data.commitMessage)}</Text>
            <Text>
              {`${syncTypeLabel(data.strategy)} · ${data.filesSucceeded} succeeded · ${data.filesFailed} failed · ${data.filesSkipped - data.filesIgnored} skipped · ${data.filesIgnored} ignored · ${data.filesChanged} planned`}
            </Text>
            <Text color="subdued">{`Job ID ${data.id}`}</Text>
            <Text color="subdued">
              Started {formatDate(data.startedAt ?? data.initiatedAt)} · Completed {formatDate(data.completedAt)}
            </Text>
          </Stack>
        </Section>
      )}

      <Section heading="Files">
        <Checkbox
          slot="secondary-actions"
          label="Show skipped"
          checked={showSkipped}
          onChange={(event) => setShowSkipped(event.currentTarget.checked)}
        />
        <IndexTable
          variant="auto"
          columns={[
            { title: 'Status', listSlot: 'inline' },
            { title: 'Theme file', listSlot: 'primary' },
            { title: 'Action', listSlot: 'kicker' },
            { title: 'Details', listSlot: 'secondary' },
          ]}
          rows={operations.map((op) => (
            <IndexTableRow key={op.id}>
              <IndexTableCell>
                <Badge tone={OP_BADGE[op.status].tone}>{OP_BADGE[op.status].label}</Badge>
              </IndexTableCell>
              <IndexTableCell>{op.path}</IndexTableCell>
              <IndexTableCell>{op.action === 'delete' ? 'Delete' : 'Write'}</IndexTableCell>
              <IndexTableCell>
                <Text color="subdued">
                  {(op.failure ? `${op.failure.reason} · ${op.failure.detail}` : null) ??
                    op.skipReason ??
                    (op.previousPath ? `renamed from ${op.previousPath}` : op.changeType)}
                  {op.sourceCommitSha ? ` · from ${op.sourceCommitSha.slice(0, 7)}` : ''}
                  {op.attempts > 0 ? ` · ${op.attempts} attempt${op.attempts === 1 ? '' : 's'}` : ''}
                  {op.status === 'failed' && op.lastAttemptAt ? ` · failed ${formatDate(op.lastAttemptAt)}` : ''}
                </Text>
              </IndexTableCell>
            </IndexTableRow>
          ))}
        />
      </Section>

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
      }),
    [page, status, themeId, branch, strategy],
  );
  const filter =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const filtered = !!(status || themeId || branch || strategy);

  return (
    <AppLayout
      title="Sync history"
      secondaryActions={[{ content: 'Refresh', onAction: history.reload }]}
      banners={<ErrorBanner error={history.error} onRetry={history.reload} />}
    >
      <Section heading="Filters">
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
          <Select
            label="Theme"
            value={themeId || ALL}
            onChange={(event) => filter(setThemeId)(event.currentTarget.value === ALL ? '' : event.currentTarget.value)}
          >
            <Option value={ALL}>All themes</Option>
            {(themes.data ?? []).map((t) => (
              <Option key={t.id} value={t.id}>
                {t.name}
              </Option>
            ))}
          </Select>
          <Select
            label="Branch"
            value={branch || ALL}
            onChange={(event) => filter(setBranch)(event.currentTarget.value === ALL ? '' : event.currentTarget.value)}
          >
            <Option value={ALL}>All branches</Option>
            {(branches.data?.items ?? []).map((b) => (
              <Option key={b.name} value={b.name}>
                {b.name}
              </Option>
            ))}
          </Select>
          <Select
            label="Sync type"
            value={strategy || ALL}
            onChange={(event) =>
              filter(setStrategy)(event.currentTarget.value === ALL ? '' : (event.currentTarget.value as SyncStrategy))
            }
          >
            <Option value={ALL}>All types</Option>
            {SYNC_TYPES.map((t) => (
              <Option key={t} value={t}>
                {syncTypeLabel(t)}
              </Option>
            ))}
          </Select>
          <Select
            label="Status"
            value={status || ALL}
            onChange={(event) =>
              filter(setStatus)(event.currentTarget.value === ALL ? '' : (event.currentTarget.value as SyncStatus))
            }
          >
            <Option value={ALL}>All statuses</Option>
            {(Object.keys(SYNC_STATUS_BADGE) as SyncStatus[]).map((st) => (
              <Option key={st} value={st}>
                {SYNC_STATUS_BADGE[st].label}
              </Option>
            ))}
          </Select>
        </Grid>
        {filtered && (
          <Button
            slot="secondary-actions"
            variant="tertiary"
            onClick={() => {
              setStatus('');
              setThemeId('');
              setBranch('');
              setStrategy('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </Section>

      <Section padding="none" accessibilityLabel="Sync history">
        <IndexTable
          variant="auto"
          loading={history.loading}
          paginate
          hasPreviousPage={page > 1}
          hasNextPage={!!history.data?.hasNextPage}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
          columns={[
            { title: 'Commits', listSlot: 'primary' },
            { title: 'Repository · branch → theme', listSlot: 'secondary' },
            { title: 'Type', listSlot: 'labeled' },
            { title: 'Status', listSlot: 'inline' },
            { title: 'Started', listSlot: 'labeled' },
            { title: 'Completed', listSlot: 'labeled' },
            { title: 'Details' },
          ]}
          rows={(history.data?.items ?? []).map((run) => {
            const shas =
              run.commitsIncluded.length > 1 ? run.commitsIncluded.map((c) => c.shortSha) : [run.commitSha.slice(0, 7)];
            return (
              <IndexTableRow key={run.id}>
                <IndexTableCell>
                  <Stack gap="none">
                    <Text type="strong">
                      {shas.length > 3 ? `${shas[0]} … ${shas[shas.length - 1]} (${shas.length})` : shas.join(', ')}
                    </Text>
                    <Text color="subdued">{firstLine(run.commitMessage)}</Text>
                    {run.errorDetails && <Text tone="critical">{run.errorDetails.message}</Text>}
                    <Text color="subdued">{`Job ${run.id.slice(0, 8)}`}</Text>
                  </Stack>
                </IndexTableCell>
                <IndexTableCell>
                  {`${run.repository} · ${run.branch ?? '—'} → ${run.themeName}${run.themeRole === 'MAIN' ? ' (live)' : ''}`}
                </IndexTableCell>
                <IndexTableCell>{syncTypeLabel(run.strategy)}</IndexTableCell>
                <IndexTableCell>
                  <Badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</Badge>
                </IndexTableCell>
                <IndexTableCell>{formatDate(run.startedAt ?? run.initiatedAt)}</IndexTableCell>
                <IndexTableCell>{formatDate(run.completedAt)}</IndexTableCell>
                <IndexTableCell>
                  <Button variant="tertiary" accessibilityLabel={`Open sync ${run.id}`} onClick={() => onOpen(run.id)}>
                    {run.canRetry ? 'View / retry' : 'View'}
                  </Button>
                </IndexTableCell>
              </IndexTableRow>
            );
          })}
        />
        {!history.loading && history.data?.items.length === 0 && (
          <Box padding="base">
            <Paragraph color="subdued">
              {filtered
                ? 'No synchronizations match these filters.'
                : 'No synchronizations yet. Start one from Theme mapping or Commit sync.'}
            </Paragraph>
          </Box>
        )}
      </Section>
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
