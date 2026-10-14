import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { StoreHeader } from '../components/StoreHeader';
import { PublishedBadge } from '../components/ThemeBadges';
import { api } from '../lib/api-client';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import type { ThemeLineState } from '../lib/types';

function Row({ state, onAction }: { state: ThemeLineState; onAction: (e?: Event) => void }) {
  const isStaging = state.line === 'staging';
  return (
    <s-table-row>
      <s-table-cell>
        <s-stack gap="small-300">
          <s-text type="strong">{isStaging ? 'Staging' : 'Live'}</s-text>
          <s-text color="subdued">{state.configured?.name ?? 'Not selected'}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>{isStaging ? 'Updates land here first' : 'Customers see this'}</s-table-cell>
      <s-table-cell>{state.configured ? <PublishedBadge theme={state.theme} /> : <s-text color="subdued">—</s-text>}</s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text>{state.lastSynced?.shortSha ?? '—'}</s-text>
          {state.activeRun ? (
            <s-badge tone="info">Updating</s-badge>
          ) : state.waiting > 0 ? (
            <s-badge tone="caution">
              {isStaging
                ? `${state.waiting}${state.waitingMore ? '+' : ''} waiting`
                : `${state.waiting}${state.waitingMore ? '+' : ''} to publish`}
            </s-badge>
          ) : state.lastSynced ? (
            <s-badge tone="success">Up to date</s-badge>
          ) : null}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        {isStaging ? (
          <s-button variant="primary" disabled={!state.configured} onClick={onAction}>
            Select →
          </s-button>
        ) : (
          <s-button variant="tertiary" disabled={!state.configured} onClick={onAction}>
            Publish from Staging
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  );
}

/** Step 01 — choose a store and its Staging theme. */
export default function Themes() {
  const go = useNavigateHandler();
  const overview = useApiQuery(() => api.overview(), []);
  if (overview.loading && !overview.data) return <LoadingState title="Themes" />;
  const data = overview.data;

  return (
    <AppLayout
      title="Themes"
      secondaryActions={[
        { content: 'Refresh', onAction: () => api.overview(true).then(overview.setData).catch(() => overview.reload()) },
        { content: 'Go back to an earlier update', onAction: () => go('/go-back')() },
      ]}
      banners={<ErrorBanner error={overview.error} onRetry={overview.reload} />}
    >
      {data && (
        <s-section>
          <s-stack gap="base">
            <StoreHeader store={data.store} />
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Theme</s-table-header>
                <s-table-header>Role</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="secondary">Last synced</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                <Row state={data.staging} onAction={go('/updates')} />
                <Row state={data.live} onAction={go('/publish')} />
              </s-table-body>
            </s-table>
            <s-text color="subdued">
              Theme Sync never changes which theme is published in Shopify. It only updates the files of the theme you choose.
            </s-text>
          </s-stack>
        </s-section>
      )}
    </AppLayout>
  );
}
