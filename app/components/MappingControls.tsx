import { useState } from 'react';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { useMutation } from '../lib/hooks';
import type { ShopifyTheme, SyncPreview, ThemeMapping } from '../lib/types';
import { ErrorBanner } from './ErrorBanner';
import { Box, Button, Modal, Option, Paragraph, Select, Stack } from './ui';
import { ConfirmModal } from './Common/ConfirmModal';

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
      <s-paragraph>{`Makes ${mapping.themeName} match the newest commit on ${mapping.branch}.`}</s-paragraph>
      <s-unordered-list>
        <s-list-item>Use it for the first sync, or to start over. Afterwards, sync only new commits.</s-list-item>
        <s-list-item>
          Every theme file in the repository is compared with the theme; you review the changes first.
        </s-list-item>
        <s-list-item>Ignored files are never touched; files identical in the theme are not rewritten.</s-list-item>
      </s-unordered-list>
      <s-checkbox
        label="Delete theme files that are not in the repository"
        details="Off by default. The review lists every file that would be deleted; protected and ignored files never are."
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

/**
 * Dialogs for the mapping page's top actions: "Change theme" (pick a free
 * theme, then confirm) and "Remove mapping" (confirm). Nothing in any theme
 * changes; the sync history is kept.
 */
export function MappingActionDialogs({
  mapping,
  themeOptions,
  action,
  onClose,
  onChanged,
  onRemoved,
}: {
  mapping: ThemeMapping;
  themeOptions: { theme: ShopifyTheme; disabledReason: string | null }[];
  action: 'change' | 'remove' | null;
  onClose: () => void;
  onChanged: (mapping: ThemeMapping) => void;
  onRemoved: () => void;
}) {
  const [newThemeId, setNewThemeId] = useState('');
  const update = useMutation((themeId: string) => api.mappings.update(mapping.id, { themeId, confirm: true }));
  const remove = useMutation(() => api.mappings.remove(mapping.id));
  const newTheme = themeOptions.find((o) => o.theme.id === newThemeId)?.theme;
  const free = themeOptions.filter((o) => !o.disabledReason).length;

  const close = () => {
    setNewThemeId('');
    update.clearError();
    remove.clearError();
    onClose();
  };
  const doChange = async () => {
    const changed = await update.run(newThemeId);
    if (changed) {
      showToast(`${changed.branch} now syncs to ${changed.themeName}`);
      setNewThemeId('');
      onChanged(changed);
    }
  };
  const doRemove = async () => {
    const removed = await remove.run();
    if (removed) {
      showToast(`${removed.branch} is no longer mapped`);
      onRemoved();
    }
  };

  return (
    <>
      <Modal
        id={`change-theme-${mapping.id}`}
        open={action === 'change'}
        heading={`Sync ${mapping.branch} to another theme`}
        size="small"
        onHide={close}
      >
        <Box padding="base">
          <Stack gap="base">
            <Paragraph>
              {`${mapping.branch} will sync to the new theme instead of ${mapping.themeName}. Nothing in either theme changes now, and ${mapping.themeName} keeps its sync history.`}
            </Paragraph>
            <Select
              label="New theme"
              value={newThemeId || NONE}
              details={
                free === 0 ? 'Every other theme is already mapped or cannot be synced.' : `${free} theme(s) available`
              }
              onChange={(event: Event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                setNewThemeId(value === NONE ? '' : value);
              }}
            >
              <Option value={NONE}>Select a theme</Option>
              {themeOptions.map(({ theme: t, disabledReason }) => (
                <Option key={t.id} value={t.id} disabled={!!disabledReason}>
                  {`${themeLabel(t)}${disabledReason ? ` — ${disabledReason}` : ''}`}
                </Option>
              ))}
            </Select>
            <ErrorBanner error={update.error} heading="Theme not changed" onDismiss={update.clearError} />
          </Stack>
        </Box>
        <Stack direction="inline" gap="small" justifyContent="end" padding="base">
          <Button onClick={close} disabled={update.pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!newThemeId} loading={update.pending} onClick={doChange}>
            {newTheme ? `Sync to ${newTheme.name}` : 'Change theme'}
          </Button>
        </Stack>
      </Modal>
      <ConfirmModal
        open={action === 'remove'}
        heading={`Remove ${mapping.branch} → ${mapping.themeName}?`}
        message={
          remove.error
            ? `${remove.error.message}`
            : `${mapping.branch} will no longer sync to ${mapping.themeName}. Nothing in the theme changes. Its sync history and last synced commit are kept, so mapping it again later continues where it left off.`
        }
        confirmLabel="Remove mapping"
        destructive
        loading={remove.pending}
        onClose={close}
        onConfirm={doRemove}
      />
    </>
  );
}
