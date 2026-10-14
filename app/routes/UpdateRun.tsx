import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { FileList, type FileListItem } from '../components/FileList';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, formatDay, KIND_LABEL, LINE_LABEL, plural, runTitle, STATUS_BADGE } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { UpdateFile, UpdateRunDetail } from '../lib/types';

const POLL_MS = 2500;

function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <s-grid gridTemplateColumns="10rem 1fr" gap="base" alignItems="center">
      <s-text color="subdued">{label}</s-text>
      <s-box>{children}</s-box>
    </s-grid>
  );
}

function CommitRefText({ commit, empty }: { commit: { shortSha: string; message: string | null } | null; empty: string }) {
  if (!commit) return <s-text color="subdued">{empty}</s-text>;
  return (
    <s-text>
      <s-text type="strong">{commit.shortSha}</s-text> {firstLine(commit.message)}
    </s-text>
  );
}

function fileItems(files: UpdateFile[]): FileListItem[] {
  return files
    .filter((f) => f.change !== 'skipped')
    .map((f) => ({ path: f.path, change: f.change as FileListItem['change'], note: f.introducedBy ?? undefined }));
}

// ---------------------------------------------------------------------------
// Step 03 — automatic checks
// ---------------------------------------------------------------------------
function Checks({ run }: { run: UpdateRunDetail }) {
  const checks = run.checks;
  if (!checks) return null;
  const warnings = (checks.code.status === 'failed' ? 1 : 0) + (checks.directEdits.status === 'warning' ? 1 : 0);
  return (
    <s-section heading="Checks">
      <s-badge slot="secondary-actions" tone={warnings > 0 ? (checks.code.status === 'failed' ? 'critical' : 'caution') : 'success'}>
        {warnings > 0 ? plural(warnings, 'warning') : 'Passed'}
      </s-badge>
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1.5rem 10rem 1fr" gap="base">
          <s-text tone={checks.code.status === 'failed' ? 'critical' : 'success'} type="strong">
            {checks.code.status === 'failed' ? '✕' : '✓'}
          </s-text>
          <s-text type="strong">Code check</s-text>
          <s-stack gap="small-300">
            {checks.code.status === 'passed' ? (
              <s-text>{`No Liquid or JSON errors in ${plural(checks.code.filesChecked, 'file')}`}</s-text>
            ) : (
              checks.code.issues.map((issue) => (
                <s-text key={`${issue.path}:${issue.line}:${issue.message}`} tone="critical">
                  {`${issue.path}${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`}
                </s-text>
              ))
            )}
            {checks.code.filesDeferred > 0 && (
              <s-text color="subdued">{`${plural(checks.code.filesDeferred, 'more file')} are checked as they are applied.`}</s-text>
            )}
          </s-stack>
        </s-grid>
        <s-divider />
        <s-grid gridTemplateColumns="1.5rem 10rem 1fr" gap="base">
          <s-text tone={checks.directEdits.status === 'warning' ? 'caution' : 'success'} type="strong">
            {checks.directEdits.status === 'warning' ? '!' : '✓'}
          </s-text>
          <s-text type="strong">{checks.directEdits.status === 'warning' ? 'Direct edit found' : 'Direct edits'}</s-text>
          <s-stack gap="small-300">
            {checks.directEdits.status === 'warning' ? (
              checks.directEdits.files.map((file) => (
                <s-text key={file.path}>
                  {file.reason === 'added'
                    ? `${file.path} was added in Shopify${file.updatedAt ? ` on ${formatDay(file.updatedAt)}` : ''} and is not in the last synced update. Replace it with the repo version?`
                    : `${file.path} was edited in Shopify${file.updatedAt ? ` on ${formatDay(file.updatedAt)}` : ''}. Replace it with the repo version?`}
                </s-text>
              ))
            ) : (
              <s-text>{checks.directEdits.note ?? 'Nobody changed these files directly in Shopify since the last sync.'}</s-text>
            )}
            {checks.directEdits.status === 'warning' && checks.directEdits.note && (
              <s-text color="subdued">{checks.directEdits.note}</s-text>
            )}
          </s-stack>
        </s-grid>
      </s-stack>
    </s-section>
  );
}

