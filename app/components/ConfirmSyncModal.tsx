import { useEffect, useMemo, useState } from 'react';
import type { SyncPlanOperation, SyncPreview } from '../lib/types';
import { syncTypeLabel, type Tone } from '../lib/format';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Grid,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Modal,
  Paragraph,
  Stack,
  Text,
  TextField,
} from './ui';

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
 * Modal showing the previewed plan. Nothing is written until the user
 * confirms. For the live theme the user must tick a checkbox AND type the
 * theme's exact name; the server enforces the same rule.
 */
export function ConfirmSyncModal({ open, preview, submitting, error, onClose, onConfirm }: Props) {
  const [ack, setAck] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [acceptEdits, setAcceptEdits] = useState(false);

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
    <Modal id={MODAL_ID} open={open} size="large" heading="Review before updating" onHide={onClose}>
      {preview && (
        <Stack gap="base">
          {error && (
            <Banner tone="critical" heading="Sync could not start">
              <Paragraph>{error}</Paragraph>
            </Banner>
          )}
          {live && (
            <Banner tone="warning" heading="This is your live theme">
              <Paragraph>
                Customers will see these changes immediately. Consider syncing to an unpublished copy first.
              </Paragraph>
            </Banner>
          )}
          <Grid gridTemplateColumns="9rem 1fr" gap="small-200">
            <Text color="subdued">Repository</Text>
            <Text>{`${preview.repository} · ${preview.branch ?? '—'}`}</Text>
            <Text color="subdued">Theme</Text>
            <Text>
              <Text type="strong">{preview.theme.name}</Text>
              {` · ID ${preview.theme.numericId}${preview.theme.isLive ? ' · live' : ''}`}
            </Text>
            <Text color="subdued">Sync type</Text>
            <Text>{syncTypeLabel(preview.strategy)}</Text>
            <Text color="subdued">Current</Text>
            <Text>
              {preview.base ? (
                <>
                  <Text type="strong">{preview.base.shortSha}</Text> {firstLine(preview.base.message)}
                </>
              ) : (
                'No last synced commit on this branch'
              )}
            </Text>
            <Text color="subdued">Updating to</Text>
            <Text>
              <Text type="strong">{preview.commit.sha.slice(0, 7)}</Text> {firstLine(preview.commit.message)}
            </Text>
          </Grid>

          <Stack gap="small-300">
            <Text type="strong">{`Updates included (${preview.commitsIncluded.length})`}</Text>
            {preview.commitsIncluded.map((c) => (
              <Text key={c.sha}>
                <Text type="strong">{c.shortSha}</Text> {firstLine(c.message)}
              </Text>
            ))}
          </Stack>

          {codeBlocked ? (
            <Banner tone="critical" heading="Code errors found — ask your developer to fix them">
              {preview.checks.code.issues.map((issue) => (
                <Paragraph key={`${issue.path}:${issue.line}:${issue.message}`}>
                  {`${issue.path}${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`}
                </Paragraph>
              ))}
            </Banner>
          ) : null}
          {editsWarning && (
            <Banner tone="warning" heading="Files were edited directly in Shopify">
              {preview.checks.directEdits.files.map((f) => (
                <Paragraph key={f.path}>
                  {`${f.path}${f.updatedAt ? ` was edited on ${new Date(f.updatedAt).toLocaleString()}` : ' was changed in Shopify'}.`}
                </Paragraph>
              ))}
              <Checkbox
                label="Replace these files with the repository version"
                checked={acceptEdits}
                onChange={(event) => setAcceptEdits(event.currentTarget.checked)}
              />
            </Banner>
          )}
          {!codeBlocked && !editsWarning && (
            <Banner tone="success">
              <Paragraph>
                {`Checks passed — no problems found (code checked in ${preview.checks.code.filesChecked} file(s)${
                  preview.checks.directEdits.status === 'skipped' ? '' : ', no direct edits in Shopify'
                }).`}
              </Paragraph>
            </Banner>
          )}

          <Text type="strong">
            {`${writes} file(s) affected: ${preview.summary.creates} to create · ${preview.summary.updates} to update · ${preview.summary.deletes} to delete · ${preview.summary.skipped} skipped · ${preview.summary.ignored} ignored`}
          </Text>
          {preview.conflicts.length > 0 && (
            <Banner
              tone="warning"
              heading={`${preview.conflicts.length} file(s) overlap with commits that are not selected`}
            >
              {preview.conflicts.slice(0, 20).map((c) => (
                <Paragraph key={c}>{c}</Paragraph>
              ))}
              {preview.conflicts.length > 20 && <Paragraph>{`and ${preview.conflicts.length - 20} more`}</Paragraph>}
            </Banner>
          )}

          {preview.warnings
            .filter((w) => !w.startsWith('This is the LIVE theme'))
            .map((warning) => (
              <Banner key={warning} tone="info">
                <Paragraph>{warning}</Paragraph>
              </Banner>
            ))}

          <Stack direction="inline" gap="small-200">
            <Badge tone="success">{`${preview.summary.creates} create`}</Badge>
            <Badge tone="caution">{`${preview.summary.updates} update`}</Badge>
            <Badge tone="critical">{`${preview.summary.deletes} delete`}</Badge>
            <Badge tone="neutral">{`${preview.summary.skipped} skipped`}</Badge>
          </Stack>

          <Paragraph color="subdued">
            Repository <Text type="strong">{preview.repository}</Text> at commit{' '}
            <Text type="strong">{preview.commit.sha}</Text> · push {STRATEGY_LABEL[preview.strategy]} · preview valid
            until {new Date(preview.expiresAt).toLocaleTimeString()}
          </Paragraph>

          {writes === 0 && (
            <Banner tone="info" heading="Nothing to apply">
              <Paragraph>
                No file in the pushed commits maps to a writable theme file with the current settings.
              </Paragraph>
            </Banner>
          )}

          <Stack gap="small-200">
            <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <Text type="strong">{`Files (${operations.length})`}</Text>
              <Checkbox
                label="Show skipped files"
                checked={showSkipped}
                onChange={(event) => setShowSkipped(event.currentTarget.checked)}
              />
            </Stack>

            <IndexTable
              variant="auto"
              columns={[
                { title: 'Action', listSlot: 'kicker' },
                { title: 'Theme file', listSlot: 'primary' },
                { title: 'Details', listSlot: 'secondary' },
              ]}
              rows={operations.map((op) => {
                const badge = actionBadge(op);
                return (
                  <IndexTableRow key={op.path}>
                    <IndexTableCell>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </IndexTableCell>
                    <IndexTableCell>{op.path}</IndexTableCell>
                    <IndexTableCell>
                      <Text color="subdued">
                        {op.skipReason ?? (op.previousPath ? `renamed from ${op.previousPath}` : op.changeType)}
                        {fromCommits(op) ? ` · ${fromCommits(op)}` : ''}
                      </Text>
                    </IndexTableCell>
                  </IndexTableRow>
                );
              })}
            />
          </Stack>

          {live && (
            <Stack gap="small-200">
              <Checkbox
                label="I understand this modifies the live storefront theme"
                checked={ack}
                onChange={(event) => setAck(event.currentTarget.checked)}
              />
              <TextField
                label={`Type the theme name "${preview.theme.name}" to confirm`}
                value={typedName}
                autocomplete="off"
                disabled={!ack}
                onInput={(event) => setTypedName(event.currentTarget.value)}
              />
            </Stack>
          )}
        </Stack>
      )}

      <Button
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
      </Button>
      <Button slot="secondary-actions" disabled={submitting} onClick={onClose}>
        Cancel
      </Button>
    </Modal>
  );
}
