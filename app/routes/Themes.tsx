import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { firstLine, formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import type { ThemeMapping } from '../lib/types';

/** Every theme in the store, the branch it receives and the commit it is on. */
export default function Themes() {
  const go = useNavigateHandler();
  const themes = useApiQuery(() => api.themes.list(), []);
  const onCommit = useApiQuery(() => api.themes.lastSynced(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const settings = useApiQuery(() => api.settings.get(), []);

  if (themes.loading && !themes.data) return <LoadingState title="Themes" />;

  const items = themes.data ?? [];
  const repository = settings.data?.settings.defaultRepository?.toLowerCase() ?? '';
  const sameRepo = (m: ThemeMapping) => m.repository.toLowerCase() === repository;

  return (
    <AppLayout
      title="Themes"
      subtitle="Every theme in the store and the branch it receives"
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => (themes.reload(), onCommit.reload(), mappings.reload()),
        },
      ]}
      banners={
        <>
          <ErrorBanner error={themes.error} onRetry={themes.reload} />
          {settings.data && !settings.data.shop.canWriteThemes && (
            <s-banner tone="warning" heading="Theme write access not granted">
              <s-paragraph>
                The app can list themes but cannot change their files until the write_themes scope is granted.
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
              <s-table-header listSlot="secondary">Receives</s-table-header>
              <s-table-header listSlot="labeled">Theme is on</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((t) => {
                const m = mappings.data?.items.find((x) => x.themeId === t.id);
                const role = THEME_ROLE_BADGE[t.role];
                const on = onCommit.data?.[t.id];
                return (
                  <s-table-row key={t.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text type="strong">{t.name}</s-text>
                          {t.processing && <s-badge tone="caution">Processing</s-badge>}
                          {t.processingFailed && <s-badge tone="critical">Processing failed</s-badge>}
                        </s-stack>
                        <s-text color="subdued">{`ID ${t.numericId}`}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={role.tone}>{role.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {m ? (
                        <s-stack direction="inline" gap="small-100" alignItems="center">
                          <s-icon type="git-branch" />
                          <s-text>{sameRepo(m) ? m.branch : `${m.repository} · ${m.branch}`}</s-text>
                        </s-stack>
                      ) : (
                        <s-text color="subdued">{t.writable ? 'Not mapped' : 'Cannot be synced'}</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {on ? (
                        <s-stack gap="none">
                          <s-text>{`${on.shortSha} · ${firstLine(on.message)}`}</s-text>
                          <s-text color="subdued">{`${on.branch} · ${formatDate(on.syncedAt)}`}</s-text>
                        </s-stack>
                      ) : (
                        <s-text color="subdued">No sync yet</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {m && sameRepo(m) ? (
                        <s-button variant="tertiary" onClick={go(`/mappings/${m.id}`)}>
                          Open mapping
                        </s-button>
                      ) : !m && t.writable ? (
                        <s-button variant="tertiary" onClick={go(`/mappings?themeId=${encodeURIComponent(t.id)}`)}>
                          Map a branch
                        </s-button>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
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
