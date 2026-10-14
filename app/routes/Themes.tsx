import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { StoreHeader } from '../components/StoreHeader';
import { PublishedBadge } from '../components/ThemeBadges';
import { api } from '../lib/api-client';
import { firstLine, formatDate, STATUS_BADGE } from '../lib/format';
import { useApiQuery } from '../lib/hooks';
import type { ThemeOverviewItem } from '../lib/types';

export const themePath = (themeId: string) => `/themes/${themeId.split('/').pop()}`;

/** The published theme is the Live theme; every other theme is a test theme. */
export function RoleText({ theme }: { theme: ThemeOverviewItem['theme'] }) {
  return <s-text color="subdued">{theme.isLive ? 'Live · customers see this' : 'Test theme'}</s-text>;
}

/** Step 01 — every theme of the store with the update it last synced. */
export default function Themes() {
  const navigate = useNavigate();
  const overview = useApiQuery(() => api.overview(), []);
  const themes = useApiQuery(() => api.themes.overview(), []);

  if (themes.loading && !themes.data) return <LoadingState title="Themes" />;
  const refresh = () => api.themes.overview(true).then(themes.setData).catch(() => themes.reload());

  return (
    <AppLayout
      title="Themes"
      secondaryActions={[{ content: 'Refresh', onAction: refresh, loading: themes.loading }]}
      banners={<ErrorBanner error={themes.error} onRetry={themes.reload} />}
    >
      <s-section>
        <s-stack gap="base">
          <StoreHeader store={overview.data?.store ?? null} />
          {!!overview.data?.setupMissing.length && (
            <s-banner tone="info" heading="Finish the one-time setup">
              <s-unordered-list>
                {overview.data.setupMissing.map((step) => (
                  <s-list-item key={step}>{step}</s-list-item>
                ))}
              </s-unordered-list>
              <s-button slot="secondary-actions" onClick={() => navigate('/settings')}>
                Open settings
              </s-button>
            </s-banner>
          )}
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Theme</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="secondary">Last synced</s-table-header>
              <s-table-header>Last update</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {(themes.data ?? []).map((item) => (
                <s-table-row key={item.theme.id} clickDelegate={`open-${item.theme.numericId}`}>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text type="strong">{item.theme.name}</s-text>
                      <RoleText theme={item.theme} />
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <PublishedBadge theme={item.theme} />
                      {item.theme.processing && <s-badge tone="caution">Processing</s-badge>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {item.lastSynced ? (
                      <s-stack gap="small-300">
                        <s-text>
                          <s-text type="strong">{item.lastSynced.shortSha}</s-text> {firstLine(item.lastSynced.message)}
                        </s-text>
                        <s-text color="subdued">{formatDate(item.lastSynced.syncedAt)}</s-text>
                      </s-stack>
                    ) : (
                      <s-text color="subdued">No sync yet</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {item.activeRun ? (
                      <s-badge tone="info">{`Updating ${item.activeRun.progress.succeeded}/${item.activeRun.progress.total}`}</s-badge>
                    ) : item.lastRun ? (
                      <s-badge tone={STATUS_BADGE[item.lastRun.status].tone}>{STATUS_BADGE[item.lastRun.status].label}</s-badge>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button id={`open-${item.theme.numericId}`} variant="tertiary" onClick={() => navigate(themePath(item.theme.id))}>
                      Open →
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-text color="subdued">
            Test an update on any unpublished theme; once it fully completes it can be published to the Live (published)
            theme. Each theme records its last synced update in assets/theme-sync.json. Theme Sync never changes which theme
            is published in Shopify.
          </s-text>
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
