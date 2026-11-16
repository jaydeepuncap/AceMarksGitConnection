import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { COMMITS_PER_PAGE, CommitSyncPanel } from '../components/CommitSyncPanel';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { BranchThemeTitle, Card, CardSection, KeyValue, StatusBadge } from '../components/Common';
import { FullSyncControls, MappingActionDialogs, themeOptionsFor } from '../components/MappingControls';
import { SyncRunsTable } from '../components/SyncRunsTable';
import { Badge, Banner, Button, Grid, Icon, Paragraph, Section, Stack, Tabs, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, mappingStatus, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncPreview } from '../lib/types';

type Tab = 'commits' | 'full' | 'history';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'commits', label: 'Commits', icon: 'git-commit' },
  { id: 'full', label: 'Full sync', icon: 'refresh' },
  { id: 'history', label: 'History', icon: 'clock' },
];

/**
 * A branch → theme mapping. The summary card says where the theme stands and
 * offers the one next step; the tabs hold commit sync, full sync, the syncs
 * applied and the mapping itself.
 */
export default function MappingDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const github = useApiQuery(() => api.github.connection(), []);
  const mapping = mappings.data?.items.find((m) => m.id === id) ?? null;

  const [tab, setTab] = useState<Tab>('commits');
  const [dialog, setDialog] = useState<'change' | 'remove' | null>(null);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const commits = useApiQuery(
    () =>
      api.commits.list({
        repository: mapping!.repository,
        branch: mapping!.branch,
        page,
        perPage: COMMITS_PER_PAGE,
        themeId: mapping!.themeId,
      }),
    [mapping?.id, page, refreshKey],
    !!mapping,
  );
  const last = useApiQuery(
    () => api.sync.last({ themeId: mapping!.themeId, branch: mapping!.branch }),
    [mapping?.id, refreshKey],
    !!mapping,
  );
  const confirmSync = useMutation(api.sync.confirm);
  // "Review N updates": everything from the theme's commit up to the branch head, in one review.
  const syncAll = useMutation(async () => {
    const head = await api.github.branch(mapping!.branch, mapping!.repository);
    return api.sync.preview({
      repository: mapping!.repository,
      branch: mapping!.branch,
      commitSha: head.commitSha,
      themeId: mapping!.themeId,
      strategy: 'since_last_sync',
      allowDeletes: false,
    });
  });

  // Also wait while the list reloads, so a just-changed mapping is not reported missing.
  if (mappings.loading && (!mappings.data || !mapping)) return <LoadingState title="Theme mapping" />;

  if (!mapping) {
    return (
      <AppLayout
        title="Mapping not found"
        backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}
      >
        <ErrorBanner error={mappings.error} onRetry={mappings.reload} />
        <Section heading="This mapping no longer exists">
          <Paragraph>
            It may have been changed or removed. Its sync history is still available in Sync history.
          </Paragraph>
          <Button slot="secondary-actions" variant="primary" onClick={() => navigate('/mappings')}>
            Back to theme mapping
          </Button>
        </Section>
      </AppLayout>
    );
  }

  const theme = themes.data?.find((t) => t.id === mapping.themeId);
  const lastSynced = commits.data?.lastSynced ?? null;
  const lastRun = last.data ?? null;
  const result = lastRun ? RESULT_BADGE[lastRun.status] : undefined;
  const checking = commits.loading || last.loading;
  const status = checking
    ? null
    : mappingStatus({
        themeName: mapping.themeName,
        branch: mapping.branch,
        lastSyncedSha: lastSynced?.sha ?? null,
        waiting: commits.data ? commits.data.waiting : null,
        waitingMore: !!commits.data?.waitingMore,
        lastRunStatus: lastRun?.status ?? null,
      });
  const waiting = commits.data?.waiting ?? 0;

  const refresh = () => {
    mappings.reload();
    themes.reload();
    setRefreshKey((k) => k + 1);
  };
  const reviewAll = async () => {
    const prepared = await syncAll.run();
    if (prepared) setPreview(prepared);
  };
  const startSync = async (confirmation: {
    confirmLiveTheme?: boolean;
    confirmThemeName?: string;
    acceptDirectEdits?: boolean;
  }) => {
    if (!preview) return;
    const run = await confirmSync.run({ syncId: preview.syncId, confirm: true, ...confirmation });
    if (run) {
      setPreview(null);
      showToast('Sync started');
      navigate(`/sync-history?id=${run.id}`);
    }
  };

  /** The one thing to do next, shown in the summary card. */
  const nextStep = (() => {
    if (!status) return null;
    switch (status.key) {
      case 'sync-failed':
        return (
          <Button variant="primary" onClick={() => navigate(`/sync-history?id=${lastRun!.id}`)}>
            Open the failed sync
          </Button>
        );
      case 'not-synced':
        return (
          <Button variant="primary" onClick={() => setTab('full')}>
            Start with a full sync
          </Button>
        );
      case 'updates-waiting':
        return (
          <Button variant="primary" loading={syncAll.pending} disabled={!theme} onClick={reviewAll}>
            {`Review ${waiting}${commits.data?.waitingMore ? '+' : ''} update${waiting === 1 ? '' : 's'}`}
          </Button>
        );
      default:
        return (
          <Stack direction="inline" gap="small-200" alignItems="center">
            <Icon type="check-circle" tone="success" />
            <Text>Nothing to sync</Text>
          </Stack>
        );
    }
  })();

  return (
    <AppLayout
      title={`${mapping.branch} → ${mapping.themeName}`}
      subtitle={mapping.repository}
      backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}
      secondaryActions={[
        { content: 'Change theme', onAction: () => setDialog('change') },
        { content: 'Remove mapping', onAction: () => setDialog('remove'), tone: 'critical' },
        { content: 'Refresh', onAction: refresh },
      ]}
      banners={
        <>
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          {github.data && !github.data.connected && (
            <Banner
              tone="warning"
              heading="GitHub is not connected"
              secondaryActions={[{ label: 'Connect GitHub', onClick: () => navigate('/settings') }]}
            >
              <Paragraph>
                {`${mapping.branch} → ${mapping.themeName} is paused: commits cannot be read or synced until GitHub is connected again. The mapping and its history are kept.`}
              </Paragraph>
            </Banner>
          )}
          <ErrorBanner
            error={syncAll.error}
            heading="The updates could not be prepared"
            onDismiss={syncAll.clearError}
          />
          {themes.data && !theme && (
            <Banner tone="critical" heading="The theme no longer exists">
              <Paragraph>
                {`${mapping.themeName} was deleted in Shopify. Use Change theme or Remove mapping at the top of the page.`}
              </Paragraph>
            </Banner>
          )}
        </>
      }
    >
      <Card>
        <CardSection>
          <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <BranchThemeTitle
              heading
              branch={mapping.branch}
              themeName={mapping.themeName}
              role={theme?.role}
              themeMissing={!!themes.data && !theme}
            />
            <StatusBadge status={status?.key ?? 'checking'} label={status?.label} />
          </Stack>
        </CardSection>
        <CardSection>
          <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="large">
            <KeyValue label="Theme is on">
              <Text>
                {lastSynced
                  ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                  : checking
                    ? '…'
                    : 'No commit synced yet'}
              </Text>
            </KeyValue>
            <KeyValue label={`New on ${mapping.branch}`}>
              <Text>
                {checking && !commits.data
                  ? '…'
                  : lastSynced
                    ? `${waiting}${commits.data?.waitingMore ? '+' : ''} commit${waiting === 1 ? '' : 's'} not in the theme yet`
                    : 'Run a full sync first'}
              </Text>
            </KeyValue>
            <KeyValue label="Last sync">
              {lastRun && result ? (
                <Stack direction="inline" gap="small-200" alignItems="center">
                  <Badge tone={result.tone}>{result.label}</Badge>
                  <Text>{`${syncTypeLabel(lastRun.strategy)} · ${formatDate(lastRun.completedAt)}`}</Text>
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
          <Stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <Stack gap="small-100">
              <Text>{status?.description ?? 'Checking where the theme stands…'}</Text>
              {theme?.isLive && (
                <Text tone="caution">This is your live theme: syncs change the storefront, and you confirm twice.</Text>
              )}
            </Stack>
            {github.data && !github.data.connected ? null : nextStep}
          </Stack>
        </CardSection>
      </Card>

      <Tabs tabs={TABS} selected={tab} onSelect={(next: Tab) => setTab(next)} />

      {tab === 'commits' && (
        <Section heading={`Commits on ${mapping.branch}`}>
          <CommitSyncPanel
            mapping={mapping}
            theme={theme}
            commits={commits}
            page={page}
            setPage={(update) => setPage(update)}
            onPreview={setPreview}
          />
        </Section>
      )}

      {tab === 'full' && (
        <Section heading="Full sync">
          <FullSyncControls mapping={mapping} disabled={!theme} onPreview={setPreview} />
        </Section>
      )}

      {tab === 'history' && (
        <Section heading={`Syncs to ${mapping.themeName} from ${mapping.branch}`}>
          <SyncRunsTable themeId={mapping.themeId} branch={mapping.branch} refreshKey={refreshKey} />
        </Section>
      )}

      <MappingActionDialogs
        mapping={mapping}
        themeOptions={themeOptionsFor(mapping, themes.data ?? [], mappings.data?.items ?? [])}
        action={dialog}
        onClose={() => setDialog(null)}
        onChanged={(changed) => {
          // Changing the theme replaces the mapping (new id): put it in the list before opening it,
          // then reload so the list matches the server.
          setDialog(null);
          if (mappings.data) {
            mappings.setData({ ...mappings.data, items: [...mappings.data.items.filter((m) => m.id !== id), changed] });
          }
          navigate(`/mappings/${changed.id}`, { replace: true });
          mappings.reload();
        }}
        onRemoved={() => navigate('/mappings')}
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
