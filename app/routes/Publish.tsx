import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { PublishedBadge } from '../components/ThemeBadges';
import { api } from '../lib/api-client';
import { firstLine, formatDate } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';

/** Step 07 — select the Live theme and publish the Staging-verified update. */
export default function Publish() {
  const navigate = useNavigate();
  const options = useApiQuery(() => api.updates.publishOptions(), []);
  const plan = useMutation(api.updates.plan);
  const [themeId, setThemeId] = useState('');

  useEffect(() => {
    if (options.data?.defaultThemeId && !themeId) setThemeId(options.data.defaultThemeId);
  }, [options.data, themeId]);

  if (options.loading && !options.data) return <LoadingState title="Publish to Live" />;
  const data = options.data;
  const selected = data?.themes.find((t) => t.theme.id === themeId);
  const alreadyThere = !!selected && selected.lastSynced?.sha === data?.update?.sha;

  const review = async () => {
    if (!data?.update || !themeId) return;
    const run = await plan.run({ kind: 'publish', targetSha: data.update.sha, themeId });
    if (run) navigate(`/updates/${run.id}`);
  };

  return (
    <AppLayout
      title="Publish to Live"
      subtitle="Applies the update already verified on Staging to the theme you select"
      backAction={{ content: 'Themes', onAction: () => navigate('/themes') }}
      banners={
        <>
          <ErrorBanner error={options.error} onRetry={options.reload} />
          <ErrorBanner error={plan.error} heading="The publish could not be prepared" onDismiss={plan.clearError} />
        </>
      }
    >
      {data && (
        <>
          <s-section>
            <s-stack gap="base">
              <s-grid gridTemplateColumns="10rem 1fr" gap="base" alignItems="center">
                <s-text color="subdued">Update</s-text>
                {data.update ? (
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text>
                      <s-text type="strong">{data.update.shortSha}</s-text> {firstLine(data.update.message)}
                    </s-text>
                    {data.verified ? (
                      <s-badge tone="success">Verified on Staging</s-badge>
                    ) : (
                      <s-badge tone="warning">Not verified</s-badge>
                    )}
                  </s-stack>
                ) : (
                  <s-text color="subdued">Staging has no update yet</s-text>
                )}
              </s-grid>
              {data.verified && data.update?.verifiedOnStagingAt && (
                <s-text color="subdued">{`Fully completed on Staging ${formatDate(data.update.verifiedOnStagingAt)}`}</s-text>
              )}
              <s-banner tone={data.verified ? 'info' : 'warning'} heading="Only Staging-verified updates can be published">
                <s-paragraph>
                  {data.reason ??
                    'Publish to Live is available only for updates that fully completed on this store’s Staging theme.'}
                </s-paragraph>
              </s-banner>
            </s-stack>
          </s-section>

          <s-section heading="Select the Live theme">
            <s-stack gap="base">
              <s-choice-list
                label="Live theme"
                labelAccessibilityVisibility="exclusive"
                values={themeId ? [themeId] : []}
                onChange={(event) => setThemeId(event.currentTarget.values[0] ?? '')}
              >
                {data.themes.map((option) => (
                  <s-choice key={option.theme.id} value={option.theme.id} selected={option.theme.id === themeId}>
                    {`${option.theme.name} · on ${option.lastSynced?.shortSha ?? 'no update yet'}`}
                    <s-text slot="details">
                      {option.theme.isLive ? 'Published' : 'Unpublished'}
                      {option.isConfiguredLive ? ' · Live theme in Settings' : ''}
                    </s-text>
                  </s-choice>
                ))}
              </s-choice-list>
              {selected && (
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text>{selected.theme.name}</s-text>
                  <PublishedBadge theme={selected.theme} />
                </s-stack>
              )}
              {alreadyThere && (
                <s-banner tone="success">
                  <s-paragraph>This theme already runs this update.</s-paragraph>
                </s-banner>
              )}
              <s-paragraph color="subdued">
                Theme Sync runs the same checks, saves a backup of the Live theme&apos;s affected files, then applies the
                update. You see every file before anything changes.
              </s-paragraph>
              <s-stack direction="inline" gap="small-200" justifyContent="end">
                <s-button onClick={() => navigate('/')}>Cancel</s-button>
                <s-button
                  variant="primary"
                  loading={plan.pending}
                  disabled={!data.verified || !themeId || alreadyThere}
                  onClick={review}
                >
                  Check and review →
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </>
      )}
    </AppLayout>
  );
}
