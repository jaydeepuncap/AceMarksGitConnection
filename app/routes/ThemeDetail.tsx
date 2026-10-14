import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { PublishedBadge } from '../components/ThemeBadges';
import { UpdateList } from '../components/UpdateList';
import { api } from '../lib/api-client';
import { firstLine, formatDate, KIND_LABEL, STATUS_BADGE } from '../lib/format';
import { useApiQuery } from '../lib/hooks';
import { usePublishFromStaging } from '../lib/publish';
import { LineBadge } from './Themes';

/** Select value for "use the store's branch" (an empty option value is not reliable in <s-select>). */
const STORE_BRANCH = '__store_branch__';

function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <s-grid gridTemplateColumns="10rem 1fr" gap="base" alignItems="center">
      <s-text color="subdued">{label}</s-text>
      <s-box>{children}</s-box>
    </s-grid>
  );
}

/** One theme: its last synced update, the branch's commits and applying one of them. */
export default function ThemeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState('');
  const [mode, setMode] = useState<'update' | 'goback'>('update');
  const detail = useApiQuery(() => api.themes.get(id), [id]);
  const settings = useApiQuery(() => api.settings.get(), []);
  const branches = useApiQuery(() => api.github.branches({ perPage: 100 }), []);
  const storeBranchName = settings.data?.settings.branch ?? null;
  // The branch whose history is shown: the one selected, else the store's branch.
  const historyBranch = branch || storeBranchName || undefined;
  const history = useApiQuery(
    () => api.history({ themeId: id, perPage: 10, branch: historyBranch, includeUnknownBranch: !branch }),
    [id, historyBranch, branch],
    !settings.loading,
  );
  const publishOptions = useApiQuery(() => api.updates.publishOptions(), []);
  const publish = usePublishFromStaging();

  if (detail.loading && !detail.data) return <LoadingState title="Theme" />;
  const item = detail.data;
  const theme = item?.theme;
  const isLive = !!theme && (theme.isLive || item?.line === 'live');
  const storeBranch = settings.data?.settings.branch ?? '';
  const shopDomain = item?.activeRun?.shopDomain ?? settings.data?.shop.shopDomain ?? '';

  return (
    <AppLayout
      title={theme?.name ?? 'Theme'}
      backAction={{ content: 'Themes', onAction: () => navigate('/themes') }}
      banners={
        <>
          <ErrorBanner error={detail.error} onRetry={detail.reload} />
          <ErrorBanner error={publish.error} heading="The publish could not be prepared" onDismiss={publish.clearError} />
        </>
      }
    >
      {item && theme && (
        <>
          <s-section heading="Last synced update">
            <s-stack direction="inline" slot="secondary-actions" gap="small-200">
              <LineBadge line={item.line} />
              <PublishedBadge theme={theme} />
            </s-stack>
            <s-stack gap="base">
              {item.lastSynced ? (
                <>
                  <KeyValue label="Last synced update">
                    <s-text>
                      <s-text type="strong">{item.lastSynced.shortSha}</s-text> {firstLine(item.lastSynced.message)}
                    </s-text>
                  </KeyValue>
                  <s-divider />
                  <KeyValue label="Synced on">
                    <s-text>{formatDate(item.lastSynced.syncedAt)}</s-text>
                  </KeyValue>
                  {item.lastSynced.verifiedOnStagingAt && (
                    <>
                      <s-divider />
                      <KeyValue label="Verified on Staging">
                        <s-text>{formatDate(item.lastSynced.verifiedOnStagingAt)}</s-text>
                      </KeyValue>
                    </>
                  )}
                  <s-divider />
                  <KeyValue label="Full commit">
                    <s-text color="subdued">{item.lastSynced.sha}</s-text>
                  </KeyValue>
                </>
              ) : (
                <s-paragraph color="subdued">
                  No update has been synced to this theme yet (no assets/theme-sync.json). Pick an update below, or record the
                  one the theme already runs.
                </s-paragraph>
              )}
              <s-text color="subdued">Saved in Theme Sync and in the theme as assets/theme-sync.json after every complete update.</s-text>
              {shopDomain && (
                <s-stack direction="inline">
                  <s-button href={`https://${shopDomain}/?preview_theme_id=${theme.numericId}`} target="_blank">
                    Preview in Shopify ↗
                  </s-button>
                </s-stack>
              )}
            </s-stack>
          </s-section>

          {isLive && !item.activeRun && (() => {
            const verified = publishOptions.data?.verified ? publishOptions.data.update : null;
            if (!verified || verified.sha === item.lastSynced?.sha) return null;
            return (
              <s-banner tone="success" heading={`${verified.shortSha} is verified on Staging`}>
                <s-paragraph>{`${firstLine(verified.message)} fully completed on Staging. Publish the same update to ${theme.name}.`}</s-paragraph>
                <s-button slot="secondary-actions" loading={publish.pending} onClick={() => publish.start(verified.sha, theme.id)}>
                  Publish from Staging →
                </s-button>
              </s-banner>
            );
          })()}

          {item.activeRun && (
            <s-banner tone="info" heading="An update is running on this theme">
              <s-paragraph>{`${item.activeRun.progress.succeeded} of ${item.activeRun.progress.total} files updated.`}</s-paragraph>
              <s-button slot="secondary-actions" onClick={() => navigate(`/updates/${item.activeRun!.id}`)}>
                View progress
              </s-button>
            </s-banner>
          )}

          <s-section heading="Updates from GitHub">
            <s-stack gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
                <s-select
                  label="Branch"
                  value={branch || STORE_BRANCH}
                  details={branches.error ? branches.error.message : undefined}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setBranch(value === STORE_BRANCH ? '' : value);
                  }}
                >
                  <s-option value={STORE_BRANCH}>{storeBranch ? `${storeBranch} (store branch)` : 'Repository default'}</s-option>
                  {(branches.data?.items ?? [])
                    .filter((b) => b.name !== storeBranch)
                    .map((b) => (
                      <s-option key={b.name} value={b.name}>
                        {b.name}
                      </s-option>
                    ))}
                </s-select>
                <s-select label="Show" value={mode} onChange={(event) => setMode(event.currentTarget.value as 'update' | 'goback')}>
                  <s-option value="update">Newer updates</s-option>
                  <s-option value="goback">Go back to an earlier update</s-option>
                </s-select>
              </s-grid>
              <UpdateList
                key={`${mode}:${branch}`}
                mode={mode}
                themeId={theme.id}
                branch={mode === 'update' ? branch || undefined : undefined}
                canApply={mode === 'goback' || !isLive}
              />
            </s-stack>
          </s-section>

          <s-section heading={`Updates on this theme${historyBranch ? ` from ${historyBranch}` : ''}`}>
            {(history.data?.items ?? []).length === 0 ? (
              <s-text color="subdued">No updates yet.</s-text>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="secondary">Date</s-table-header>
                  <s-table-header listSlot="primary">What</s-table-header>
                  <s-table-header>Updated to</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header>Details</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {(history.data?.items ?? []).map((run) => (
                    <s-table-row key={run.id}>
                      <s-table-cell>{formatDate(run.confirmedAt)}</s-table-cell>
                      <s-table-cell>{KIND_LABEL[run.kind]}</s-table-cell>
                      <s-table-cell>{run.target?.shortSha ?? '—'}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={STATUS_BADGE[run.status].tone}>{STATUS_BADGE[run.status].label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button variant="tertiary" onClick={() => navigate(`/updates/${run.id}`)}>
                          Open
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>
        </>
      )}
    </AppLayout>
  );
}