// ---------------------------------------------------------------------------
// Step 04 — review
// ---------------------------------------------------------------------------
function Review({ run, storeName }: { run: UpdateRunDetail; storeName: string }) {
  const backward = run.direction === 'backward';
  const showByCommit = (run.kind === 'update' || run.kind === 'rollback') && run.commits.some((c) => c.files.length > 0);
  const t = run.totals;
  return (
    <s-section heading={run.kind === 'publish' ? 'Publish to Live' : 'Review before updating'}>
      <s-stack gap="base">
        <KeyValue label="Store · Theme">
          <s-text type="strong">{`${storeName} · ${run.theme.name}`}</s-text>
        </KeyValue>
        <s-divider />
        <KeyValue label="Current">
          <CommitRefText commit={run.base} empty="No update recorded yet" />
        </KeyValue>
        <s-divider />
        <KeyValue label={run.kind === 'restore' ? 'Restoring to' : backward ? 'Go back to' : 'Updating to'}>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <CommitRefText commit={run.target} empty="The state before the update" />
            {run.kind === 'publish' && run.verifiedOnStagingAt && <s-badge tone="success">Verified on Staging</s-badge>}
          </s-stack>
        </KeyValue>

        {showByCommit && (
          <s-stack gap="small-200">
            <s-text color="subdued">
              {backward
                ? `Updates undone (${run.commits.length}) · files by commit`
                : `Updates included (${run.commits.length}) · files by commit`}
            </s-text>
            {run.commits.map((commit) => (
              <s-box key={commit.sha} border="base" borderRadius="base" padding="small">
                <s-stack gap="small-200">
                  <s-text type="strong">{`${commit.shortSha} ${firstLine(commit.message)}`}</s-text>
                  <FileList
                    files={commit.files
                      .filter((f) => !f.ignored)
                      .map((f) => ({ path: f.path, change: f.change, note: f.protected ? 'protected · untouched' : undefined, muted: f.protected }))}
                    empty={commit.filesTruncated ? 'Too many files to list here.' : 'No theme files.'}
                  />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}

        {(!showByCommit || run.kind === 'publish') && (
          <s-stack gap="small-200">
            <s-text color="subdued">
              {`Files that will change${run.kind === 'publish' ? ' on Live' : ''} (${t.added + t.updated + t.removed})`}
            </s-text>
            <FileList files={fileItems(run.files)} empty="No theme files change." />
          </s-stack>
        )}

        <s-stack gap="small-200">
          <s-text color="subdued">Total</s-text>
          <s-stack direction="inline" gap="small-200">
            <s-badge tone="success">{`${t.added} new`}</s-badge>
            <s-badge tone="caution">{`${t.updated} updated`}</s-badge>
            <s-badge tone="critical">{`${t.removed} removed`}</s-badge>
            <s-badge tone="neutral">
              {t.protectedUntouched > 0 ? `${t.protectedUntouched} protected files untouched` : 'Protected files untouched'}
            </s-badge>
          </s-stack>
        </s-stack>
        {run.warnings.map((w) => (
          <s-banner key={w} tone="info">
            <s-paragraph>{w}</s-paragraph>
          </s-banner>
        ))}
      </s-stack>
    </s-section>
  );
}

// ---------------------------------------------------------------------------
// Steps 05/06/08 — progress and result
// ---------------------------------------------------------------------------
const ERROR_KIND_BADGE = {
  code: { label: 'Needs developer fix', tone: 'critical' as const },
  transient: { label: 'Can be retried', tone: 'neutral' as const },
  other: { label: 'Can be retried', tone: 'neutral' as const },
};

function Progress({ run }: { run: UpdateRunDetail }) {
  const backingUp = run.phase === 'backup';
  const backupTotal = run.files.filter((f) => f.backup !== null).length;
  return (
    <s-section heading={backingUp ? 'Saving a backup' : 'Updating files'}>
      <s-stack gap="base">
        <s-text>
          {backingUp
            ? `Saving the current version of the affected files before anything changes: ${run.progress.backedUp} of ${backupTotal}`
            : `${run.progress.succeeded} of ${run.progress.total} files updated${run.progress.failed ? ` · ${run.progress.failed} failed` : ''}`}
        </s-text>
        <s-progress
          accessibilityLabel="Update progress"
          tone="info"
          max={Math.max(1, backingUp ? backupTotal : run.progress.total)}
          value={backingUp ? run.progress.backedUp : run.progress.succeeded + run.progress.failed}
        />
        <s-text color="subdued">
          {run.line === 'live' ? 'Customers see the update as soon as every file succeeds.' : 'The Live theme is not touched.'}
        </s-text>
      </s-stack>
    </s-section>
  );
}

function Result({
  run,
  shopDomain,
  liveSummary,
  onPublish,
  onRestore,
  restoring,
}: {
  run: UpdateRunDetail;
  shopDomain: string;
  liveSummary: { sha: string | null; waiting: number } | null;
  onPublish: () => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const numericId = run.theme.id.split('/').pop();
  const previewUrl = `https://${shopDomain}/?preview_theme_id=${numericId}`;
  const label = run.line === 'other' ? run.theme.name : LINE_LABEL[run.line];
  return (
    <s-section>
      <s-stack gap="base">
        <s-banner tone="success" heading={run.kind === 'restore' ? `${label} restored` : `${label} update complete`}>
          <s-paragraph>
            {`Files ${run.progress.succeeded} of ${run.progress.total} updated · backup saved ${formatDate(run.startedAt)}`}
          </s-paragraph>
        </s-banner>
        <s-progress accessibilityLabel="Complete" tone="success" max={1} value={1} />
        <KeyValue label={`${label} is now on`}>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <CommitRefText commit={run.target} empty="its earlier state" />
            <s-badge tone="success">Up to date</s-badge>
          </s-stack>
        </KeyValue>
        {run.line === 'staging' && liveSummary && (
          <KeyValue label="Live is on">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{liveSummary.sha ? liveSummary.sha.slice(0, 7) : 'no update yet'}</s-text>
              {liveSummary.waiting > 0 && <s-badge tone="caution">{`${plural(liveSummary.waiting, 'update')} to publish`}</s-badge>}
            </s-stack>
          </KeyValue>
        )}
        <s-stack direction="inline" gap="small-200">
          <s-button href={previewUrl} target="_blank">
            {`Preview ${run.theme.name} in Shopify ↗`}
          </s-button>
          {run.actions.canPublish && (
            <s-button variant="primary" onClick={onPublish}>
              Publish to Live →
            </s-button>
          )}
        </s-stack>

        {run.line === 'staging' && run.kind !== 'restore' && (
          <>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Looks right?</s-text>
                  <s-text>Publish the same update to Live.</s-text>
                </s-stack>
              </s-box>
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Something is off?</s-text>
                  <s-text>Restore Staging to its earlier version or ask your developer for a fix. Live stays exactly as it was.</s-text>
                  {run.actions.canRestore && (
                    <s-stack direction="inline">
                      <s-button loading={restoring} onClick={onRestore}>
                        Restore Staging
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            </s-grid>
            <s-section heading="What to check on Staging">
              <s-ordered-list>
                <s-list-item>The pages the update touched — the review lists them.</s-list-item>
                <s-list-item>Brand styling: colors, type and logo still match the brand.</s-list-item>
                <s-list-item>Desktop and mobile: preview both in the Shopify theme preview.</s-list-item>
                <s-list-item>A test checkout path: add to cart and reach checkout for any cart or product change.</s-list-item>
              </s-ordered-list>
            </s-section>
          </>
        )}
        {run.line === 'live' && run.kind === 'publish' && (
          <s-paragraph>
            {`${run.theme.name} now shows ${run.target?.shortSha ?? ''} as its last synced update. The publish is recorded in the update history.`}
          </s-paragraph>
        )}
      </s-stack>
    </s-section>
  );
}

function Incomplete({
  run,
  onRetry,
  onRerun,
  onRestore,
  pending,
}: {
  run: UpdateRunDetail;
  onRetry: () => void;
  onRerun: () => void;
  onRestore: () => void;
  pending: 'retry' | 'rerun' | 'restore' | null;
}) {
  const failed = run.files.filter((f) => f.status === 'failed');
  return (
    <s-section>
      <s-stack gap="base">
        <s-banner tone="critical" heading={`Update incomplete · ${run.progress.succeeded} of ${run.progress.total} files updated`}>
          <s-paragraph>
            {`${run.theme.name} remains on ${run.base?.shortSha ?? 'its previous update'}${run.line === 'staging' ? ' · Publish to Live is unavailable' : ''}.`}
          </s-paragraph>
          {run.errorDetails && run.errorDetails.code !== 'FILES_FAILED' && <s-paragraph>{run.errorDetails.message}</s-paragraph>}
        </s-banner>
        {failed.length > 0 && (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">File</s-table-header>
              <s-table-header listSlot="secondary">Problem</s-table-header>
              <s-table-header listSlot="inline">What to do</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {failed.map((file) => {
                const badge = ERROR_KIND_BADGE[file.errorKind ?? 'other'];
                return (
                  <s-table-row key={file.id}>
                    <s-table-cell>{file.path}</s-table-cell>
                    <s-table-cell>{file.errorKind === 'transient' ? `Temporary Shopify issue: ${file.error ?? ''}` : (file.error ?? 'Failed')}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
        <s-stack direction="inline" gap="small-200">
          {run.actions.canRestore && (
            <s-button loading={pending === 'restore'} disabled={!!pending} onClick={onRestore}>
              Restore backup
            </s-button>
          )}
          {run.actions.canRerun && (
            <s-button loading={pending === 'rerun'} disabled={!!pending} onClick={onRerun}>
              Run full update again
            </s-button>
          )}
          {run.actions.canRetry && (
            <s-button variant="primary" loading={pending === 'retry'} disabled={!!pending} onClick={onRetry}>
              Retry failed files
            </s-button>
          )}
        </s-stack>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Option</s-table-header>
            <s-table-header listSlot="secondary">When to use it</s-table-header>
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>Retry failed files</s-table-cell>
              <s-table-cell>A temporary issue, such as Shopify being busy. Only the failed files are tried again.</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Run full update again</s-table-cell>
              <s-table-cell>The theme was changed in the meantime, or you want a complete fresh check.</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Restore backup</s-table-cell>
              <s-table-cell>You want the theme back exactly as it was before this update.</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Ask your developer</s-table-cell>
              <s-table-cell>The file has a code error. Once fixed, apply the new update.</s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
      </s-stack>
    </s-section>
  );
}

const FILE_STATUS: Record<UpdateFile['status'], { label: string; tone: 'info' | 'success' | 'critical' | 'neutral' }> = {
  pending: { label: 'Waiting', tone: 'info' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  skipped: { label: 'Untouched', tone: 'neutral' },
};

function AllFiles({ run }: { run: UpdateRunDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <s-section heading={`All files (${run.files.length})`}>
      <s-button slot="secondary-actions" variant="tertiary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'}
      </s-button>
      {open && (
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">File</s-table-header>
            <s-table-header>Change</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="secondary">Details</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {run.files.map((file) => (
              <s-table-row key={file.id}>
                <s-table-cell>{file.path}</s-table-cell>
                <s-table-cell>{file.change === 'skipped' ? '—' : file.change === 'added' ? 'New' : file.change === 'removed' ? 'Removed' : 'Updated'}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={FILE_STATUS[file.status].tone}>{FILE_STATUS[file.status].label}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-text color="subdued">{file.error ?? file.skipReason ?? (file.introducedBy ? `from ${file.introducedBy}` : '')}</s-text>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function UpdateRun() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useApiQuery(() => api.updates.get(id), [id]);
  const overview = useApiQuery(() => api.overview(), [query.data?.status === 'succeeded']);
  const [acceptedEdits, setAcceptedEdits] = useState(false);
  const [pending, setPending] = useState<'retry' | 'rerun' | 'restore' | null>(null);
  const confirm = useMutation(api.updates.confirm);
  const cancel = useMutation(api.updates.cancel);
  const action = useMutation(async (kind: 'retry' | 'rerun' | 'restore') => api.updates[kind](id));

  const run = query.data;
  const active = run?.status === 'queued' || run?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      api.updates.get(id).then(query.setData).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, id, query.setData]);

  if (query.loading && !run) return <LoadingState title="Update" />;
  const storeName = overview.data?.store.name ?? run?.shopDomain ?? '';
  const shopDomain = overview.data?.store.shopDomain ?? run?.shopDomain ?? '';

  const doConfirm = async () => {
    if (!run) return;
    const result = await confirm.run(id, { acceptDirectEdits: acceptedEdits || undefined });
    if (result) {
      showToast(run.line === 'live' ? 'Publishing to Live' : 'Updating Staging');
      query.reload();
    }
  };
  const doCancel = async () => {
    const result = await cancel.run(id);
    if (result) {
      showToast('Update cancelled. Nothing changed.');
      navigate(!run ? '/updates' : run.kind === 'publish' ? '/publish' : run.line === 'staging' ? '/updates' : `/themes/${run.theme.id.split('/').pop()}`);
    }
  };
  const doAction = async (kind: 'retry' | 'rerun' | 'restore') => {
    setPending(kind);
    const result = await action.run(kind);
    setPending(null);
    if (!result) return;
    if (kind === 'retry') {
      showToast('Retrying the failed files');
      query.reload();
    } else {
      navigate(`/updates/${result.id}`);
    }
  };

  const review = run?.status === 'previewed';
  const codeBlocked = !!run?.actions.blockedByCodeErrors;
  const needsDecision = !!run?.actions.needsDirectEditApproval && !acceptedEdits;
  const confirmLabel = !run
    ? ''
    : run.kind === 'publish'
      ? 'Publish to Live'
      : run.kind === 'restore'
        ? 'Restore backup'
        : run.kind === 'rollback'
          ? `Confirm going back on ${LINE_LABEL[run.line]}`
          : run.line === 'staging'
            ? 'Confirm update to Staging'
            : `Confirm update to ${run.theme.name}`;

  const liveSummary = overview.data
    ? { sha: overview.data.live.lastSynced?.sha ?? null, waiting: overview.data.live.waiting }
    : null;

  return (
    <AppLayout
      title={run ? runTitle(run) : 'Update'}
      subtitle={run ? `${KIND_LABEL[run.kind]} · ${storeName} · ${run.theme.name}` : undefined}
      backAction={{ content: 'History', onAction: () => navigate('/history') }}
      banners={
        <>
          <ErrorBanner error={query.error} onRetry={query.reload} />
          <ErrorBanner error={confirm.error} heading="The update did not start" onDismiss={confirm.clearError} />
          <ErrorBanner error={cancel.error ?? action.error} onDismiss={action.clearError} />
        </>
      }
    >
      {run && (
        <>
          {run.status !== 'previewed' && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={STATUS_BADGE[run.status].tone}>{STATUS_BADGE[run.status].label}</s-badge>
              <s-text color="subdued">{`Confirmed ${formatDate(run.confirmedAt)}${run.completedAt ? ` · finished ${formatDate(run.completedAt)}` : ''}`}</s-text>
            </s-stack>
          )}

          {run.status === 'expired' && (
            <s-banner tone="warning" heading="This review expired">
              <s-paragraph>Reviews are valid for 30 minutes so you always confirm the latest state. Start again.</s-paragraph>
              <s-button slot="secondary-actions" onClick={() => navigate(`/themes/${run.theme.id.split('/').pop()}`)}>
                Start again
              </s-button>
            </s-banner>
          )}
          {run.status === 'cancelled' && (
            <s-banner tone="info" heading="Update cancelled">
              <s-paragraph>Nothing changed in the theme.</s-paragraph>
            </s-banner>
          )}

          {(review || run.status === 'expired') && <Checks run={run} />}

          {review && codeBlocked && (
            <s-banner tone="critical" heading="Problems found — the developer fixes them">
              <s-paragraph>
                Code with errors is blocked before it reaches Shopify. Ask your developer to fix the files above and save a
                new update.
              </s-paragraph>
              <s-button slot="secondary-actions" loading={cancel.pending} onClick={doCancel}>
                Stop and ask developer
              </s-button>
            </s-banner>
          )}

          {review && !codeBlocked && needsDecision && (
            <s-section>
              <s-stack direction="inline" gap="small-200" justifyContent="end">
                <s-button loading={cancel.pending} onClick={doCancel}>
                  Stop and ask developer
                </s-button>
                <s-button variant="primary" onClick={() => setAcceptedEdits(true)}>
                  Replace and continue
                </s-button>
              </s-stack>
            </s-section>
          )}

          {(review || run.status === 'expired') && !codeBlocked && !needsDecision && (
            <>
              <Review run={run} storeName={storeName} />
              {review && (
                <s-section>
                  <s-stack gap="base">
                    <s-text tone="success">
                      {run.actions.needsDirectEditApproval
                        ? '✓ Code check passed — direct edits will be replaced'
                        : '✓ Checks passed — no problems found'}
                    </s-text>
                    <s-text color="subdued">
                      {`A backup of the affected files is saved first. ${
                        run.line === 'live' ? 'Only this Live theme is changed.' : 'The Live theme is not touched.'
                      }`}
                    </s-text>
                    <s-stack direction="inline" gap="small-200" justifyContent="end">
                      <s-button loading={cancel.pending} disabled={confirm.pending} onClick={doCancel}>
                        Cancel
                      </s-button>
                      <s-button variant="primary" loading={confirm.pending} disabled={!run.actions.canConfirm} onClick={doConfirm}>
                        {confirmLabel}
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-section>
              )}
            </>
          )}

          {active && <Progress run={run} />}
          {run.status === 'succeeded' && run.kind !== 'baseline' && (
            <Result
              run={run}
              shopDomain={shopDomain}
              liveSummary={liveSummary}
              onPublish={() => navigate('/publish')}
              onRestore={() => doAction('restore')}
              restoring={pending === 'restore'}
            />
          )}
          {run.status === 'succeeded' && run.kind === 'baseline' && (
            <s-banner tone="success" heading="Recorded">
              <s-paragraph>{`${run.theme.name} is recorded as running ${run.target?.shortSha ?? ''}. No theme files were changed.`}</s-paragraph>
            </s-banner>
          )}
          {(run.status === 'failed' || run.status === 'partially_failed') && (
            <Incomplete run={run} pending={pending} onRetry={() => doAction('retry')} onRerun={() => doAction('rerun')} onRestore={() => doAction('restore')} />
          )}
          {run.files.length > 0 && <AllFiles run={run} />}
        </>
      )}
    </AppLayout>
  );
}
