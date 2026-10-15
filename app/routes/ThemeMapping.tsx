import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { themeLabel } from '../components/MappingControls';
import { BranchThemeTitle, Card, CardSection, KeyValue, StatusBadge } from '../components/Common';
import { Button, Stack, Text, Tooltip } from '../components/ui';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, mappingStatus, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { GithubBranch, ShopifyTheme, ThemeMapping as Mapping } from '../lib/types';

const NONE = '__none__';

/** One branch → theme mapping with where it stands; the whole card opens its page. */
function MappingCard({
  mapping,
  theme,
  themesLoaded,
}: {
  mapping: Mapping;
  theme: ShopifyTheme | undefined;
  themesLoaded: boolean;
}) {
  const navigate = useNavigate();
  // One commit is enough: the response says what the theme is on and how many commits wait.
  const commits = useApiQuery(
    () =>
      api.commits.list({
        repository: mapping.repository,
        branch: mapping.branch,
        page: 1,
        perPage: 1,
        themeId: mapping.themeId,
      }),
    [mapping.id],
  );
  const last = useApiQuery(() => api.sync.last({ themeId: mapping.themeId, branch: mapping.branch }), [mapping.id]);
  const lastSynced = commits.data?.lastSynced ?? null;
  const run = last.data ?? null;
  const result = run ? RESULT_BADGE[run.status] : undefined;
  const checking = commits.loading || last.loading;
  const status = checking
    ? { key: 'checking' as const, label: 'Checking…', tone: 'neutral' as const }
    : mappingStatus({
        themeName: mapping.themeName,
        branch: mapping.branch,
        lastSyncedSha: lastSynced?.sha ?? null,
        waiting: commits.data ? commits.data.waiting : null,
        waitingMore: !!commits.data?.waitingMore,
        lastRunStatus: run?.status ?? null,
      });
  const next =
    status.label === 'Not synced yet' ? 'Start full sync' : status.tone === 'info' ? 'Sync updates' : 'Open mapping';

  return (
    <Card
      onClick={() => navigate(`/mappings/${mapping.id}`)}
      accessibilityLabel={`Open ${mapping.branch} → ${mapping.themeName}`}
    >
      <CardSection>
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <BranchThemeTitle
            heading
            branch={mapping.branch}
            themeName={mapping.themeName}
            role={theme?.role}
            themeMissing={themesLoaded && !theme}
          />
          <StatusBadge status={status.key} label={status.label} />
        </s-stack>
      </CardSection>
      <CardSection subdued>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="large">
          <KeyValue label="Theme is on">
            <s-text>
              {lastSynced
                ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                : checking
                  ? '…'
                  : 'No commit synced yet'}
            </s-text>
          </KeyValue>
          <KeyValue label="Last sync">
            {run && result ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={result.tone}>{result.label}</s-badge>
                <s-text>{`${syncTypeLabel(run.strategy)} · ${formatDate(run.completedAt)}`}</s-text>
              </s-stack>
            ) : lastSynced ? (
              // The commit was recorded from the theme's sync file (e.g. a copied theme), not by a sync here.
              <s-text>{`Not synced from this app yet · recorded from the theme file ${formatDate(lastSynced.syncedAt)}`}</s-text>
            ) : (
              <s-text>{checking ? '…' : 'No sync performed yet'}</s-text>
            )}
          </KeyValue>
        </s-grid>
      </CardSection>
      <CardSection>
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()} · mapped ${formatDate(mapping.createdAt)}`}</s-text>
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-text type="strong">{next}</s-text>
            <s-icon type="chevron-right" />
          </s-stack>
        </s-stack>
      </CardSection>
    </Card>
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

  const [adding, setAdding] = useState(!!(params.get('branch') || params.get('themeId')));
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
          <s-paragraph>
            Connect GitHub and choose a repository in Settings, then map its branches to themes here.
          </s-paragraph>
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
  const themeBlocked = (t: ShopifyTheme): string | null => {
    if (!t.writable) return 'cannot be synced';
    const m = items.find((x) => x.themeId === t.id);
    return m ? `mapped to ${m.branch}` : null;
  };
  const freeBranches = branchList.filter((b) => !mappingForBranch(b.name));
  const freeThemes = allThemes.filter((t) => !themeBlocked(t));
  const showForm = adding || repoItems.length === 0;
  const nothingFree = !branches.loading && !themes.loading && (freeBranches.length === 0 || freeThemes.length === 0);
  /** Why no mapping can be added right now (tooltip of the disabled "Add mapping"). */
  const addBlockedReason = !nothingFree
    ? null
    : freeBranches.length === 0
      ? `Every branch of ${repository} is already mapped to a theme. Change or remove a mapping to free a branch.`
      : 'Every theme that can be synced is already mapped to a branch. Change or remove a mapping to free a theme, or duplicate a theme in Shopify.';

  const refresh = () => {
    mappings.reload();
    setRefreshKey((k) => k + 1);
  };

  const doCreate = async () => {
    if (!newBranch || !newThemeId) return;
    const created = await create.run({
      branch: newBranch,
      themeId: newThemeId,
    });
    if (created) {
      showToast(`${created.branch} → ${created.themeName} added`);
      setNewBranch('');
      setNewThemeId('');
      setAdding(false);
      refresh();
    }
  };

  return (
    <AppLayout
      title="Theme mapping"
      subtitle={`${repository} · each branch syncs to its own theme`}
      primaryAction={
        showForm ? undefined : { content: 'Add mapping', onAction: () => setAdding(true), disabled: nothingFree }
      }
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => (refresh(), themes.reload(), branches.reload()),
        },
      ]}
      banners={
        <>
          <ErrorBanner
            error={settings.error ?? mappings.error}
            onRetry={() => (settings.reload(), mappings.reload())}
          />
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          <ErrorBanner error={branches.error} heading="Branches could not be loaded" onRetry={branches.reload} />
        </>
      }
    >
      {showForm && (
        <s-section heading={repoItems.length === 0 ? 'Map your first branch' : 'Add a mapping'}>
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Pick a branch and the theme it should update — for example{' '}
              <s-text type="strong">main → Live theme</s-text> and <s-text type="strong">staging → Staging copy</s-text>
              . A branch updates one theme only, and a theme is updated by one branch only. Nothing in the theme changes
              until you sync.
            </s-paragraph>
            {nothingFree ? (
              <s-banner tone="info">
                <s-paragraph>
                  {freeBranches.length === 0
                    ? 'Every branch is already mapped. Remove or change a mapping to free a branch.'
                    : 'Every theme that can be synced is already mapped. Remove or change a mapping to free a theme, or duplicate a theme in Shopify.'}
                </s-paragraph>
              </s-banner>
            ) : (
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base" alignItems="end">
                <s-select
                  label="Branch"
                  value={newBranch || NONE}
                  details={
                    branches.loading
                      ? 'Loading branches…'
                      : `${freeBranches.length} of ${branchList.length} branches free`
                  }
                  onChange={(event) =>
                    setNewBranch(event.currentTarget.value === NONE ? '' : event.currentTarget.value)
                  }
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
                  {newBranch && !branchList.some((b) => b.name === newBranch) && (
                    <s-option value={newBranch}>{newBranch}</s-option>
                  )}
                </s-select>
                <s-select
                  label="Shopify theme"
                  value={newThemeId || NONE}
                  details={
                    themes.loading ? 'Loading themes…' : `${freeThemes.length} of ${allThemes.length} themes free`
                  }
                  onChange={(event) =>
                    setNewThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)
                  }
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
                <s-stack direction="inline" gap="small-200">
                  <s-button
                    variant="primary"
                    disabled={!newBranch || !newThemeId}
                    loading={create.pending}
                    onClick={doCreate}
                  >
                    Add mapping
                  </s-button>
                  {repoItems.length > 0 && (
                    <s-button variant="tertiary" onClick={() => (setAdding(false), create.clearError())}>
                      Cancel
                    </s-button>
                  )}
                </s-stack>
              </s-grid>
            )}
            <ErrorBanner error={create.error} heading="Mapping not added" onDismiss={create.clearError} />
          </s-stack>
        </s-section>
      )}

      {repoItems.length > 0 && (
        // Cards sit directly on the page (not inside a section) so their titles render as larger headings.
        <Stack gap="base" accessibilityLabel={`Mappings (${repoItems.length})`}>
          <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <Text type="strong">{`Mappings (${repoItems.length})`}</Text>
            {!showForm && (
              <Stack direction="inline" gap="small-200" alignItems="center">
                {addBlockedReason && (
                  <>
                    <Tooltip id="add-mapping-blocked">
                      <Text>{addBlockedReason}</Text>
                    </Tooltip>
                    <Button
                      variant="tertiary"
                      icon="info"
                      interestFor="add-mapping-blocked"
                      accessibilityLabel="Why can't I add a mapping?"
                    />
                  </>
                )}
                <Button
                  icon="plus"
                  disabled={nothingFree}
                  interestFor={addBlockedReason ? 'add-mapping-blocked' : undefined}
                  onClick={() => setAdding(true)}
                >
                  Add mapping
                </Button>
              </Stack>
            )}
          </Stack>
          {addBlockedReason && !showForm && <Text color="subdued">{addBlockedReason}</Text>}
          {repoItems.map((m) => (
            <MappingCard
              key={`${m.id}:${refreshKey}`}
              mapping={m}
              theme={allThemes.find((t) => t.id === m.themeId)}
              themesLoaded={!!themes.data}
            />
          ))}
        </Stack>
      )}

      {otherRepoItems.length > 0 && (
        <s-section heading="Mappings of other repositories">
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              These themes are mapped to another repository and cannot be used here until that mapping is removed
              (select that repository in Settings to manage them).
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
