import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { firstLine, formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';

export default function Themes() {
  const go = useNavigateHandler();
  const themes = useApiQuery(() => api.themes.list(), []);
  const lastSynced = useApiQuery(() => api.themes.lastSynced(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const settings = useApiQuery(() => api.settings.get(), []);

  if (themes.loading && !themes.data) return <LoadingState title="Themes" />;

  const items = themes.data ?? [];


  return (
    <AppLayout
      title="Themes"
      subtitle="Every theme in the store, the branch it is mapped to and its last update"
      secondaryActions={[{ content: 'Refresh', onAction: () => themes.reload() }]}
      banners={
        <>
          <ErrorBanner error={themes.error} onRetry={themes.reload} />
          {settings.data && !settings.data.shop.canWriteThemes && (
            <s-banner tone="warning" heading="Theme write access not granted">
              <s-paragraph>
                The app can list themes but cannot modify files until the write_themes scope is granted.
              </s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      <s-section padding="none" accessibilityLabel="Themes">
        {items.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">This store has no online store themes.</s-paragraph>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Theme</s-table-header>
              <s-table-header listSlot="inline">Role</s-table-header>
              <s-table-header listSlot="labeled">Mapped branch</s-table-header>
              <s-table-header listSlot="labeled">Last update</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((theme) => {
                const role = THEME_ROLE_BADGE[theme.role];
                return (
                  <s-table-row key={theme.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text type="strong">{theme.name}</s-text>
                          {theme.processing && <s-badge tone="caution">Processing</s-badge>}
                          {theme.processingFailed && <s-badge tone="critical">Processing failed</s-badge>}
                        </s-stack>
                        <s-text color="subdued">ID {theme.numericId}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={role.tone}>{role.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {(() => {
                        const m = mappings.data?.items.find((x) => x.themeId === theme.id);
                        return m ? (
                          <s-text>
                            <s-text type="strong">{m.branch}</s-text>
                          </s-text>
                        ) : (
                          <s-text color="subdued">Not mapped</s-text>
                        );
                      })()}
                    </s-table-cell>
                    <s-table-cell>
                      {lastSynced.data?.[theme.id] ? (
                        <s-stack gap="none">
                          <s-text>
                            <s-text type="strong">{lastSynced.data[theme.id]!.shortSha}</s-text>{' '}
                            {firstLine(lastSynced.data[theme.id]!.message)}
                          </s-text>
                          <s-text color="subdued">{`${lastSynced.data[theme.id]!.branch} · ${formatDate(lastSynced.data[theme.id]!.syncedAt)}`}</s-text>
                        </s-stack>
                      ) : (
                        <s-text color="subdued">No sync yet</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        {mappings.data?.items.some((x) => x.themeId === theme.id) ? (
                          <s-button
                            variant="tertiary"
                            disabled={!theme.writable}
                            onClick={go(`/commits?themeId=${encodeURIComponent(theme.id)}`)}
                          >
                            Sync commits →
                          </s-button>
                        ) : (
                          <s-button
                            variant="tertiary"
                            disabled={!theme.writable}
                            onClick={go(`/mappings?themeId=${encodeURIComponent(theme.id)}`)}
                          >
                            Map a branch →
                          </s-button>
                        )}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </AppLayout>
  );
}
