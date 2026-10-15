import { api } from '../lib/api-client';
import { firstLine, formatDate, RESULT_BADGE, syncTypeLabel } from '../lib/format';
import { useApiQuery, useNavigateHandler } from '../lib/hooks';
import { ErrorBanner } from './ErrorBanner';

/**
 * "Last sync" of a theme (and branch): the most recent sync that produced a
 * recorded result. A job that was only created or is still running is not shown.
 */
export function LastSyncCard({
  themeId,
  branch,
  refreshKey = 0,
  compact = false,
}: {
  themeId: string;
  branch?: string;
  refreshKey?: number;
  /** One line with status, type, commit, files and date. */
  compact?: boolean;
}) {
  const go = useNavigateHandler();
  const last = useApiQuery(() => api.sync.last({ themeId, branch }), [themeId, branch, refreshKey]);

  if (last.loading && last.data === null) return <s-spinner accessibilityLabel="Loading the last sync" size="base" />;
  if (last.error) return <ErrorBanner error={last.error} heading="Last sync could not be loaded" onRetry={last.reload} />;
  const run = last.data;
  if (!run) {
    return <s-text color="subdued">{compact ? 'Last sync: no sync performed yet' : 'No sync performed yet.'}</s-text>;
  }

  const badge = RESULT_BADGE[run.status] ?? { label: run.status, tone: 'neutral' as const };
  const commits = run.commitsIncluded;
  const range =
    commits.length > 1
      ? `${commits[0]!.shortSha} … ${commits[commits.length - 1]!.shortSha} (${commits.length} commits)`
      : `${run.commitSha.slice(0, 7)} ${firstLine(run.commitMessage)}`;
  const processed = run.filesSucceeded + run.filesFailed;

  if (compact) {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text color="subdued">Last sync</s-text>
        <s-badge tone={badge.tone}>{badge.label}</s-badge>
        <s-text>{`${syncTypeLabel(run.strategy)} · ${range} · ${run.filesSucceeded} ok, ${run.filesFailed} failed · ${formatDate(run.completedAt)}`}</s-text>
        <s-button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
          Details
        </s-button>
      </s-stack>
    );
  }

  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-badge tone={badge.tone}>{badge.label}</s-badge>
        <s-text type="strong">{syncTypeLabel(run.strategy)}</s-text>
        <s-text color="subdued">{formatDate(run.completedAt)}</s-text>
      </s-stack>
      <s-grid gridTemplateColumns="10rem 1fr" gap="small-200">
        <s-text color="subdued">Repository · branch</s-text>
        <s-text>{`${run.repository} · ${run.branch ?? '—'}`}</s-text>
        <s-text color="subdued">Shopify theme</s-text>
        <s-text>{run.themeName}</s-text>
        <s-text color="subdued">{commits.length > 1 ? 'Commits' : 'Commit'}</s-text>
        <s-text>{range}</s-text>
        <s-text color="subdued">Files</s-text>
        <s-text>
          {`${processed} processed · ${run.filesSucceeded} succeeded · ${run.filesFailed} failed · ${run.filesSkipped} skipped · ${run.filesIgnored} ignored`}
        </s-text>
      </s-grid>
      <s-stack direction="inline">
        <s-button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
          View details
        </s-button>
      </s-stack>
    </s-stack>
  );
}
