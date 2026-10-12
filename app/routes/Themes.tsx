import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';

export default function Themes() {
  const go = useNavigateHandler();
  const themes = useApiQuery(() => api.themes.list(), []);
  const settings = useApiQuery(() => api.settings.get(), []);
  const select = useMutation(api.settings.update);

  if (themes.loading && !themes.data) return <LoadingState title="Themes" />;

  const current = settings.data?.settings.defaultThemeId;
  const items = themes.data ?? [];

  const choose = async (id: string, name: string) => {
    const result = await select.run({ defaultThemeId: id });
    if (result) {
      settings.setData(result);
      showToast(`Target theme set to ${name}`);
    }
  };

  return (
    <AppLayout
      title="Themes"
      subtitle="Pick the theme that syncs write to by default"
      secondaryActions={[{ content: 'Refresh', onAction: () => themes.reload() }]}
      banners={
        <>
          <ErrorBanner error={themes.error} onRetry={themes.reload} />
          <ErrorBanner error={select.error} heading="Theme could not be selected" onDismiss={select.clearError} />
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
              <s-table-header listSlot="labeled">Updated</s-table-header>
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
                          {current === theme.id && <s-badge tone="success">Default target</s-badge>}
                          {theme.processing && <s-badge tone="caution">Processing</s-badge>}
                          {theme.processingFailed && <s-badge tone="critical">Processing failed</s-badge>}
                        </s-stack>
                        <s-text color="subdued">ID {theme.numericId}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={role.tone}>{role.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{formatDate(theme.updatedAt)}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          disabled={!theme.writable || current === theme.id}
                          loading={select.pending}
                          tone={theme.isLive ? 'critical' : 'auto'}
                          accessibilityLabel={`Use ${theme.name} as target theme`}
                          onClick={() => choose(theme.id, theme.name)}
                        >
                          {theme.isLive ? 'Target live theme' : 'Use as target'}
                        </s-button>
                        <s-button
                          variant="tertiary"
                          disabled={!theme.writable}
                          onClick={go(`/commits?themeId=${encodeURIComponent(theme.id)}`)}
                        >
                          Sync a commit
                        </s-button>
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
