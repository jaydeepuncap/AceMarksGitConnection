import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { themeLabel } from '../components/MappingControls';
import { BranchThemeTitle, Card, CardSection, KeyValue, StatusBadge } from '../components/Common';
import {
  Badge,
  Banner,
  Button,
  Grid,
  Icon,
  Modal,
  Option,
  Paragraph,
  Section,
  Select,
  Stack,
  Text,
} from '../components/ui';
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
        <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <BranchThemeTitle
            heading
            branch={mapping.branch}
            themeName={mapping.themeName}
            role={theme?.role}
            themeMissing={themesLoaded && !theme}
          />
          <StatusBadge status={status.key} label={status.label} />
        </Stack>
      </CardSection>
      <CardSection subdued>
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="large">
          <KeyValue label="Theme is on">
            <Text>
              {lastSynced
                ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                : checking
                  ? '…'
                  : 'No commit synced yet'}
            </Text>
          </KeyValue>
          <KeyValue label="Last sync">
            {run && result ? (
              <Stack direction="inline" gap="small-200" alignItems="center">
                <Badge tone={result.tone}>{result.label}</Badge>
                <Text>{`${syncTypeLabel(run.strategy)} · ${formatDate(run.completedAt)}`}</Text>
              </Stack>
            ) : lastSynced ? (
              // The commit was recorded from the theme's sync file (e.g. a copied theme), not by a sync here.
              <Text>{`Not synced from this app yet · recorded from the theme file ${formatDate(lastSynced.syncedAt)}`}</Text>
            ) : (
              <Text>{checking ? '…' : 'No sync performed yet'}</Text>
            )}
          </KeyValue>
        </Grid>
      </CardSection>
      <CardSection>
        <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <Text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()} · mapped ${formatDate(mapping.createdAt)}`}</Text>
          <Stack direction="inline" gap="small-100" alignItems="center">
            <Text type="strong">{next}</Text>
            <Icon type="chevron-right" />
          </Stack>
        </Stack>
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
        <Section heading="Connect a repository first">
          <Paragraph>
            Connect GitHub and choose a repository in Settings, then map its branches to themes here.
          </Paragraph>
          <Button slot="secondary-actions" variant="primary" onClick={go('/settings')}>
            Open settings
          </Button>
        </Section>
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
  const nothingFree = !branches.loading && !themes.loading && (freeBranches.length === 0 || freeThemes.length === 0);
  /** Why "Add mapping" in the page header is disabled, shown in a banner below it. */
  const addBlocked = !nothingFree
    ? null
    : freeBranches.length === 0
      ? {
          heading: 'Every branch is mapped',
          text: `Each branch of ${repository} already syncs to a theme. Open a mapping to change its theme or remove it, then add a new one.`,
        }
      : {
          heading: 'Every theme is mapped',
          text: 'Each theme that can be synced already receives a branch. Open a mapping to change or remove it, or duplicate a theme in Shopify, then add a new one.',
        };

  const refresh = () => {
    mappings.reload();
    setRefreshKey((k) => k + 1);
  };

  const closeAdd = () => {
    setAdding(false);
    setNewBranch('');
    setNewThemeId('');
    create.clearError();
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
        repoItems.length === 0
          ? undefined
          : { content: 'Add mapping', onAction: () => setAdding(true), disabled: nothingFree }
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
          {settings.data && !settings.data.shop.canWriteThemes && (
            <Banner tone="warning" heading="Theme write access not granted">
              <Paragraph>
                The app can list themes but cannot change their files until the write_themes scope is granted.
              </Paragraph>
            </Banner>
          )}
          <ErrorBanner error={branches.error} heading="Branches could not be loaded" onRetry={branches.reload} />
          {addBlocked && !adding && (
            <Banner tone="info" heading={`${addBlocked.heading} — Add mapping is unavailable`}>
              <Paragraph>{addBlocked.text}</Paragraph>
            </Banner>
          )}
        </>
      }
    >
      {repoItems.length === 0 && (
        <Section heading="Map your first branch">
          <Stack gap="base">
            <Paragraph>
              Connect a branch of {repository} to the Shopify theme it should update — for example{' '}
              <Text type="strong">main → Live theme</Text> and <Text type="strong">staging → Staging copy</Text>.
              Nothing in the theme changes until you sync.
            </Paragraph>
            <Stack direction="inline">
              <Button variant="primary" icon="plus" disabled={nothingFree} onClick={() => setAdding(true)}>
                Add mapping
              </Button>
            </Stack>
          </Stack>
        </Section>
      )}

      <Modal id="add-mapping" open={adding} heading="Add a mapping" onHide={closeAdd}>
        <Stack gap="base">
          <Paragraph>
            Pick a branch and the theme it should update. A branch updates one theme only, and a theme is updated by one
            branch only. Nothing in the theme changes until you sync.
          </Paragraph>
          {nothingFree ? (
            <Banner tone="info">
              <Paragraph>
                {freeBranches.length === 0
                  ? 'Every branch is already mapped. Remove or change a mapping to free a branch.'
                  : 'Every theme that can be synced is already mapped. Remove or change a mapping to free a theme, or duplicate a theme in Shopify.'}
              </Paragraph>
            </Banner>
          ) : (
            <>
              <Select
                label="Branch"
                value={newBranch || NONE}
                details={
                  branches.loading
                    ? 'Loading branches…'
                    : `${freeBranches.length} of ${branchList.length} branches free`
                }
                onChange={(event) => setNewBranch(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
              >
                <Option value={NONE}>Select a branch</Option>
                {branchList.map((b) => {
                  const m = mappingForBranch(b.name);
                  return (
                    <Option key={b.name} value={b.name} disabled={!!m}>
                      {`${b.name}${m ? ` — mapped to ${m.themeName}` : ''}`}
                    </Option>
                  );
                })}
                {newBranch && !branchList.some((b) => b.name === newBranch) && (
                  <Option value={newBranch}>{newBranch}</Option>
                )}
              </Select>
              <Select
                label="Shopify theme"
                value={newThemeId || NONE}
                details={themes.loading ? 'Loading themes…' : `${freeThemes.length} of ${allThemes.length} themes free`}
                onChange={(event) => setNewThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
              >
                <Option value={NONE}>Select a theme</Option>
                {allThemes.map((t) => {
                  const reason = themeBlocked(t);
                  return (
                    <Option key={t.id} value={t.id} disabled={!!reason}>
                      {`${themeLabel(t)}${reason ? ` — ${reason}` : ''}`}
                    </Option>
                  );
                })}
              </Select>
            </>
          )}
          <ErrorBanner error={create.error} heading="Mapping not added" onDismiss={create.clearError} />
        </Stack>
        <Button
          slot="primary-action"
          variant="primary"
          disabled={!newBranch || !newThemeId || nothingFree}
          loading={create.pending}
          onClick={doCreate}
        >
          Add mapping
        </Button>
        <Button slot="secondary-actions" disabled={create.pending} onClick={closeAdd}>
          Cancel
        </Button>
      </Modal>

      {repoItems.length > 0 && (
        // Cards sit directly on the page (not inside a section) so their titles render as larger headings.
        <Stack gap="base" accessibilityLabel={`Mappings (${repoItems.length})`}>
          <Text type="strong">{`Mappings (${repoItems.length})`}</Text>
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
        <Section heading="Mappings of other repositories">
          <Stack gap="small-200">
            <Paragraph color="subdued">
              These themes are mapped to another repository and cannot be used here until that mapping is removed
              (select that repository in Settings to manage them).
            </Paragraph>
            {otherRepoItems.map((m) => (
              <Text key={m.id}>{`${m.repository} · ${m.branch} → ${m.themeName}`}</Text>
            ))}
          </Stack>
        </Section>
      )}
    </AppLayout>
  );
}
