import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { StoreHeader } from '../components/StoreHeader';
import { PublishedBadge } from '../components/ThemeBadges';
import { api } from '../lib/api-client';
import { firstLine, formatDate, plural, STATUS_BADGE } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import type { ThemeLineState } from '../lib/types';

function LineCard({ state, onOpen, action }: { state: ThemeLineState; onOpen: (e?: Event) => void; action: string }) {
  const isStaging = state.line === 'staging';
  const waitingLabel = isStaging
    ? `${state.waiting}${state.waitingMore ? '+' : ''} ${state.waiting === 1 ? 'update' : 'updates'} waiting`
    : `${state.waiting}${state.waitingMore ? '+' : ''} ${state.waiting === 1 ? 'update' : 'updates'} to publish`;
  return (
    <s-section heading={isStaging ? 'Staging theme' : 'Live theme'}>
      <s-stack gap="base">
        <s-text color="subdued">
          {isStaging
            ? 'Unpublished. Receives every update first. Backup before every update.'
            : 'Published. Staging-verified updates only. Backup before every publish.'}
        </s-text>
        {!state.configured ? (
          <s-banner tone="warning">
            <s-paragraph>{`No ${isStaging ? 'Staging' : 'Live'} theme is selected yet. Choose it in Settings.`}</s-paragraph>
          </s-banner>
        ) : (
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{state.configured.name}</s-text>
              <PublishedBadge theme={state.theme} />
            </s-stack>
            <s-paragraph>
              <s-text color="subdued">Last synced: </s-text>
              {state.lastSynced ? (
                <>
                  <s-text type="strong">{state.lastSynced.shortSha}</s-text> {firstLine(state.lastSynced.message)}
                  <s-text color="subdued">{` · ${formatDate(state.lastSynced.syncedAt)}`}</s-text>
                </>
              ) : (
                <s-text color="subdued">no update yet</s-text>
              )}
            </s-paragraph>
            {state.activeRun ? (
              <s-badge tone="info">{`Updating ${state.activeRun.progress.succeeded}/${state.activeRun.progress.total}`}</s-badge>
            ) : state.waiting > 0 ? (
              <s-badge tone="caution">{waitingLabel}</s-badge>
            ) : state.lastSynced ? (
              <s-badge tone="success">Up to date</s-badge>
            ) : null}
            {state.lastRun && state.lastRun.status !== 'succeeded' && !state.activeRun && (
              <s-text color="subdued">
                {`Last run: ${STATUS_BADGE[state.lastRun.status].label} · ${formatDate(state.lastRun.confirmedAt)}`}
              </s-text>
            )}
          </s-stack>
        )}
        <s-stack direction="inline">
          <s-button onClick={onOpen} disabled={!state.configured}>
            {action}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function Dashboard() {
  const go = useNavigateHandler();
  const overview = useApiQuery(() => api.overview(), []);

  if (overview.loading && !overview.data) return <LoadingState title="Theme Sync" />;
  const data = overview.data;

  return (
    <AppLayout
      title="Theme Sync"
      subtitle="Staging first. Live when you say so."
      primaryAction={{ content: 'Choose an update', onAction: () => go('/updates')(), disabled: !data || data.setupMissing.length > 0 }}
      secondaryActions={[{ content: 'Refresh', onAction: overview.reload, loading: overview.loading }]}
      banners={<ErrorBanner error={overview.error} onRetry={overview.reload} />}
    >
      {data && (
        <>
          <s-section>
            <s-stack gap="base">
              <StoreHeader
                store={data.store}
                subtitle={`${data.store.shopDomain}${data.repository ? ` · ${data.repository}${data.branch ? ` (${data.branch})` : ''}` : ''}`}
              />
              {data.notices.map((notice) => (
                <s-banner key={notice} tone="warning">
                  <s-paragraph>{notice}</s-paragraph>
                </s-banner>
              ))}
              {data.setupMissing.length > 0 && (
                <s-banner tone="info" heading="Finish the one-time setup">
                  <s-unordered-list>
                    {data.setupMissing.map((step) => (
                      <s-list-item key={step}>{step}</s-list-item>
                    ))}
                  </s-unordered-list>
                  <s-button slot="secondary-actions" onClick={go('/settings')}>
                    Open settings
                  </s-button>
                </s-banner>
              )}
              {data.publishable && !data.live.activeRun && (
                <s-banner tone="success" heading={`${data.publishable.shortSha} is verified on Staging`}>
                  <s-paragraph>
                    {`${firstLine(data.publishable.message)} fully completed on Staging. Test it there, then publish it to Live.`}
                  </s-paragraph>
                  <s-button slot="secondary-actions" onClick={go('/publish')}>
                    Publish to Live
                  </s-button>
                </s-banner>
              )}
            </s-stack>
          </s-section>

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
            <LineCard
              state={data.staging}
              action={data.staging.activeRun ? 'View progress' : 'Choose an update'}
              onOpen={data.staging.activeRun ? go(`/updates/${data.staging.activeRun.id}`) : go('/updates')}
            />
            <LineCard
              state={data.live}
              action={data.live.activeRun ? 'View progress' : 'Publish from Staging'}
              onOpen={data.live.activeRun ? go(`/updates/${data.live.activeRun.id}`) : go('/publish')}
            />
          </s-grid>

          <s-section heading="How it works">
            <s-ordered-list>
              <s-list-item>Your developer saves an update in the master GitHub repository.</s-list-item>
              <s-list-item>You choose the update; automatic checks look for code errors and direct edits.</s-list-item>
              <s-list-item>You review every file, confirm, and Staging is updated after a backup.</s-list-item>
              <s-list-item>You test Staging in Shopify, then publish the same update to Live.</s-list-item>
            </s-ordered-list>
            <s-paragraph color="subdued">
              {`Protected brand settings and theme-editor content are never replaced. ${plural(data.staging.waiting, 'update')} waiting for Staging.`}
            </s-paragraph>
          </s-section>
        </>
      )}
    </AppLayout>
  );
}
