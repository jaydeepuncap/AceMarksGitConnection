import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyncPlanOperation, SyncPreview } from '../lib/types';
import { syncTypeLabel, type Tone } from '../lib/format';

interface Props {
  open: boolean;
  preview: SyncPreview | null;
  submitting: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (confirmation: {
    confirmLiveTheme?: boolean;
    confirmThemeName?: string;
    acceptDirectEdits?: boolean;
  }) => void;
}

const firstLine = (message: string | null | undefined) => (message ?? '').split('\n')[0] ?? '';

/** "from 50924bd, f6ca831" — the included commits that changed the file. */
const fromCommits = (op: SyncPlanOperation) =>
  op.commits && op.commits.length > 0 ? `from ${op.commits.join(', ')}` : '';

const STRATEGY_LABEL: Record<SyncPreview['strategy'], string> = {
  since_last_sync: 'from the last sync to the selected commit',
  commit_changes: 'only the selected commit',
  full_snapshot: 'full snapshot',
  selected_commits: 'the selected commits',
};

/** Skipped because of an ignore pattern in Settings (shared prefix with the planner's skip reason). */
const isIgnoredOp = (op: SyncPlanOperation) =>
  op.action === 'skip' && !!op.skipReason?.startsWith('Matches ignore pattern');

function actionBadge(op: SyncPlanOperation): { label: string; tone: Tone } {
  if (isIgnoredOp(op)) return { label: 'Ignored', tone: 'neutral' };
  if (op.action === 'skip') return { label: 'Skip', tone: 'neutral' };
  if (op.action === 'delete') return { label: 'Delete', tone: 'critical' };
  return op.existsInTheme ? { label: 'Update', tone: 'caution' } : { label: 'Create', tone: 'success' };
}

const MODAL_ID = 'confirm-sync-modal';

/**
 * <s-modal> showing the previewed plan. Nothing is written until the user
 * confirms. For the live theme the user must tick a checkbox AND type the
 * theme's exact name; the server enforces the same rule.
 */
