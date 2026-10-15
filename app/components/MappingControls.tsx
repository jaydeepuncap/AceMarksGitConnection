import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { useMutation } from '../lib/hooks';
import type { ShopifyTheme, SyncPreview, ThemeMapping } from '../lib/types';
import { ErrorBanner } from './ErrorBanner';

const NONE = '__none__';

export const themeLabel = (t: ShopifyTheme) => `${t.name}${t.isLive ? ' (live)' : ''}`;

/** Themes a mapping may move to: every other theme, disabled when it cannot be used. */
export function themeOptionsFor(mapping: ThemeMapping | null, themes: ShopifyTheme[], mappings: ThemeMapping[]) {
  return themes
    .filter((t) => t.id !== mapping?.themeId)
    .map((t) => {
      const other = mappings.find((m) => m.themeId === t.id && m.id !== mapping?.id);
      const disabledReason = !t.writable ? 'cannot be synced' : other ? `mapped to ${other.branch}` : null;
      return { theme: t, disabledReason };
    });
}

export function ConfirmModal({
  id,
  open,
  heading,
  message,
  actionLabel,
  pending,
  onClose,
  onConfirm,
}: {
  id: string;
  open: boolean;
  heading: string;
  message: string;
  actionLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    if (open) ref.current?.showOverlay?.();
    else ref.current?.hideOverlay?.();
  }, [open]);
  return (
    <s-modal ref={ref} id={id} heading={heading} onHide={onClose}>
      <s-paragraph>{message}</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" loading={pending} onClick={onConfirm}>
        {actionLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}

/** Full sync of a mapping: the branch's newest commit, read directly from GitHub. */
export function FullSyncControls({
  mapping,
  disabled,
  onPreview,
}: {
  mapping: ThemeMapping;
  disabled?: boolean;
  onPreview: (preview: SyncPreview) => void;
}) {
  const [allowDeletes, setAllowDeletes] = useState(false);
  const preview = useMutation(async () => {
    const head = await api.github.branch(mapping.branch, mapping.repository);
    return api.sync.preview({
      repository: mapping.repository,
      branch: mapping.branch,
      commitSha: head.commitSha,
      themeId: mapping.themeId,
      strategy: 'full_snapshot',
      allowDeletes,
    });
  });
  const run = async () => {
    const result = await preview.run();
    if (result) onPreview(result);
  };
  return (
    <s-stack gap="base">
      <s-paragraph>
        {`Makes ${mapping.themeName} match the newest commit on ${mapping.branch}. Every theme file in the repository is compared with the theme, and you review what is created, updated and skipped before anything changes. Use it for the first sync or to start over; afterwards, syncing commits brings in only what is new. Ignored files are never touched.`}
      </s-paragraph>
      <s-checkbox
        label="Delete theme files that are not in the repository"
        details="Off by default. When on, the review lists every file that would be deleted; protected and ignored files are never deleted."
        checked={allowDeletes}
        onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
      />
      <ErrorBanner error={preview.error} heading="Full sync could not be prepared" onDismiss={preview.clearError} />
      <s-stack direction="inline">
        <s-button variant="secondary" disabled={disabled} loading={preview.pending} onClick={run}>
          Review full sync
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/** Change the theme of a mapping, or remove it (both confirmed). */
export function ManageMappingControls({
  mapping,
  themeOptions,
  onChanged,
  onRemoved,
}: {
  mapping: ThemeMapping;
  themeOptions: { theme: ShopifyTheme; disabledReason: string | null }[];
  onChanged: (mapping: ThemeMapping) => void;
  onRemoved: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [confirm, setConfirm] = useState<'remove' | 'change' | null>(null);
  const [newThemeId, setNewThemeId] = useState('');
  const update = useMutation((themeId: string) => api.mappings.update(mapping.id, { themeId, confirm: true }));
  const remove = useMutation(() => api.mappings.remove(mapping.id));
  const newTheme = themeOptions.find((o) => o.theme.id === newThemeId)?.theme;

  const doChange = async () => {
    const changed = await update.run(newThemeId);
    if (changed) {
      showToast(`${changed.branch} now syncs to ${changed.themeName}`);
      setConfirm(null);
      setChanging(false);
      setNewThemeId('');
      onChanged(changed);
    }
  };
  const doRemove = async () => {
    const removed = await remove.run();
    if (removed) {
      showToast(`${removed.branch} is no longer mapped`);
      setConfirm(null);
      onRemoved();
    }
  };

  return (
    <s-stack gap="small-200">
      <ErrorBanner error={update.error ?? remove.error} heading="Mapping not changed" onDismiss={() => (update.clearError(), remove.clearError())} />
      {changing ? (
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto auto" gap="small-200" alignItems="end">
          <s-select
            label={`New theme for ${mapping.branch}`}
            value={newThemeId || NONE}
            onChange={(event) => setNewThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
          >
            <s-option value={NONE}>Select a theme</s-option>
            {themeOptions.map(({ theme: t, disabledReason }) => (
              <s-option key={t.id} value={t.id} disabled={!!disabledReason}>
                {`${themeLabel(t)}${disabledReason ? ` — ${disabledReason}` : ''}`}
              </s-option>
            ))}
          </s-select>
          <s-button variant="primary" disabled={!newThemeId} onClick={() => setConfirm('change')}>
            Change theme
          </s-button>
          <s-button variant="tertiary" onClick={() => (setChanging(false), setNewThemeId(''))}>
            Cancel
          </s-button>
        </s-grid>
      ) : (
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={() => setChanging(true)}>Change theme</s-button>
          <s-button variant="tertiary" tone="critical" onClick={() => setConfirm('remove')}>
            Remove mapping
          </s-button>
        </s-stack>
      )}
      <ConfirmModal
        id={`mapping-confirm-${mapping.id}`}
        open={confirm !== null}
        heading={confirm === 'remove' ? `Remove ${mapping.branch} → ${mapping.themeName}?` : `Sync ${mapping.branch} to another theme?`}
        message={
          confirm === 'remove'
            ? `${mapping.branch} will no longer sync to ${mapping.themeName}. Nothing in the theme changes. Its sync history and last synced commit are kept, so mapping it again later continues where it left off.`
            : `${mapping.branch} will sync to ${newTheme?.name ?? 'the selected theme'} instead of ${mapping.themeName}. Nothing in either theme changes now; ${mapping.themeName} keeps its sync history.`
        }
        actionLabel={confirm === 'remove' ? 'Remove mapping' : 'Change theme'}
        pending={remove.pending || update.pending}
        onClose={() => setConfirm(null)}
        onConfirm={confirm === 'remove' ? doRemove : doChange}
      />
    </s-stack>
  );
}
