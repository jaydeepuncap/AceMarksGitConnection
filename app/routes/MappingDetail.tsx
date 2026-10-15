import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { COMMITS_PER_PAGE, CommitSyncPanel } from '../components/CommitSyncPanel';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { BranchThemeTitle, StatTile, StatusBadge } from '../components/Common';
import { FullSyncControls, ManageMappingControls, themeOptionsFor } from '../components/MappingControls';
import { SyncRunsTable } from '../components/SyncRunsTable';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, mappingStatus, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncPreview } from '../lib/types';

/** Banner tone for a mapping status (badges use "caution", banners "warning"). */
const BANNER_TONE: Partial<Record<string, 'success' | 'info' | 'warning' | 'critical'>> = {
  success: 'success',
  info: 'info',
  caution: 'warning',
  critical: 'critical',
};

/**
 * A branch → theme mapping: everything for that pair on one page — where the
 * theme stands, commit sync, full sync, the syncs applied, and the mapping itself.
 */
export default function MappingDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const mapping = mappings.data?.items.find((m) => m.id === id) ?? null;

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

  if (mappings.loading && !mappings.data) return <LoadingState title="Theme mapping" />;

  if (!mapping) {
    return (
      <AppLayout
        title="Mapping not found"
        backAction={{
          content: 'Theme mapping',
          onAction: () => navigate('/mappings'),
        }}
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
  const neverSynced = !commits.loading && !last.loading && !lastSynced && !lastRun;
  const status =
    commits.loading || last.loading
      ? null
      : mappingStatus({
          themeName: mapping.themeName,
          branch: mapping.branch,
          lastSyncedSha: lastSynced?.sha ?? null,
          waiting: commits.data ? commits.data.waiting : null,
          waitingMore: !!commits.data?.waitingMore,
          lastRunStatus: lastRun?.status ?? null,
        });
  const bannerTone = status ? (BANNER_TONE[status.tone] ?? 'info') : 'info';
  const refresh = () => {
    mappings.reload();
    themes.reload();
    setRefreshKey((k) => k + 1);
  };

  const startSync = async (confirmation: {
    confirmLiveTheme?: boolean;
    confirmThemeName?: string;
    acceptDirectEdits?: boolean;
  }) => {
    if (!preview) return;
    const run = await confirmSync.run({
      syncId: preview.syncId,
      confirm: true,
      ...confirmation,
    });
    if (run) {
      setPreview(null);
      showToast('Sync started');
      navigate(`/sync-history?id=${run.id}`);
    }
  };

  const fullSync = (
    <s-section heading="Full sync">
      <FullSyncControls mapping={mapping} disabled={!theme} onPreview={setPreview} />
    </s-section>
  );

  return (
    <AppLayout
      title={`${mapping.branch} → ${mapping.themeName}`}
      inlineSize="large"
      subtitle={mapping.repository}
      backAction={{
        content: 'Theme mapping',
        onAction: () => navigate('/mappings'),
      }}
      secondaryActions={[{ content: 'Refresh', onAction: refresh }]}
      banners={
        <>
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          {theme?.isLive && (
            <s-banner tone="warning" heading="This is your live theme">
              <s-paragraph>Syncs change the storefront customers see. You will be asked to confirm twice.</s-paragraph>
            </s-banner>
          )}
          {themes.data && !theme && (
            <s-banner tone="critical" heading="The theme no longer exists">
              <s-paragraph>
                {`${mapping.themeName} was deleted in Shopify. Change the theme of this mapping or remove it below.`}
              </s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      <s-section accessibilityLabel="Overview">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <BranchThemeTitle
              heading
              branch={mapping.branch}
              themeName={mapping.themeName}
              role={theme?.role}
              themeMissing={!!themes.data && !theme}
            />
            {status && <StatusBadge status={status.key} label={status.label} />}
          </s-stack>
          <s-text color="subdued">{`${mapping.repository} · Theme ID ${mapping.themeId.split('/').pop()}`}</s-text>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <StatTile label="Theme is on" hint={lastSynced ? formatDate(lastSynced.syncedAt) : 'No commit synced yet'}>
              <s-text type="strong">
                {lastSynced ? `${lastSynced.shortSha} ${firstLine(lastSynced.message)}` : '—'}
              </s-text>
            </StatTile>
            <StatTile
              label="Updates waiting"
              hint={lastSynced ? `new commits on ${mapping.branch}` : 'after the first sync'}
            >
              <s-text type="strong">
                {commits.loading && !commits.data
                  ? '…'
                  : lastSynced
                    ? `${commits.data?.waiting ?? 0}${commits.data?.waitingMore ? '+' : ''}`
                    : '—'}
              </s-text>
            </StatTile>
            <StatTile
              label="Last sync"
              hint={
                lastRun
                  ? `${syncTypeLabel(lastRun.strategy)} · ${formatDate(lastRun.completedAt)}`
                  : lastSynced
                    ? 'Not synced from this app yet (commit recorded from the theme file)'
                    : 'No sync performed yet'
              }
            >
              {lastRun && result ? (
                <s-badge tone={result.tone}>{result.label}</s-badge>
              ) : (
                <s-text type="strong">—</s-text>
              )}
            </StatTile>
            <StatTile label="Mapped since">
              <s-text type="strong">{formatDate(mapping.createdAt)}</s-text>
            </StatTile>
          </s-grid>
        </s-stack>
      </s-section>

      {status && (
        <s-banner tone={bannerTone} heading={status.label}>
          <s-paragraph>{status.description}</s-paragraph>
          {lastRun && status.tone === 'critical' && (
            <s-button slot="secondary-actions" onClick={() => navigate(`/sync-history?id=${lastRun.id}`)}>
              Open the last sync
            </s-button>
          )}
        </s-banner>
      )}
      {neverSynced && fullSync}

      <s-section heading={`Sync commits from ${mapping.branch}`}>
        <CommitSyncPanel
          mapping={mapping}
          theme={theme}
          commits={commits}
          page={page}
          setPage={(update) => setPage(update)}
          onPreview={setPreview}
        />
      </s-section>

      {!neverSynced && fullSync}

      <s-section heading="Applied syncs">
        <SyncRunsTable themeId={mapping.themeId} branch={mapping.branch} refreshKey={refreshKey} />
      </s-section>

      <s-section heading="Mapping">
        <s-stack gap="small-200">
          <s-paragraph color="subdued">
            {`${mapping.branch} syncs only to ${mapping.themeName}. Changing or removing the mapping does not change any theme files, and the sync history is kept.`}
          </s-paragraph>
          <ManageMappingControls
            mapping={mapping}
            themeOptions={themeOptionsFor(mapping, themes.data ?? [], mappings.data?.items ?? [])}
            onChanged={(changed) => navigate(`/mappings/${changed.id}`, { replace: true })}
            onRemoved={() => navigate('/mappings')}
          />
        </s-stack>
      </s-section>

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
