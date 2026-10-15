import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { COMMITS_PER_PAGE, CommitSyncPanel } from '../components/CommitSyncPanel';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { BranchThemeTitle, Card, CardSection, KeyValue, StatusBadge } from '../components/Common';
import { FullSyncControls, ManageMappingControls, themeOptionsFor } from '../components/MappingControls';
import { SyncRunsTable } from '../components/SyncRunsTable';
import { Tabs } from '../components/ui';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, mappingStatus, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncPreview } from '../lib/types';

type Tab = 'commits' | 'full' | 'history' | 'mapping';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'commits', label: 'Commits', icon: 'git-commit' },
  { id: 'full', label: 'Full sync', icon: 'refresh' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'mapping', label: 'Mapping', icon: 'settings' },
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
  const mapping = mappings.data?.items.find((m) => m.id === id) ?? null;

  const [tab, setTab] = useState<Tab>('commits');
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

  if (mappings.loading && !mappings.data) return <LoadingState title="Theme mapping" />;

  if (!mapping) {
    return (
      <AppLayout
        title="Mapping not found"
        backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}
      >
        <ErrorBanner error={mappings.error} onRetry={mappings.reload} />
        <s-section heading="This mapping no longer exists">
          <s-paragraph>
            It may have been changed or removed. Its sync history is still available in Sync history.
          </s-paragraph>
          <s-button slot="secondary-actions" variant="primary" onClick={() => navigate('/mappings')}>
            Back to theme mapping
          </s-button>
        </s-section>
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
          <s-button variant="primary" onClick={() => navigate(`/sync-history?id=${lastRun!.id}`)}>
            Open the failed sync
          </s-button>
        );
      case 'not-synced':
        return (
          <s-button variant="primary" onClick={() => setTab('full')}>
            Start with a full sync
          </s-button>
        );
      case 'updates-waiting':
        return (
          <s-button variant="primary" loading={syncAll.pending} disabled={!theme} onClick={reviewAll}>
            {`Review ${waiting}${commits.data?.waitingMore ? '+' : ''} update${waiting === 1 ? '' : 's'}`}
          </s-button>
        );
      default:
        return (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="check-circle" tone="success" />
            <s-text>Nothing to sync</s-text>
          </s-stack>
        );
    }
  })();

  return (
    <AppLayout
      title={`${mapping.branch} → ${mapping.themeName}`}
      inlineSize="large"
      subtitle={mapping.repository}
      backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}
      secondaryActions={[{ content: 'Refresh', onAction: refresh }]}
      banners={
        <>
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          <ErrorBanner
            error={syncAll.error}
            heading="The updates could not be prepared"
            onDismiss={syncAll.clearError}
          />
          {themes.data && !theme && (
            <s-banner tone="critical" heading="The theme no longer exists">
              <s-paragraph>
                {`${mapping.themeName} was deleted in Shopify. Change the theme of this mapping or remove it (Mapping tab).`}
              </s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      <Card>
        <CardSection>
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <BranchThemeTitle
              heading
              branch={mapping.branch}
              themeName={mapping.themeName}
              role={theme?.role}
              themeMissing={!!themes.data && !theme}
            />
            <StatusBadge status={status?.key ?? 'checking'} label={status?.label} />
          </s-stack>
        </CardSection>
        <CardSection subdued>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="large">
            <KeyValue label="Theme is on">
              <s-text type="strong">
                {lastSynced
                  ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                  : checking
                    ? '…'
                    : 'No commit yet'}
              </s-text>
              {lastSynced && <s-text color="subdued">{formatDate(lastSynced.syncedAt)}</s-text>}
            </KeyValue>
            <KeyValue label={`New on ${mapping.branch}`}>
              <s-text type="strong">
                {checking && !commits.data
                  ? '…'
                  : lastSynced
                    ? `${waiting}${commits.data?.waitingMore ? '+' : ''} commit${waiting === 1 ? '' : 's'}`
                    : '—'}
              </s-text>
              <s-text color="subdued">{lastSynced ? 'not in the theme yet' : 'after the first sync'}</s-text>
            </KeyValue>
            <KeyValue label="Last sync">
              {lastRun && result ? (
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone={result.tone}>{result.label}</s-badge>
                  <s-text>{syncTypeLabel(lastRun.strategy)}</s-text>
                </s-stack>
              ) : (
                <s-text type="strong">{checking ? '…' : 'None from this app'}</s-text>
              )}
              <s-text color="subdued">
                {lastRun
                  ? formatDate(lastRun.completedAt)
                  : lastSynced
                    ? 'commit recorded from the theme file'
                    : 'run a full sync first'}
              </s-text>
            </KeyValue>
          </s-grid>
        </CardSection>
        <CardSection>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack gap="small-100">
              <s-text>{status?.description ?? 'Checking where the theme stands…'}</s-text>
              {theme?.isLive && (
                <s-text tone="caution">
                  This is your live theme: syncs change the storefront, and you confirm twice.
                </s-text>
              )}
            </s-stack>
            {nextStep}
          </s-stack>
        </CardSection>
      </Card>

      <Tabs tabs={TABS} selected={tab} onSelect={(next: Tab) => setTab(next)} />

      {tab === 'commits' && (
        <s-section heading={`Commits on ${mapping.branch}`}>
          <CommitSyncPanel
            mapping={mapping}
            theme={theme}
            commits={commits}
            page={page}
            setPage={(update) => setPage(update)}
            onPreview={setPreview}
          />
        </s-section>
      )}

      {tab === 'full' && (
        <s-section heading="Full sync">
          <FullSyncControls mapping={mapping} disabled={!theme} onPreview={setPreview} />
        </s-section>
      )}

      {tab === 'history' && (
        <s-section heading={`Syncs to ${mapping.themeName} from ${mapping.branch}`}>
          <SyncRunsTable themeId={mapping.themeId} branch={mapping.branch} refreshKey={refreshKey} />
        </s-section>
      )}

      {tab === 'mapping' && (
        <s-section heading="Mapping">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              {`${mapping.branch} syncs only to ${mapping.themeName}, mapped ${formatDate(mapping.createdAt)} (theme ID ${mapping.themeId.split('/').pop()}). Changing or removing the mapping does not change any theme files, and the sync history is kept.`}
            </s-paragraph>
            <ManageMappingControls
              mapping={mapping}
              themeOptions={themeOptionsFor(mapping, themes.data ?? [], mappings.data?.items ?? [])}
              onChanged={(changed) => navigate(`/mappings/${changed.id}`, { replace: true })}
              onRemoved={() => navigate('/mappings')}
            />
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
