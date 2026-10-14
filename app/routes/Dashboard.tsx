import { useCallback } from 'react';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { firstLine, formatDate, SYNC_STATUS_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';

export default function Dashboard() {
  const go = useNavigateHandler();
  const load = useCallback(
    () => Promise.all([api.settings.get(), api.github.connection(), api.sync.history({ perPage: 5 })]),
    [],
  );
  const { data, error, loading, reload } = useApiQuery(load, []);

  if (loading && !data) return <LoadingState title="Dashboard" />;

  const [settingsRes, github, history] = data ?? [null, null, null];
  const shop = settingsRes?.shop;
  const settings = settingsRes?.settings;

  return (
    <AppLayout
      title="Dashboard"
      primaryAction={{ content: 'Sync a commit', onAction: go('/commits'), disabled: !github?.connected }}
      banners={<ErrorBanner error={error} onRetry={reload} />}
    >
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
        <s-section heading="Shopify store">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{shop?.shopDomain ?? '—'}</s-text>
              {shop && (
                <s-badge tone={shop.status === 'installed' ? 'success' : 'critical'}>
                  {shop.status === 'installed' ? 'Connected' : 'Not installed'}
                </s-badge>
              )}
            </s-stack>
            <s-stack direction="inline" gap="small-200">
              <s-badge tone={shop?.canReadThemes ? 'success' : 'critical'}>
                {shop?.canReadThemes ? 'Can read themes' : 'Missing read_themes'}
              </s-badge>
              <s-badge tone={shop?.canWriteThemes ? 'success' : 'warning'}>
                {shop?.canWriteThemes ? 'Can write themes' : 'Missing write_themes'}
              </s-badge>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="GitHub">
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={github?.connected ? 'success' : 'caution'}>
                {github?.connected ? 'Connected' : 'Not connected'}
              </s-badge>
            </s-stack>
            <s-paragraph>
              {github?.connection
                ? `Signed in as ${github.connection.accountLogin}`
                : 'Add a personal access token in Settings.'}
            </s-paragraph>
            {!github?.connected && (
              <s-stack direction="inline">
                <s-button onClick={go('/settings')}>Connect GitHub</s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Repository">
          <s-stack gap="small-200">
            <s-text type="strong">{settings?.defaultRepository ?? 'No repository selected'}</s-text>
            <s-text color="subdued">Default branch: {settings?.defaultBranch ?? '—'}</s-text>
            <s-stack direction="inline">
              <s-button onClick={go('/repositories')} disabled={!github?.connected}>
                Choose repository
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="Target theme">
          <s-stack gap="small-200">
            <s-text type="strong">{settings?.defaultThemeName ?? 'No theme selected'}</s-text>
            <s-text color="subdued">
              Push:{' '}
              {settings?.syncPreferences.strategy === 'full_snapshot'
                ? 'Full snapshot'
                : settings?.syncPreferences.strategy === 'commit_changes'
                  ? 'Only the selected commit'
                  : 'From the last sync to the selected commit'}
              {' · '}Deletions {settings?.syncPreferences.allowDeletes ? 'allowed' : 'disabled'}
            </s-text>
            <s-stack direction="inline">
              <s-button onClick={go('/themes')}>Choose theme</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-grid>

      <s-section heading="Recent synchronizations">
        <s-button slot="secondary-actions" variant="tertiary" onClick={go('/sync-history')}>
          View all
        </s-button>
        {history && history.items.length === 0 ? (
          <s-paragraph color="subdued">No syncs yet. Pick a commit to preview your first sync.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Commit → theme</s-table-header>
              <s-table-header listSlot="secondary">Started</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {history?.items.map((run) => (
                <s-table-row key={run.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">
                        {run.commitSha.slice(0, 7)} → {run.themeName}
                      </s-text>
                      <s-text color="subdued">{firstLine(run.commitMessage)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{formatDate(run.initiatedAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={SYNC_STATUS_BADGE[run.status].tone}>{SYNC_STATUS_BADGE[run.status].label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
                      View
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </AppLayout>
  );
}
