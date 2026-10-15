import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LastSyncCard } from '../components/LastSyncCard';
import { LoadingState } from '../components/LoadingState';
import { ManageMappingControls, themeLabel, themeOptionsFor } from '../components/MappingControls';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { GithubBranch, ShopifyTheme, ThemeMapping as Mapping } from '../lib/types';

const NONE = '__none__';

/** One branch → theme mapping; opens its own page. */
function MappingCard({
  mapping,
  theme,
  themesLoaded,
  themeOptions,
  refreshKey,
  onChanged,
}: {
  mapping: Mapping;
  theme: ShopifyTheme | undefined;
  themesLoaded: boolean;
  themeOptions: { theme: ShopifyTheme; disabledReason: string | null }[];
  refreshKey: number;
  onChanged: () => void;
}) {
  const go = useNavigateHandler();
  const role = theme ? THEME_ROLE_BADGE[theme.role] : null;
  const open = go(`/mappings/${mapping.id}`);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-clickable onClick={open} accessibilityLabel={`Open ${mapping.branch} → ${mapping.themeName}`}>
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="git-branch" />
              <s-text type="strong">{mapping.branch}</s-text>
              <s-icon type="arrow-right" />
              <s-icon type="theme" />
              <s-text type="strong">{mapping.themeName}</s-text>
              {role && <s-badge tone={role.tone}>{role.label}</s-badge>}
              {themesLoaded && !theme && <s-badge tone="critical">Theme no longer exists</s-badge>}
            </s-stack>
            <s-text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()} · mapped ${formatDate(mapping.createdAt)}`}</s-text>
          </s-stack>
        </s-clickable>

        <LastSyncCard themeId={mapping.themeId} branch={mapping.branch} refreshKey={refreshKey} compact />

        <s-stack direction="inline" gap="small-200" alignItems="start">
          <s-button variant="primary" onClick={open}>
            Open
          </s-button>
          <ManageMappingControls mapping={mapping} themeOptions={themeOptions} onChanged={onChanged} onRemoved={onChanged} />
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/**
 * Theme mapping: connect each repository branch to its own Shopify theme, for
 * example main → Live theme and staging → Staging copy. A branch syncs to one
 * theme only and a theme receives one branch only.
 */
export default function ThemeMapping() {
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
  const [refreshKey, setRefreshKey] = useState(0);
  const create = useMutation(api.mappings.create);

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
                themeOptions={themeOptionsFor(m, allThemes, items)}
                refreshKey={refreshKey}
                onChanged={refresh}
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
    </AppLayout>
  );
}
