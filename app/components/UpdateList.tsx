import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDay, LINE_LABEL } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { ThemeLine, UpdateListItem } from '../lib/types';
import { CommitFiles } from './CommitFiles';
import { ErrorBanner } from './ErrorBanner';
import { ChangeCounts } from './FileList';
import { LoadingInline } from './LoadingState';

const PER_PAGE = 20;

interface Props {
  /** update: newest updates first. goback: the theme's update and earlier ones. */
  mode: 'update' | 'goback';
  /** A configured line (Staging / Live) … */
  line?: ThemeLine;
  /** … or any theme of the store. */
  themeId?: string;
  branch?: string;
  /** False for the published theme: it only receives Staging-verified updates. */
  canApply?: boolean;
}

function StateBadge({ item }: { item: UpdateListItem }) {
  if (item.state === 'new') return <s-badge tone="caution">New</s-badge>;
  if (item.state === 'current') return <s-badge tone="neutral">Current</s-badge>;
  return <s-text color="subdued">Earlier</s-text>;
}

/** Commits of a branch for one theme, marked NEW / CURRENT, with their files and an apply action. */
export function UpdateList({ mode, line = 'staging', themeId, branch, canApply = true }: Props) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pendingSha, setPendingSha] = useState<string | null>(null);
  const list = useApiQuery(
    () => api.updates.list({ line, themeId, branch, ref: mode === 'goback' ? 'current' : 'branch', page, perPage: PER_PAGE }),
    [line, themeId, branch, mode, page],
  );
  const plan = useMutation(api.updates.plan);
  const baseline = useMutation(api.updates.baseline);

  const toggle = (sha: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha);
      else next.add(sha);
      return next;
    });

  const select = async (item: UpdateListItem) => {
    setPendingSha(item.sha);
    const run = await plan.run(
      mode === 'update'
        ? { kind: 'update', targetSha: item.sha, themeId, branch }
        : { kind: 'rollback', targetSha: item.sha, line, themeId, branch },
    );
    setPendingSha(null);
    if (run) navigate(`/updates/${run.id}`);
  };

  const markCurrent = async (item: UpdateListItem) => {
    setPendingSha(item.sha);
    const run = await baseline.run({ line, sha: item.sha, themeId });
    setPendingSha(null);
    if (run) {
      showToast(`Recorded as running ${item.shortSha}`);
      list.reload();
    }
  };

  if (list.loading && !list.data) return <LoadingInline label="Loading updates…" />;
  const data = list.data;
  const noCurrent = !!data && !data.current;
  const themeLabel = data?.theme?.name ?? LINE_LABEL[line];

  return (
    <s-stack gap="base">
      <ErrorBanner error={list.error} onRetry={list.reload} />
      <ErrorBanner error={plan.error ?? baseline.error} heading="The update could not be prepared" onDismiss={plan.clearError} />
      {data && (
        <>
          <s-stack gap="small-300">
            <s-text type="strong">{`${themeLabel} · ${data.repository}${data.branch ? ` (${data.branch})` : ''}`}</s-text>
            <s-text color="subdued">
              {mode === 'update'
                ? data.current
                  ? data.currentFound
                    ? `${data.waiting}${data.waitingMore ? '+' : ''} ${data.waiting === 1 ? 'update' : 'updates'} waiting · click a commit to see its files`
                    : `Last synced ${data.current.shortSha} is not in the latest updates of this branch`
                  : `${themeLabel} has no last synced update yet`
                : data.current
                  ? `Currently on ${data.current.shortSha} ${firstLine(data.current.message)}`
                  : 'This theme has no last synced update yet'}
            </s-text>
          </s-stack>

          {!canApply && (
            <s-banner tone="info" heading="Staging before Live">
              <s-paragraph>
                The Live theme only receives updates that fully completed on Staging. Update Staging, test it, then use
                Publish to Live.
              </s-paragraph>
            </s-banner>
          )}
          {canApply && mode === 'update' && data.waiting > 1 && (
            <s-banner tone="info" heading="Pick the newest. Everything before it comes too.">
              <s-paragraph>
                Selecting the newest update applies all waiting updates together, in order, so no developer work is left out.
              </s-paragraph>
            </s-banner>
          )}
          {canApply && noCurrent && (
            <s-banner tone="warning" heading="No last synced update yet">
              <s-paragraph>
                {mode === 'update'
                  ? 'Choose "Update to this" to apply the complete theme from an update, or "Already running this" to record the update the theme already runs without changing any file.'
                  : 'Record which update this theme already runs first. Nothing in the theme changes.'}
              </s-paragraph>
            </s-banner>
          )}

          {data.items.length === 0 && <s-text color="subdued">No updates found.</s-text>}
          {data.items.map((item) => {
            const expanded = open.has(item.sha);
            const canSelect = canApply && (mode === 'update' ? item.state === 'new' : item.state === 'older' && !!data.current);
            return (
              <s-box key={item.sha} border="base" borderRadius="base" padding="base">
                <s-stack gap="small-200">
                  <s-grid gridTemplateColumns="5rem 1fr auto" gap="base" alignItems="center">
                    <s-text>{item.shortSha}</s-text>
                    <s-stack gap="small-300">
                      <s-text type={item.state === 'new' ? 'strong' : 'generic'}>{firstLine(item.message)}</s-text>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-text color="subdued">{`${formatDay(item.date)}${item.authorName ? ` · ${item.authorName}` : ''}`}</s-text>
                        {item.counts && <ChangeCounts {...item.counts} />}
                      </s-stack>
                    </s-stack>
                    <StateBadge item={item} />
                  </s-grid>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-button variant="tertiary" onClick={() => toggle(item.sha)}>
                      {expanded ? 'Hide files' : 'Show files'}
                    </s-button>
                    {canSelect && (
                      <s-button
                        variant="primary"
                        loading={pendingSha === item.sha && plan.pending}
                        disabled={!!pendingSha}
                        onClick={() => select(item)}
                      >
                        {mode === 'update' ? (line === 'staging' && !themeId ? 'Update Staging →' : 'Update to this →') : 'Go back to this →'}
                      </s-button>
                    )}
                    {canApply && noCurrent && (
                      <s-button loading={pendingSha === item.sha && baseline.pending} disabled={!!pendingSha} onClick={() => markCurrent(item)}>
                        Already running this
                      </s-button>
                    )}
                    {item.htmlUrl && (
                      <s-link href={item.htmlUrl} target="_blank">
                        View on GitHub
                      </s-link>
                    )}
                  </s-stack>
                  {expanded && (
                    <s-box padding="small" background="subdued" borderRadius="base">
                      <CommitFiles sha={item.sha} />
                    </s-box>
                  )}
                </s-stack>
              </s-box>
            );
          })}

          <s-stack direction="inline" gap="small-200">
            <s-button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Newer
            </s-button>
            <s-button disabled={!data.hasNextPage} onClick={() => setPage((p) => p + 1)}>
              Older
            </s-button>
          </s-stack>
        </>
      )}
    </s-stack>
  );
}
