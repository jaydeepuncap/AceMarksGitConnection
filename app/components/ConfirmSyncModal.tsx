import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyncPlanOperation, SyncPreview } from '../lib/types';
import type { Tone } from '../lib/format';

interface Props {
  open: boolean;
  preview: SyncPreview | null;
  submitting: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string }) => void;
}

function actionBadge(op: SyncPlanOperation): { label: string; tone: Tone } {
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

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (open) modal.showOverlay();
    else modal.hideOverlay();
  }, [open, preview]);

  useEffect(() => {
    if (!open) {
      setAck(false);
      setTypedName('');
    }
  }, [open]);

  const operations = useMemo(
    () => (preview?.operations ?? []).filter((op) => showSkipped || op.action !== 'skip'),
    [preview, showSkipped],
  );

  const live = preview?.requiresLiveConfirmation ?? false;
  const writes = preview ? preview.summary.creates + preview.summary.updates + preview.summary.deletes : 0;
  const liveConfirmed = !live || (ack && typedName === preview?.theme.name);
  const canConfirm = !!preview && writes > 0 && liveConfirmed && !submitting;

  return (
    <s-modal
      id={MODAL_ID}
      ref={modalRef}
      size="large"
      heading={preview ? `Sync ${preview.commit.sha.slice(0, 7)} → ${preview.theme.name}` : 'Sync preview'}
      onHide={onClose}
    >
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
            <s-text type="strong">{preview.commit.sha}</s-text> · strategy{' '}
            {preview.strategy === 'full_snapshot' ? 'full snapshot' : 'commit changes'} · preview valid until{' '}
            {new Date(preview.expiresAt).toLocaleTimeString()}
          </s-paragraph>

          {writes === 0 && (
            <s-banner tone="info" heading="Nothing to apply">
              <s-paragraph>No file in this commit maps to a writable theme file with the current settings.</s-paragraph>
            </s-banner>
          )}

          <s-checkbox
            label="Show skipped files"
            checked={showSkipped}
            onChange={(event) => setShowSkipped(event.currentTarget.checked)}
          />

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
                      </s-text>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>

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
        onClick={() => onConfirm(live ? { confirmLiveTheme: true, confirmThemeName: typedName } : {})}
      >
        {live ? 'Sync to live theme' : `Apply ${writes} change${writes === 1 ? '' : 's'}`}
      </s-button>
      <s-button slot="secondary-actions" disabled={submitting} onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}
