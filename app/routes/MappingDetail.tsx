import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { COMMITS_PER_PAGE, CommitSyncPanel } from '../components/CommitSyncPanel';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { FullSyncControls, ManageMappingControls, themeOptionsFor } from '../components/MappingControls';
import { SyncRunsTable } from '../components/SyncRunsTable';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDate, RESULT_BADGE, syncTypeLabel, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { SyncPreview } from '../lib/types';

/** One figure of the overview. */
function Tile({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        {children}
        {hint && <s-text color="subdued">{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

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
      <AppLayout title="Mapping not found" backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}>
        <ErrorBanner error={mappings.error} onRetry={mappings.reload} />
        <s-section heading="This mapping no longer exists">
          <s-paragraph>It may have been changed or removed. Its sync history is still available in Sync history.</s-paragraph>
          <s-button slot="secondary-actions" variant="primary" onClick={() => navigate('/mappings')}>
            Back to theme mapping
          </s-button>
        </s-section>
      </AppLayout>
    );
  }

  const theme = themes.data?.find((t) => t.id === mapping.themeId);
  const role = theme ? THEME_ROLE_BADGE[theme.role] : null;
  const lastSynced = commits.data?.lastSynced ?? null;
  const lastRun = last.data ?? null;
  const result = lastRun ? RESULT_BADGE[lastRun.status] : undefined;
  const neverSynced = !commits.loading && !last.loading && !lastSynced && !lastRun;
  const refresh = () => {
    mappings.reload();
    themes.reload();
    setRefreshKey((k) => k + 1);
  };

  const startSync = async (confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string; acceptDirectEdits?: boolean }) => {
    if (!preview) return;
    const run = await confirmSync.run({ syncId: preview.syncId, confirm: true, ...confirmation });
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
      subtitle={mapping.repository}
      backAction={{ content: 'Theme mapping', onAction: () => navigate('/mappings') }}
      secondaryActions={[{ content: 'Refresh', onAction: refresh }]}
      banners={
        <>
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
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
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            <s-stack gap="small-100">
              <s-text color="subdued">Branch</s-text>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type="git-branch" />
                <s-text type="strong">{mapping.branch}</s-text>
              </s-stack>
              <s-text color="subdued">{mapping.repository}</s-text>
            </s-stack>
            <s-stack gap="small-100">
              <s-text color="subdued">Shopify theme</s-text>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type="theme" />
                <s-text type="strong">{mapping.themeName}</s-text>
                {role && <s-badge tone={role.tone}>{role.label}</s-badge>}
              </s-stack>
              <s-text color="subdued">{`Theme ID ${mapping.themeId.split('/').pop()}`}</s-text>
            </s-stack>
          </s-grid>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <Tile label="Theme is on" hint={lastSynced ? formatDate(lastSynced.syncedAt) : 'No commit synced yet'}>
              <s-text type="strong">{lastSynced ? `${lastSynced.shortSha} ${firstLine(lastSynced.message)}` : '—'}</s-text>
            </Tile>
            <Tile label="Updates waiting" hint={lastSynced ? `new commits on ${mapping.branch}` : 'after the first sync'}>
              <s-text type="strong">
                {commits.loading && !commits.data ? '…' : lastSynced ? `${commits.data?.waiting ?? 0}${commits.data?.waitingMore ? '+' : ''}` : '—'}
              </s-text>
            </Tile>
            <Tile label="Last sync" hint={lastRun ? `${syncTypeLabel(lastRun.strategy)} · ${formatDate(lastRun.completedAt)}` : 'No sync performed yet'}>
              {lastRun && result ? <s-badge tone={result.tone}>{result.label}</s-badge> : <s-text type="strong">—</s-text>}
            </Tile>
            <Tile label="Mapped since">
              <s-text type="strong">{formatDate(mapping.createdAt)}</s-text>
            </Tile>
          </s-grid>
        </s-stack>
      </s-section>

      {neverSynced && (
        <s-banner tone="info" heading="Start with a full sync">
          <s-paragraph>
            {`${mapping.themeName} has not been synced from ${mapping.branch} yet. A full sync makes it match the branch; after that, sync only the new commits.`}
          </s-paragraph>
        </s-banner>
      )}
      {neverSynced && fullSync}

      <s-section heading="Sync commits">
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
