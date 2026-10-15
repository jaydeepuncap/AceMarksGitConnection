import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LastSyncCard } from '../components/LastSyncCard';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { SyncPreview, ThemeMapping as Mapping } from '../lib/types';

const NONE = '__none__';

function ConfirmModal({
  open,
  heading,
  message,
  actionLabel,
  pending,
  onClose,
  onConfirm,
}: {
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
    <s-modal ref={ref} id="mapping-confirm-modal" heading={heading} onHide={onClose}>
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

/**
 * Theme mapping: connect a repository branch to exactly one Shopify theme
 * (and a theme to exactly one branch), then run the first full sync.
 */
export default function ThemeMapping() {
  const navigate = useNavigate();
  const go = useNavigateHandler();
  const [params] = useSearchParams();
  const settings = useApiQuery(() => api.settings.get(), []);
  const github = useApiQuery(() => api.github.connection(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);

  const repository = settings.data?.settings.defaultRepository ?? '';
  const connected = !!github.data?.connected;
  const branches = useApiQuery(
    () => api.github.branches({ repository, perPage: 100 }),
    [repository, connected],
    !!repository && connected,
  );

  const [branch, setBranch] = useState(params.get('branch') ?? '');
  const [themeId, setThemeId] = useState(params.get('themeId') ?? '');
  const [changing, setChanging] = useState(false);
  const [confirm, setConfirm] = useState<'remove' | 'change' | null>(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const create = useMutation(api.mappings.create);
  const update = useMutation(
    (id: string, body: { branch?: string; themeId?: string; confirm: true }) => api.mappings.update(id, body),
  );
  const remove = useMutation(api.mappings.remove);
  const fullPreview = useMutation(api.sync.preview);
  const confirmSync = useMutation(api.sync.confirm);

  // Default to the repository's default branch.
  useEffect(() => {
    if (!branch && settings.data?.settings.defaultBranch) setBranch(settings.data.settings.defaultBranch);
  }, [branch, settings.data]);

  if ((settings.loading && !settings.data) || (mappings.loading && !mappings.data)) {
    return <LoadingState title="Theme mapping" />;
  }

  const items = mappings.data?.items ?? [];
  const sameRepo = (m: Mapping) => m.repository.toLowerCase() === repository.toLowerCase();
  const current = items.find((m) => sameRepo(m) && m.branch === branch) ?? null;
  const branchItems = branches.data?.items ?? [];
  const head = branchItems.find((b) => b.name === branch);
  const allThemes = themes.data ?? [];
  const mappedTheme = current ? allThemes.find((t) => t.id === current.themeId) : undefined;
  /** Which branch a theme is assigned to (other than the selected branch). */
  const assignedElsewhere = (id: string) => items.find((m) => m.themeId === id && !(sameRepo(m) && m.branch === branch));

  const refresh = () => {
    mappings.reload();
    setRefreshKey((k) => k + 1);
  };

  const doCreate = async () => {
    if (!branch || !themeId) return;
    const created = await create.run({ branch, themeId });
    if (created) {
      showToast(`${created.branch} mapped to ${created.themeName}`);
      setThemeId('');
      refresh();
    }
  };

  const doChange = async () => {
    if (!current || !themeId) return;
    const changed = await update.run(current.id, { themeId, confirm: true });
    if (changed) {
      showToast(`${changed.branch} now mapped to ${changed.themeName}`);
      setConfirm(null);
      setChanging(false);
      setThemeId('');
      refresh();
    }
  };

  const doRemove = async () => {
    if (!current) return;
    const removed = await remove.run(current.id);
    if (removed) {
      showToast(`Mapping removed`);
      setConfirm(null);
      refresh();
    }
  };

  const runFullSync = async () => {
    if (!current || !head) return;
    confirmSync.clearError();
    const result = await fullPreview.run({
      repository,
      branch: current.branch,
      commitSha: head.commitSha,
      themeId: current.themeId,
      strategy: 'full_snapshot',
      allowDeletes,
    });
    if (result) setPreview(result);
  };

  const startSync = async (confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string; acceptDirectEdits?: boolean }) => {
    if (!preview) return;
    const run = await confirmSync.run({ syncId: preview.syncId, confirm: true, ...confirmation });
    if (run) {
      setPreview(null);
      showToast('Full sync started');
      navigate(`/sync-history?id=${run.id}`);
    }
  };

  const themeSelect = (label: string) => (
    <s-select
      label={label}
      value={themeId || NONE}
      disabled={themes.loading}
      onChange={(event) => setThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
    >
      <s-option value={NONE}>Select a theme</s-option>
      {allThemes.map((t) => {
        const other = assignedElsewhere(t.id);
        const reason = !t.writable ? ' — cannot be synced' : other ? ` — mapped to ${other.branch}` : '';
        return (
          <s-option key={t.id} value={t.id} disabled={!t.writable || !!other || t.id === current?.themeId}>
            {`${t.name}${t.isLive ? ' (live)' : ''}${reason}`}
          </s-option>
        );
      })}
    </s-select>
  );

  if (!repository || !connected) {
    return (
      <AppLayout title="Theme mapping">
        <s-section heading="Connect a repository first">
          <s-paragraph>Connect GitHub and choose a repository in Settings, then map its branches to themes here.</s-paragraph>
          <s-button slot="secondary-actions" variant="primary" onClick={go('/settings')}>
            Open settings
          </s-button>
        </s-section>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Theme mapping"
      subtitle={`${repository} · each branch syncs to one theme, each theme receives one branch`}
      secondaryActions={[{ content: 'Refresh', onAction: () => (refresh(), themes.reload(), branches.reload()) }]}
      banners={
        <>
          <ErrorBanner error={settings.error ?? mappings.error} onRetry={() => (settings.reload(), mappings.reload())} />
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          <ErrorBanner error={branches.error} heading="Branches could not be loaded" onRetry={branches.reload} />
          <ErrorBanner error={create.error ?? update.error ?? remove.error} heading="Mapping not saved" onDismiss={() => (create.clearError(), update.clearError(), remove.clearError())} />
          <ErrorBanner error={fullPreview.error} heading="Full sync could not be prepared" onDismiss={fullPreview.clearError} />
        </>
      }
    >
      <s-section heading="Branch and theme">
        <s-stack gap="base">
          <s-select
            label="Branch"
            value={branch || NONE}
            disabled={branches.loading}
            onChange={(event) => {
              setBranch(event.currentTarget.value === NONE ? '' : event.currentTarget.value);
              setThemeId('');
              setChanging(false);
            }}
          >
            <s-option value={NONE}>Select a branch</s-option>
            {branchItems.map((b) => {
              const mapped = items.find((m) => sameRepo(m) && m.branch === b.name);
              return (
                <s-option key={b.name} value={b.name}>
                  {`${b.name}${mapped ? ` → ${mapped.themeName}` : ''}`}
                </s-option>
              );
            })}
          </s-select>

          {branch && current && !changing && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone="success">Mapped</s-badge>
                  <s-text>
                    Branch <s-text type="strong">{current.branch}</s-text> → theme{' '}
                    <s-text type="strong">{current.themeName}</s-text>
                  </s-text>
                  {mappedTheme && <s-badge tone={THEME_ROLE_BADGE[mappedTheme.role].tone}>{THEME_ROLE_BADGE[mappedTheme.role].label}</s-badge>}
                  {themes.data && !mappedTheme && <s-badge tone="critical">Theme no longer exists</s-badge>}
                </s-stack>
                <s-text color="subdued">{`Theme ID ${current.themeId.split('/').pop()} · mapped ${formatDate(current.createdAt)}`}</s-text>
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="primary" onClick={go(`/commits?branch=${encodeURIComponent(current.branch)}`)}>
                    Sync commits
                  </s-button>
                  <s-button onClick={() => setChanging(true)}>Change theme</s-button>
                  <s-button tone="critical" variant="tertiary" onClick={() => setConfirm('remove')}>
                    Remove mapping
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          )}

          {branch && (!current || changing) && (
            <s-stack gap="small-200">
              {themeSelect(changing ? 'New theme for this branch' : 'Shopify theme')}
              <s-text color="subdued">
                Themes already mapped to another branch cannot be selected. Remove or change that mapping first.
              </s-text>
              <s-stack direction="inline" gap="small-200">
                {changing ? (
                  <>
                    <s-button variant="primary" disabled={!themeId} onClick={() => setConfirm('change')}>
                      Change mapping
                    </s-button>
                    <s-button onClick={() => (setChanging(false), setThemeId(''))}>Cancel</s-button>
                  </>
                ) : (
                  <s-button variant="primary" disabled={!themeId} loading={create.pending} onClick={doCreate}>
                    Map branch to theme
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {current && !changing && (
        <s-section heading="Full sync">
          <s-stack gap="base">
            <s-paragraph>
              {`Makes ${current.themeName} match the newest commit on ${current.branch}${head ? ` (${head.commitSha.slice(0, 7)})` : ''}: every theme file in the repository is compared with the theme, and you review the files to create, update and skip before anything changes. Ignored files are never touched.`}
            </s-paragraph>
            <s-checkbox
              label="Delete theme files that are not in the repository"
              details="Off by default. When on, the review lists every file that would be deleted; protected and ignored files are never deleted."
              checked={allowDeletes}
              onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
            />
            <s-stack direction="inline">
              <s-button variant="primary" disabled={!head} loading={fullPreview.pending} onClick={runFullSync}>
                Preview full sync
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {current && !changing && (
        <s-section heading="Last sync">
          <LastSyncCard themeId={current.themeId} branch={current.branch} refreshKey={refreshKey} />
        </s-section>
      )}

      <s-section padding="none" accessibilityLabel="Assignments">
        <s-box padding="base">
          <s-heading>Assignments</s-heading>
        </s-box>
        {items.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">No branch is mapped to a theme yet.</s-paragraph>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Branch</s-table-header>
              <s-table-header listSlot="secondary">Shopify theme</s-table-header>
              <s-table-header listSlot="labeled">Mapped</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">{m.branch}</s-text>
                      <s-text color="subdued">{m.repository}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>{m.themeName}</s-text>
                      <s-text color="subdued">{`ID ${m.themeId.split('/').pop()}`}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{formatDate(m.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      disabled={!sameRepo(m)}
                      onClick={() => (setBranch(m.branch), setChanging(false), setThemeId(''))}
                    >
                      Select
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <ConfirmModal
        open={confirm !== null}
        heading={confirm === 'remove' ? 'Remove this mapping?' : 'Change the theme for this branch?'}
        message={
          confirm === 'remove'
            ? `${current?.branch ?? ''} will no longer sync to ${current?.themeName ?? ''}. Nothing in the theme changes, and the sync history is kept.`
            : `${current?.branch ?? ''} will sync to ${allThemes.find((t) => t.id === themeId)?.name ?? 'the selected theme'} instead of ${current?.themeName ?? ''}. Nothing in either theme changes now; the old mapping stays in the audit trail.`
        }
        actionLabel={confirm === 'remove' ? 'Remove mapping' : 'Change mapping'}
        pending={remove.pending || update.pending}
        onClose={() => setConfirm(null)}
        onConfirm={confirm === 'remove' ? doRemove : doChange}
      />
      <ConfirmSyncModal
        open={preview !== null}
        preview={preview}
        submitting={confirmSync.pending}
        error={confirmSync.error?.message ?? null}
        onClose={() => setPreview(null)}
        onConfirm={startSync}
      />
    </AppLayout>
  );
}