export function ConfirmSyncModal({ open, preview, submitting, error, onClose, onConfirm }: Props) {
  const modalRef = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const [ack, setAck] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [acceptEdits, setAcceptEdits] = useState(false);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (open) modal.showOverlay?.();
    else modal.hideOverlay?.();
  }, [open, preview]);

  useEffect(() => {
    if (!open) {
      setAck(false);
      setTypedName('');
      setAcceptEdits(false);
    }
  }, [open]);

  // Every file that changes, plus ignored files (never changed); other skipped files on request.
  const operations = useMemo(
    () => (preview?.operations ?? []).filter((op) => showSkipped || op.action !== 'skip' || isIgnoredOp(op)),
    [preview, showSkipped],
  );

  const live = preview?.requiresLiveConfirmation ?? false;
  const writes = preview ? preview.summary.creates + preview.summary.updates + preview.summary.deletes : 0;
  const liveConfirmed = !live || (ack && typedName === preview?.theme.name);
  const codeBlocked = preview?.checks.code.status === 'failed';
  const editsWarning = preview?.checks.directEdits.status === 'warning';
  const canConfirm =
    !!preview && writes > 0 && liveConfirmed && !codeBlocked && (!editsWarning || acceptEdits) && !submitting;

  return (
    <s-modal id={MODAL_ID} ref={modalRef} size="large" heading="Review before updating" onHide={onClose}>
      {preview && (
        <s-stack gap="base">
          {error && (
            <s-banner tone="critical" heading="Sync could not start">
              <s-paragraph>{error}</s-paragraph>
            </s-banner>
          )}
          {live && (
            <s-banner tone="warning" heading="This is your live theme">
              <s-paragraph>
                Customers will see these changes immediately. Consider syncing to an unpublished copy first.
              </s-paragraph>
            </s-banner>
          )}
          <s-grid gridTemplateColumns="9rem 1fr" gap="small-200">
            <s-text color="subdued">Repository</s-text>
            <s-text>{`${preview.repository} · ${preview.branch ?? '—'}`}</s-text>
            <s-text color="subdued">Theme</s-text>
            <s-text>
              <s-text type="strong">{preview.theme.name}</s-text>
              {` · ID ${preview.theme.numericId}${preview.theme.isLive ? ' · live' : ''}`}
            </s-text>
            <s-text color="subdued">Sync type</s-text>
            <s-text>{syncTypeLabel(preview.strategy)}</s-text>
            <s-text color="subdued">Current</s-text>
            <s-text>
              {preview.base ? (
                <>
                  <s-text type="strong">{preview.base.shortSha}</s-text> {firstLine(preview.base.message)}
                </>
              ) : (
                'No last synced commit on this branch'
              )}
            </s-text>
            <s-text color="subdued">Updating to</s-text>
            <s-text>
              <s-text type="strong">{preview.commit.sha.slice(0, 7)}</s-text> {firstLine(preview.commit.message)}
            </s-text>
          </s-grid>

          <s-stack gap="small-300">
            <s-text type="strong">{`Updates included (${preview.commitsIncluded.length})`}</s-text>
            {preview.commitsIncluded.map((c) => (
              <s-text key={c.sha}>
                <s-text type="strong">{c.shortSha}</s-text> {firstLine(c.message)}
              </s-text>
            ))}
          </s-stack>

          {codeBlocked ? (
            <s-banner tone="critical" heading="Code errors found — ask your developer to fix them">
              {preview.checks.code.issues.map((issue) => (
                <s-paragraph key={`${issue.path}:${issue.line}:${issue.message}`}>
                  {`${issue.path}${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`}
                </s-paragraph>
              ))}
            </s-banner>
          ) : null}
          {editsWarning && (
            <s-banner tone="warning" heading="Files were edited directly in Shopify">
              {preview.checks.directEdits.files.map((f) => (
                <s-paragraph key={f.path}>
                  {`${f.path}${f.updatedAt ? ` was edited on ${new Date(f.updatedAt).toLocaleString()}` : ' was changed in Shopify'}.`}
                </s-paragraph>
              ))}
              <s-checkbox
                label="Replace these files with the repository version"
                checked={acceptEdits}
                onChange={(event) => setAcceptEdits(event.currentTarget.checked)}
              />
            </s-banner>
          )}
          {!codeBlocked && !editsWarning && (
            <s-banner tone="success">
              <s-paragraph>
                {`Checks passed — no problems found (code checked in ${preview.checks.code.filesChecked} file(s)${
                  preview.checks.directEdits.status === 'skipped' ? '' : ', no direct edits in Shopify'
                }).`}
              </s-paragraph>
            </s-banner>
          )}

          <s-text type="strong">
            {`${writes} file(s) affected: ${preview.summary.creates} to create · ${preview.summary.updates} to update · ${preview.summary.deletes} to delete · ${preview.summary.skipped} skipped · ${preview.summary.ignored} ignored`}
          </s-text>
          {preview.conflicts.length > 0 && (
            <s-banner
              tone="warning"
              heading={`${preview.conflicts.length} file(s) overlap with commits that are not selected`}
            >
              {preview.conflicts.slice(0, 20).map((c) => (
                <s-paragraph key={c}>{c}</s-paragraph>
              ))}
              {preview.conflicts.length > 20 && (
                <s-paragraph>{`and ${preview.conflicts.length - 20} more`}</s-paragraph>
              )}
            </s-banner>
          )}

          {preview.warnings
            .filter((w) => !w.startsWith('This is the LIVE theme'))
            .map((warning) => (
              <s-banner key={warning} tone="info">
                <s-paragraph>{warning}</s-paragraph>
              </s-banner>
            ))}

          <s-stack direction="inline" gap="small-200">
            <s-badge tone="success">{`${preview.summary.creates} create`}</s-badge>
            <s-badge tone="caution">{`${preview.summary.updates} update`}</s-badge>
            <s-badge tone="critical">{`${preview.summary.deletes} delete`}</s-badge>
            <s-badge tone="neutral">{`${preview.summary.skipped} skipped`}</s-badge>
          </s-stack>

          <s-paragraph color="subdued">
            Repository <s-text type="strong">{preview.repository}</s-text> at commit{' '}
            <s-text type="strong">{preview.commit.sha}</s-text> · push {STRATEGY_LABEL[preview.strategy]} · preview
            valid until {new Date(preview.expiresAt).toLocaleTimeString()}
          </s-paragraph>

          {writes === 0 && (
            <s-banner tone="info" heading="Nothing to apply">
              <s-paragraph>
                No file in the pushed commits maps to a writable theme file with the current settings.
              </s-paragraph>
            </s-banner>
          )}

          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-text type="strong">{`Files (${operations.length})`}</s-text>
              <s-checkbox
                label="Show skipped files"
                checked={showSkipped}
                onChange={(event) => setShowSkipped(event.currentTarget.checked)}
              />
            </s-stack>

            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="kicker">Action</s-table-header>
                <s-table-header listSlot="primary">Theme file</s-table-header>
                <s-table-header listSlot="secondary">Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {operations.map((op) => {
                  const badge = actionBadge(op);
                  return (
                    <s-table-row key={op.path}>
                      <s-table-cell>
                        <s-badge tone={badge.tone}>{badge.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{op.path}</s-table-cell>
                      <s-table-cell>
                        <s-text color="subdued">
                          {op.skipReason ?? (op.previousPath ? `renamed from ${op.previousPath}` : op.changeType)}
                          {fromCommits(op) ? ` · ${fromCommits(op)}` : ''}
                        </s-text>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-stack>

          {live && (
            <s-stack gap="small-200">
              <s-checkbox
                label="I understand this modifies the live storefront theme"
                checked={ack}
                onChange={(event) => setAck(event.currentTarget.checked)}
              />
              <s-text-field
                label={`Type the theme name "${preview.theme.name}" to confirm`}
                value={typedName}
                autocomplete="off"
                disabled={!ack}
                onInput={(event) => setTypedName(event.currentTarget.value)}
              />
            </s-stack>
          )}
        </s-stack>
      )}

      <s-button
        slot="primary-action"
        variant="primary"
        tone={live || (preview?.summary.deletes ?? 0) > 0 ? 'critical' : 'auto'}
        disabled={!canConfirm}
        loading={submitting}
        onClick={() =>
          onConfirm({
            ...(live ? { confirmLiveTheme: true, confirmThemeName: typedName } : {}),
            ...(editsWarning ? { acceptDirectEdits: acceptEdits } : {}),
          })
        }
      >
        {live ? 'Confirm & Sync live theme' : 'Confirm & Sync'}
      </s-button>
      <s-button slot="secondary-actions" disabled={submitting} onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}
