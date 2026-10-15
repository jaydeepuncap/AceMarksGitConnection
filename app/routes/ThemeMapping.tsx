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
import type { GithubBranch, ShopifyTheme, SyncPreview, ThemeMapping as Mapping } from '../lib/types';

const NONE = '__none__';

function ConfirmModal({
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

const themeLabel = (t: ShopifyTheme) => `${t.name}${t.isLive ? ' (live)' : ''}`;

/** One branch → theme mapping with its own actions. */
function MappingCard({
  mapping,
  theme,
  themesLoaded,
  themeOptions,
  refreshKey,
  onChanged,
  onPreview,
}: {
  mapping: Mapping;
  theme: ShopifyTheme | undefined;
  themesLoaded: boolean;
  /** Themes this mapping may switch to (not mapped elsewhere). */
  themeOptions: { theme: ShopifyTheme; disabledReason: string | null }[];
  refreshKey: number;
  onChanged: () => void;
  onPreview: (preview: SyncPreview) => void;
}) {
  const go = useNavigateHandler();
  const [panel, setPanel] = useState<'none' | 'full' | 'change'>('none');
  const [confirm, setConfirm] = useState<'remove' | 'change' | null>(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [newThemeId, setNewThemeId] = useState('');
  const update = useMutation((body: { themeId: string }) => api.mappings.update(mapping.id, { ...body, confirm: true }));
  const remove = useMutation(() => api.mappings.remove(mapping.id));
  // The branch's newest commit is read directly (never depends on the branch list).
  const fullPreview = useMutation(async () => {
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

  const role = theme ? THEME_ROLE_BADGE[theme.role] : null;
  const newTheme = themeOptions.find((o) => o.theme.id === newThemeId)?.theme;

  const doChange = async () => {
    const changed = await update.run({ themeId: newThemeId });
    if (changed) {
      showToast(`${changed.branch} now syncs to ${changed.themeName}`);
      setConfirm(null);
      setPanel('none');
      setNewThemeId('');
      onChanged();
    }
  };
  const doRemove = async () => {
    const removed = await remove.run();
    if (removed) {
      showToast(`${removed.branch} is no longer mapped`);
      setConfirm(null);
      onChanged();
    }
  };
  const previewFull = async () => {
    const result = await fullPreview.run();
    if (result) onPreview(result);
  };

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="git-branch" />
            <s-text type="strong">{mapping.branch}</s-text>
            <s-icon type="arrow-right" />
            <s-text type="strong">{mapping.themeName}</s-text>
            {role && <s-badge tone={role.tone}>{role.label}</s-badge>}
            {themesLoaded && !theme && <s-badge tone="critical">Theme no longer exists</s-badge>}
          </s-stack>
          <s-text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()} · mapped ${formatDate(mapping.createdAt)}`}</s-text>
        </s-stack>

        <LastSyncCard themeId={mapping.themeId} branch={mapping.branch} refreshKey={refreshKey} compact />

        <ErrorBanner
          error={update.error ?? remove.error ?? fullPreview.error}
          heading={fullPreview.error ? 'Full sync could not be prepared' : 'Mapping not changed'}
          onDismiss={() => (update.clearError(), remove.clearError(), fullPreview.clearError())}
        />

        <s-stack direction="inline" gap="small-200">
          <s-button
            variant="primary"
            disabled={!theme}
            onClick={go(`/commits?branch=${encodeURIComponent(mapping.branch)}`)}
          >
            Sync commits
          </s-button>
          <s-button disabled={!theme} onClick={() => setPanel(panel === 'full' ? 'none' : 'full')}>
            Full sync
          </s-button>
          <s-button onClick={() => setPanel(panel === 'change' ? 'none' : 'change')}>Change theme</s-button>
          <s-button variant="tertiary" tone="critical" onClick={() => setConfirm('remove')}>
            Remove mapping
          </s-button>
        </s-stack>

        {panel === 'full' && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-paragraph>
                {`Makes ${mapping.themeName} match the newest commit on ${mapping.branch}. Every theme file in the repository is compared with the theme and you review what is created, updated and skipped before anything changes. Use it for the first sync, or to start over; afterwards "Sync commits" brings in only new commits. Ignored files are never touched.`}
              </s-paragraph>
              <s-checkbox
                label="Delete theme files that are not in the repository"
                details="Off by default. When on, the review lists every file that would be deleted; protected and ignored files are never deleted."
                checked={allowDeletes}
                onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
              />
              <s-stack direction="inline" gap="small-200">
                <s-button variant="primary" loading={fullPreview.pending} onClick={previewFull}>
                  Preview full sync
                </s-button>
                <s-button variant="tertiary" onClick={() => setPanel('none')}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        )}

        {panel === 'change' && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
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
              <s-stack direction="inline" gap="small-200">
                <s-button variant="primary" disabled={!newThemeId} onClick={() => setConfirm('change')}>
                  Change theme
                </s-button>
                <s-button variant="tertiary" onClick={() => (setPanel('none'), setNewThemeId(''))}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        )}
      </s-stack>

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
    </s-box>
  );
}

/**
 * Theme mapping: connect each repository branch to its own Shopify theme, for
 * example main → Live theme and staging → Staging copy. A branch syncs to one
 * theme only and a theme receives one branch only.
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

  const [newBranch, setNewBranch] = useState(params.get('branch') ?? '');
  const [newThemeId, setNewThemeId] = useState(params.get('themeId') ?? '');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const create = useMutation(api.mappings.create);
  const confirmSync = useMutation(api.sync.confirm);

  if ((settings.loading && !settings.data) || (mappings.loading && !mappings.data)) {
    return <LoadingState title="Theme mapping" />;
  }

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

  const items = mappings.data?.items ?? [];
  const sameRepo = (m: Mapping) => m.repository.toLowerCase() === repository.toLowerCase();
  const repoItems = items.filter(sameRepo);
  const otherRepoItems = items.filter((m) => !sameRepo(m));
  const allThemes = themes.data ?? [];
  const branchList: GithubBranch[] = branches.data?.items ?? [];
  const mappingForBranch = (name: string) => repoItems.find((m) => m.branch === name);
  const mappingForTheme = (id: string) => items.find((m) => m.themeId === id);

  /** Why a theme cannot be chosen (for `exceptMappingId`'s own theme it can). */
  const themeBlocked = (t: ShopifyTheme, exceptMappingId?: string): string | null => {
    if (!t.writable) return 'cannot be synced';
    const m = mappingForTheme(t.id);
    if (m && m.id !== exceptMappingId) return `mapped to ${m.branch}`;
    return null;
  };
  const freeBranches = branchList.filter((b) => !mappingForBranch(b.name));
  const freeThemes = allThemes.filter((t) => !themeBlocked(t));

  const refresh = () => {
    mappings.reload();
    setRefreshKey((k) => k + 1);
  };

  const doCreate = async () => {
    if (!newBranch || !newThemeId) return;
    const created = await create.run({ branch: newBranch, themeId: newThemeId });
    if (created) {
      showToast(`${created.branch} → ${created.themeName} added`);
      setNewBranch('');
      setNewThemeId('');
      refresh();
    }
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

  return (
    <AppLayout
      title="Theme mapping"
      subtitle={repository}
      secondaryActions={[{ content: 'Refresh', onAction: () => (refresh(), themes.reload(), branches.reload()) }]}
      banners={
        <>
          <ErrorBanner error={settings.error ?? mappings.error} onRetry={() => (settings.reload(), mappings.reload())} />
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          <ErrorBanner error={branches.error} heading="Branches could not be loaded" onRetry={branches.reload} />
        </>
      }
    >
      <s-section heading="Add a mapping">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Connect each branch to its own theme — for example <s-text type="strong">main → Live theme</s-text> and{' '}
            <s-text type="strong">staging → Staging copy</s-text>. A branch syncs to one theme only, and a theme
            receives one branch only.
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base" alignItems="end">
            <s-select
              label="Branch"
              value={newBranch || NONE}
              details={branches.loading ? 'Loading branches…' : `${freeBranches.length} of ${branchList.length} branches not mapped yet`}
              onChange={(event) => setNewBranch(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
            >
              <s-option value={NONE}>Select a branch</s-option>
              {branchList.map((b) => {
                const m = mappingForBranch(b.name);
                return (
                  <s-option key={b.name} value={b.name} disabled={!!m}>
                    {`${b.name}${m ? ` — mapped to ${m.themeName}` : ''}`}
                  </s-option>
                );
              })}
              {newBranch && !branchList.some((b) => b.name === newBranch) && <s-option value={newBranch}>{newBranch}</s-option>}
            </s-select>
            <s-select
              label="Shopify theme"
              value={newThemeId || NONE}
              details={themes.loading ? 'Loading themes…' : `${freeThemes.length} of ${allThemes.length} themes available`}
              onChange={(event) => setNewThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
            >
              <s-option value={NONE}>Select a theme</s-option>
              {allThemes.map((t) => {
                const reason = themeBlocked(t);
                return (
                  <s-option key={t.id} value={t.id} disabled={!!reason}>
                    {`${themeLabel(t)}${reason ? ` — ${reason}` : ''}`}
                  </s-option>
                );
              })}
            </s-select>
            <s-button variant="primary" disabled={!newBranch || !newThemeId} loading={create.pending} onClick={doCreate}>
              Add mapping
            </s-button>
          </s-grid>
          <ErrorBanner error={create.error} heading="Mapping not added" onDismiss={create.clearError} />
        </s-stack>
      </s-section>

      <s-section heading={`Mappings (${repoItems.length})`}>
        {repoItems.length === 0 ? (
          <s-paragraph color="subdued">
            No branch is mapped yet. Add a mapping above, then run a full sync to bring the theme in line with its branch.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            {repoItems.map((m) => (
              <MappingCard
                key={m.id}
                mapping={m}
                theme={allThemes.find((t) => t.id === m.themeId)}
                themesLoaded={!!themes.data}
                themeOptions={allThemes
                  .filter((t) => t.id !== m.themeId)
                  .map((t) => ({ theme: t, disabledReason: themeBlocked(t, m.id) }))}
                refreshKey={refreshKey}
                onChanged={refresh}
                onPreview={setPreview}
              />
            ))}
          </s-stack>
        )}
      </s-section>

      {otherRepoItems.length > 0 && (
        <s-section heading="Mappings of other repositories">
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              These themes are mapped to branches of another repository and cannot be used here until that mapping is
              removed (select that repository in Settings to manage them).
            </s-paragraph>
            {otherRepoItems.map((m) => (
              <s-text key={m.id}>{`${m.repository} · ${m.branch} → ${m.themeName}`}</s-text>
            ))}
          </s-stack>
        </s-section>
      )}

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
