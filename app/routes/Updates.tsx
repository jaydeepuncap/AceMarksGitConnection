import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { CommitFiles } from '../components/CommitFiles';
import { ErrorBanner } from '../components/ErrorBanner';
import { ChangeCounts } from '../components/FileList';
import { LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { firstLine, formatDay, LINE_LABEL } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { ThemeLine, UpdateListItem } from '../lib/types';

const PER_PAGE = 20;

interface Props {
  /** update: newest updates for Staging. goback: the theme's update and earlier ones. */
  mode: 'update' | 'goback';
}

function StateBadge({ item }: { item: UpdateListItem }) {
  if (item.state === 'new') return <s-badge tone="caution">New</s-badge>;
  if (item.state === 'current') return <s-badge tone="neutral">Current</s-badge>;
  return <s-text color="subdued">Earlier</s-text>;
}

/** Step 02 (choose an update) and "Going back to an earlier version". */
export default function Updates({ mode }: Props) {
  const navigate = useNavigate();
  const go = useNavigateHandler();
  const [line, setLine] = useState<ThemeLine>('staging');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const activeLine: ThemeLine = mode === 'update' ? 'staging' : line;
  const list = useApiQuery(
    () => api.updates.list({ line: activeLine, ref: mode === 'goback' ? 'current' : 'branch', page, perPage: PER_PAGE }),
    [activeLine, mode, page],
  );
  const plan = useMutation(api.updates.plan);
  const baseline = useMutation(api.updates.baseline);
  const [pendingSha, setPendingSha] = useState<string | null>(null);

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
      mode === 'update' ? { kind: 'update', targetSha: item.sha } : { kind: 'rollback', targetSha: item.sha, line: activeLine },
    );
    setPendingSha(null);
    if (run) navigate(`/updates/${run.id}`);
  };

  const markCurrent = async (item: UpdateListItem) => {
    setPendingSha(item.sha);
    const run = await baseline.run({ line: activeLine, sha: item.sha });
    setPendingSha(null);
    if (run) {
      showToast(`${LINE_LABEL[activeLine]} recorded as running ${item.shortSha}`);
      list.reload();
    }
  };

  if (list.loading && !list.data) return <LoadingState title={mode === 'update' ? 'Updates' : 'Go back'} />;
  const data = list.data;
  const noCurrent = !!data && !data.current;
  const title = mode === 'update' ? 'Updates for Staging' : `Go back on ${LINE_LABEL[activeLine]}`;

  return (
    <AppLayout
      title={title}
      backAction={{ content: 'Themes', onAction: () => navigate('/themes') }}
      secondaryActions={[{ content: 'Refresh', onAction: list.reload, loading: list.loading }]}
      banners={
        <>
          <ErrorBanner error={list.error} onRetry={list.reload} />
          <ErrorBanner error={plan.error ?? baseline.error} heading="The update could not be prepared" onDismiss={plan.clearError} />
        </>
      }
    >
      {mode === 'goback' && (
        <s-section>
          <s-stack gap="base">
            <s-paragraph>
              Return Staging or Live to any earlier update. Every change made after it is fully undone, with the same review,
              checks and backup as any other update. Brand settings and theme-editor content are not affected.
            </s-paragraph>
            <s-box inlineSize="240px">
              <s-select
                label="Theme"
                value={line}
                onChange={(event) => {
                  setLine(event.currentTarget.value as ThemeLine);
                  setPage(1);
                }}
              >
                <s-option value="staging">Staging</s-option>
                <s-option value="live">Live</s-option>
              </s-select>
            </s-box>
          </s-stack>
        </s-section>
      )}

      {data && (
        <s-section>
          <s-stack gap="base">
            <s-stack gap="small-300">
              <s-text type="strong">{`${data.theme?.name ?? LINE_LABEL[activeLine]} · ${data.repository}${data.branch ? ` (${data.branch})` : ''}`}</s-text>
              <s-text color="subdued">
                {mode === 'update'
                  ? data.current
                    ? `${data.waiting}${data.waitingMore ? '+' : ''} ${data.waiting === 1 ? 'update' : 'updates'} waiting · click a commit to see its files`
                    : 'Staging has no last synced update yet'
                  : data.current
                    ? `Currently on ${data.current.shortSha} ${firstLine(data.current.message)}`
                    : 'This theme has no last synced update yet'}
              </s-text>
            </s-stack>

            {mode === 'update' && data.waiting > 1 && (
              <s-banner tone="info" heading="Pick the newest. Everything before it comes too.">
                <s-paragraph>
                  Selecting the newest update applies all waiting updates together, in order, so no developer work is left out.
                </s-paragraph>
              </s-banner>
            )}
            {noCurrent && (
              <s-banner tone="warning" heading="No last synced update yet">
                <s-paragraph>
                  {mode === 'update'
                    ? 'Choose "Update Staging" to apply the complete theme from an update, or, if the theme already runs one of these updates, choose "Already running this" to record it without changing any file.'
                    : 'Record which update this theme already runs first. Nothing in the theme changes.'}
                </s-paragraph>
              </s-banner>
            )}
            {mode === 'update' && !data.currentFound && data.current && (
              <s-banner tone="warning">
                <s-paragraph>
                  {`The update Staging runs (${data.current.shortSha}) is not in the latest ${data.waitingMore ? 300 : data.waiting} updates of this branch.`}
                </s-paragraph>
              </s-banner>
            )}

            {data.items.length === 0 && <s-text color="subdued">No updates found.</s-text>}
            {data.items.map((item) => {
              const expanded = open.has(item.sha);
              const canSelect =
                mode === 'update' ? item.state === 'new' : item.state === 'older' && !!data.current;
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
                    <s-stack direction="inline" gap="small-200">
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
                          {mode === 'update' ? 'Update Staging →' : 'Go back to this →'}
                        </s-button>
                      )}
                      {noCurrent && (
                        <s-button
                          loading={pendingSha === item.sha && baseline.pending}
                          disabled={!!pendingSha}
                          onClick={() => markCurrent(item)}
                        >
                          Already running this
                        </s-button>
                      )}
                      <s-link href={item.htmlUrl} target="_blank">
                        View on GitHub
                      </s-link>
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
            {mode === 'update' && (
              <s-stack direction="inline">
                <s-button variant="tertiary" onClick={go('/go-back')}>
                  Go back to an earlier update instead
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}
    </AppLayout>
  );
}
