import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { LastSyncCard } from '../components/LastSyncCard';
import { LoadingInline, LoadingState } from '../components/LoadingState';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { FILE_STATUS_BADGE, firstLine, formatDate, SYNC_STATUS_BADGE, type Tone } from '../lib/format';
import { useApiQuery, useMutation, useNavigateHandler } from '../lib/hooks';
import type { CommitSyncStatus, SyncPreview, SyncStrategy } from '../lib/types';

const COMMITS_PER_PAGE = 20;
const FILES_PER_PAGE = 100;
/** Select values for "no choice" — an empty option value is not reliable in <s-select>. */
const DEFAULT_BRANCH = '__default__';

const SYNC_STATUS: Record<CommitSyncStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'info' },
  last_synced: { label: 'Last synced', tone: 'success' },
  added: { label: 'Added', tone: 'neutral' },
};

/** Sync history of the selected theme and branch. */
function ThemeBranchHistory({ themeId, branch, themeName }: { themeId: string; branch: string; themeName: string }) {
  const go = useNavigateHandler();
  const [page, setPage] = useState(1);
  const history = useApiQuery(
    () => api.sync.history({ themeId, branch: branch || undefined, page, perPage: 10 }),
    [themeId, branch, page],
  );
  const items = history.data?.items ?? [];
  return (
    <s-section heading={`Sync history · ${themeName}${branch ? ` · ${branch}` : ''}`}>
      <s-stack gap="base">
        <ErrorBanner error={history.error} onRetry={history.reload} heading="History could not be loaded" />
        {!history.loading && items.length === 0 ? (
          <s-paragraph color="subdued">No syncs to this theme from this branch yet.</s-paragraph>
        ) : (
          <s-table
            variant="auto"
            loading={history.loading}
            paginate
            hasPreviousPage={page > 1}
            hasNextPage={!!history.data?.hasNextPage}
            onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setPage((p) => p + 1)}
          >
            <s-table-header-row>
              <s-table-header listSlot="labeled">Date</s-table-header>
              <s-table-header listSlot="primary">Updated to</s-table-header>
              <s-table-header>Updates</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Files</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((run) => {
                const badge = SYNC_STATUS_BADGE[run.status];
                return (
                  <s-table-row key={run.id}>
                    <s-table-cell>{formatDate(run.startedAt ?? run.initiatedAt)}</s-table-cell>
                    <s-table-cell>
                      <s-text>
                        <s-text type="strong">{run.commitSha.slice(0, 7)}</s-text> {firstLine(run.commitMessage)}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>{run.commitsIncluded.length || 1}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{`${run.filesSucceeded}/${run.filesChanged}`}</s-table-cell>
                    <s-table-cell>
                      <s-button variant="tertiary" onClick={go(`/sync-history?id=${run.id}`)}>
                        Open
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

function CommitDetailSection({ sha, repository }: { sha: string; repository: string }) {
  const [filePage, setFilePage] = useState(1);
  useEffect(() => setFilePage(1), [sha]);
  const detail = useApiQuery(() => api.commits.get(sha, repository), [sha, repository]);
  const files = useApiQuery(
    () => api.commits.files(sha, { repository, page: filePage, perPage: FILES_PER_PAGE }),
    [sha, repository, filePage],
  );
  const commit = detail.data;

  return (
    <s-section heading={`Commit ${sha.slice(0, 7)}`}>
      <s-stack gap="base">
        <ErrorBanner error={detail.error ?? files.error} onRetry={() => (detail.reload(), files.reload())} />
        {detail.loading && !commit ? (
          <LoadingInline label="Loading commit…" />
        ) : (
          commit && (
            <s-stack gap="small-200">
              <s-paragraph>
                <s-text type="strong">{firstLine(commit.message)}</s-text>
              </s-paragraph>
              <s-text color="subdued">
                {commit.authorLogin ?? commit.authorName ?? 'Unknown author'} · {formatDate(commit.date)} ·{' '}
                {commit.filesCount} file(s) · +{commit.stats.additions} −{commit.stats.deletions}
              </s-text>
              <s-text color="subdued">SHA {commit.sha}</s-text>
              {commit.filesTruncated && (
                <s-banner tone="warning" heading="Large commit">
                  <s-paragraph>
                    GitHub lists at most 3000 changed files per commit and this commit reached that limit. Use the
                    “Full snapshot” strategy to sync it completely.
                  </s-paragraph>
                </s-banner>
              )}
            </s-stack>
          )
        )}

        <s-table
          variant="auto"
          loading={files.loading}
          paginate
          hasPreviousPage={filePage > 1}
          hasNextPage={!!files.data?.hasNextPage}
          onPreviousPage={() => setFilePage((p) => Math.max(1, p - 1))}
          onNextPage={() => setFilePage((p) => p + 1)}
        >
          <s-table-header-row>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header listSlot="primary">File</s-table-header>
            <s-table-header listSlot="secondary">Theme mapping</s-table-header>
            <s-table-header format="numeric">Changes</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(files.data?.items ?? []).map((file) => {
              const badge = FILE_STATUS_BADGE[file.status];
              return (
                <s-table-row key={`${file.filename}:${file.previousFilename ?? ''}`}>
                  <s-table-cell>
                    <s-badge tone={badge.tone}>{badge.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>{file.filename}</s-text>
                      {file.previousFilename && <s-text color="subdued">from {file.previousFilename}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {file.themePathError ? (
                      <s-text color="subdued">Not synced: {file.themePathError}</s-text>
                    ) : (
                      <s-text tone="success">{file.themePath}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    +{file.additions} −{file.deletions}
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-stack>
    </s-section>
  );
}

/** A selected commit and where it sits in the branch (0 = newest), for ordering. */
interface Picked {
  sha: string;
  shortSha: string;
  message: string;
  position: number;
}

export default function Commits() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useApiQuery(() => api.settings.get(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);

  const defaults = settings.data?.settings;
  const [branch, setBranch] = useState(params.get('branch') ?? '');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [strategy, setStrategy] = useState<SyncStrategy>('since_last_sync');
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!defaults) return;
    setBranch((b) => b || defaults.defaultBranch || '');
    setStrategy(defaults.syncPreferences.strategy === 'selected_commits' ? 'since_last_sync' : defaults.syncPreferences.strategy);
    setAllowDeletes(defaults.syncPreferences.allowDeletes);
  }, [defaults]);

  const repository = defaults?.defaultRepository ?? '';
  // Opened from a theme (?themeId=): use the branch that theme is mapped to.
  const linkedTheme = params.get('themeId');
  useEffect(() => {
    const m = linkedTheme ? mappings.data?.items.find((x) => x.themeId === linkedTheme) : undefined;
    if (m) setBranch(m.branch);
  }, [linkedTheme, mappings.data]);
  // The theme is the one mapped to the branch (Theme mapping page); never chosen freely here.
  const mapping =
    mappings.data?.items.find((m) => m.repository.toLowerCase() === repository.toLowerCase() && m.branch === branch) ?? null;
  const themeId = mapping?.themeId ?? '';
  const branches = useApiQuery(() => api.github.branches({ repository, perPage: 100 }), [repository], !!repository);
  const commits = useApiQuery(
    () =>
      api.commits.list({ repository, branch: branch || undefined, page, perPage: COMMITS_PER_PAGE, themeId: themeId || undefined }),
    [repository, branch, page, themeId],
    !!repository,
  );
  const listed = commits.data?.items ?? [];
  const pageShas = listed.map((c) => c.sha).join(',');
  // Changed-file counts for the commits on this page (cached per commit on the server).
  const stats = useApiQuery(() => api.commits.stats(pageShas.split(','), repository), [pageShas, repository], !!pageShas);
  const lastSynced = commits.data?.lastSynced ?? null;

  const previewMutation = useMutation(api.sync.preview);
  const confirmMutation = useMutation(api.sync.confirm);

  if (settings.loading && !settings.data) return <LoadingState title="Commit sync" />;

  const selectedTheme = (themes.data ?? []).find((t) => t.id === themeId);
  const offset = (page - 1) * COMMITS_PER_PAGE;
  const isPicked = (sha: string) => picked.some((p) => p.sha === sha);
  const toggle = (sha: string, index: number) => {
    previewMutation.clearError();
    const commit = listed[index]!;
    setPicked((current) =>
      current.some((p) => p.sha === sha)
        ? current.filter((p) => p.sha !== sha)
        : [...current, { sha, shortSha: commit.shortSha, message: commit.message, position: offset + index }],
    );
  };
  const allOnPage = listed.length > 0 && listed.every((c) => isPicked(c.sha));
  const selectPage = () =>
    setPicked((current) => [
      ...current,
      ...listed
        .map((c, i) => ({ sha: c.sha, shortSha: c.shortSha, message: c.message, position: offset + i }))
        .filter((c) => !current.some((p) => p.sha === c.sha)),
    ]);
  const clearSelection = () => {
    previewMutation.clearError();
    setPicked([]);
  };

  const multiple = picked.length > 1;
  // Branch order: newest first (smallest position).
  const ordered = [...picked].sort((a, b) => a.position - b.position);
  const newest = ordered[0] ?? null;
  const selectedSha = picked.length === 1 ? picked[0]!.sha : null;
  const effectiveStrategy: SyncStrategy = multiple ? 'selected_commits' : strategy;

  // Single commit: earlier commits that are not in the theme yet.
  const selectedIndex = listed.findIndex((c) => c.sha === selectedSha);
  const catchUp =
    selectedIndex >= 0 && strategy !== 'full_snapshot' && listed[selectedIndex]!.syncStatus === 'new'
      ? listed.slice(selectedIndex + 1).filter((c) => c.syncStatus === 'new').length
      : 0;
  const selectedStatus = selectedIndex >= 0 ? listed[selectedIndex]!.syncStatus : null;
  const alreadyOn = !multiple && strategy === 'since_last_sync' && !!selectedSha && selectedSha === lastSynced?.sha;
  const goesBack = !multiple && strategy === 'since_last_sync' && selectedStatus === 'added';
  // Multiple: a selection with gaps (unselected commits in between) on the loaded pages.
  const gaps =
    multiple && ordered.length > 1 ? ordered[ordered.length - 1]!.position - ordered[0]!.position + 1 - ordered.length : 0;

  const runPreview = async () => {
    if (!newest || !themeId) return;
    confirmMutation.clearError();
    const result = await previewMutation.run({
      repository,
      branch: branch || undefined,
      commitSha: newest.sha,
      themeId,
      strategy: effectiveStrategy,
      ...(multiple ? { commitShas: picked.map((p) => p.sha) } : {}),
      allowDeletes,
    });
    if (result) {
      setPreview(result);
      setModalOpen(true);
    }
  };

  const confirm = async (confirmation: { confirmLiveTheme?: boolean; confirmThemeName?: string; acceptDirectEdits?: boolean }) => {
    if (!preview) return;
    const run = await confirmMutation.run({ syncId: preview.syncId, confirm: true, ...confirmation });
    if (run) {
      setModalOpen(false);
      showToast('Sync started');
      navigate(`/sync-history?id=${run.id}`);
    }
  };

  if (!repository) {
    return (
      <AppLayout title="Commit sync">
        <s-section heading="Choose a repository first">
          <s-paragraph>Select a repository in Settings to browse its commits.</s-paragraph>
          <s-button slot="secondary-actions" variant="primary" onClick={() => navigate('/settings')}>
            Open settings
          </s-button>
        </s-section>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Commit sync"
      subtitle={`${repository}${branch ? ` · ${branch}` : ''}`}
      banners={
        <>
          <ErrorBanner error={settings.error ?? themes.error} onRetry={() => (settings.reload(), themes.reload())} />
          <ErrorBanner error={mappings.error} heading="Theme mappings could not be loaded" onRetry={mappings.reload} />
          <ErrorBanner error={commits.error} onRetry={commits.reload} heading="Commits could not be loaded" />
          <ErrorBanner error={previewMutation.error} heading="Preview failed" onDismiss={previewMutation.clearError} />
        </>
      }
    >
      <s-section heading="Synchronize">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-select
              label="Branch"
              value={branch || DEFAULT_BRANCH}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setBranch(value === DEFAULT_BRANCH ? '' : value);
                setPage(1);
                setPicked([]);
              }}
            >
              <s-option value={DEFAULT_BRANCH}>Select a branch</s-option>
              {(branches.data?.items ?? []).map((b) => (
                <s-option key={b.name} value={b.name}>
                  {b.name}
                </s-option>
              ))}
            </s-select>
            <s-stack gap="small-200">
              <s-text type="strong">Mapped theme</s-text>
              {mapping ? (
                <s-text>
                  {`${mapping.themeName}${selectedTheme?.isLive ? ' (LIVE)' : ''} · ID ${mapping.themeId.split('/').pop()}`}{' '}
                  <s-button variant="tertiary" onClick={() => navigate(`/mappings?branch=${encodeURIComponent(branch)}`)}>
                    Change
                  </s-button>
                </s-text>
              ) : (
                <s-text color="subdued">
                  {mappings.loading ? 'Loading…' : 'No theme mapped to this branch. '}
                  {!mappings.loading && (
                    <s-button variant="tertiary" onClick={() => navigate(`/mappings?branch=${encodeURIComponent(branch)}`)}>
                      Map a theme
                    </s-button>
                  )}
                </s-text>
              )}
            </s-stack>
            {multiple ? (
              <s-stack gap="small-200">
                <s-text type="strong">Push</s-text>
                <s-text>{`The ${picked.length} selected commits, combined in branch order`}</s-text>
              </s-stack>
            ) : (
              <s-select
                label="Push"
                details="Default from Settings → Sync preferences"
                value={strategy}
                onChange={(event) => setStrategy(event.currentTarget.value as SyncStrategy)}
              >
                <s-option value="since_last_sync">From the last sync to the selected commit</s-option>
                <s-option value="commit_changes">Only the selected commit</s-option>
                <s-option value="full_snapshot">Full sync at the selected commit</s-option>
              </s-select>
            )}
          </s-grid>
          <s-checkbox
            label={
              effectiveStrategy === 'full_snapshot'
                ? 'Delete theme files that are not in the repository'
                : 'Apply deletions (removed and renamed-away files)'
            }
            checked={allowDeletes}
            onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
          />
          {selectedTheme && !multiple && (
            <s-box padding="small" background="subdued" borderRadius="base">
              {lastSynced ? (
                <s-stack gap="small-300">
                  <s-text>
                    {`${selectedTheme.name} last synced from ${lastSynced.branch}: `}
                    <s-text type="strong">{lastSynced.shortSha}</s-text> {`${firstLine(lastSynced.message)} · ${formatDate(lastSynced.syncedAt)}`}
                  </s-text>
                  <s-text color="subdued">
                    {commits.data && commits.data.waiting > 0
                      ? `${commits.data.waiting}${commits.data.waitingMore ? '+' : ''} ${commits.data.waiting === 1 ? 'update' : 'updates'} waiting`
                      : 'Up to date with this branch'}
                  </s-text>
                </s-stack>
              ) : (
                <s-text color="subdued">
                  {`${selectedTheme.name} has no last synced commit from this branch yet. Run a full sync from the Theme mapping page first.`}
                </s-text>
              )}
            </s-box>
          )}
          {multiple && (
            <s-banner tone={gaps > 0 ? 'warning' : 'info'} heading={`${picked.length} commits selected`}>
              <s-paragraph>
                {`Changes are combined oldest to newest; when several selected commits change the same file, the newest version is used, and each file is read from exactly the commit it comes from.${
                  gaps > 0
                    ? ` ${gaps} commit(s) between your selection are not selected: files they also changed are listed as conflicts in the preview.`
                    : ''
                }`}
              </s-paragraph>
              <s-stack direction="inline" gap="small-200">
                {[...ordered].reverse().map((p) => (
                  <s-clickable-chip
                    key={p.sha}
                    removable
                    accessibilityLabel={`Remove ${p.shortSha} from the selection`}
                    onRemove={() => setPicked((cur) => cur.filter((x) => x.sha !== p.sha))}
                  >
                    {`${p.shortSha} ${firstLine(p.message).slice(0, 40)}`}
                  </s-clickable-chip>
                ))}
              </s-stack>
            </s-banner>
          )}
          {alreadyOn && selectedTheme && lastSynced && (
            <s-banner tone="info" heading="Already up to date">
              <s-paragraph>
                {`${selectedTheme.name} is already on ${lastSynced.shortSha} from ${lastSynced.branch}, so there is nothing new to push. Select a newer commit, or choose Push: "Only the selected commit" to push this commit's files again.`}
              </s-paragraph>
            </s-banner>
          )}
          {goesBack && selectedTheme && lastSynced && selectedSha && (
            <s-banner tone="warning" heading="This commit is already in the theme">
              <s-paragraph>
                {`${selectedSha.slice(0, 7)} is older than ${selectedTheme.name}'s last synced commit ${lastSynced.shortSha}. Pushing from the last sync to it undoes the updates made after it — the preview shows exactly which files change.`}
              </s-paragraph>
            </s-banner>
          )}
          {selectedTheme?.isLive && (
            <s-banner tone="warning" heading="Live theme">
              <s-paragraph>Syncing will change the storefront customers see. You will be asked to confirm twice.</s-paragraph>
            </s-banner>
          )}
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button
              variant="primary"
              disabled={picked.length === 0 || !themeId || alreadyOn}
              loading={previewMutation.pending}
              onClick={runPreview}
            >
              {multiple ? `Preview ${picked.length} commits` : 'Preview sync'}
            </s-button>
            <s-text color="subdued">
              {picked.length === 0
                ? 'Select one or more commits below'
                : multiple
                  ? `${picked.length} selected`
                  : `Selected commit ${picked[0]!.shortSha}`}
              {catchUp > 0 && !multiple
                ? ` · ${strategy === 'commit_changes' ? 'leaves out' : 'also pushes'} ${catchUp} earlier ${catchUp === 1 ? 'update' : 'updates'} not added yet`
                : ''}{' '}
              · previews never modify the theme
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section padding="none" accessibilityLabel="Commit history">
        <s-box padding="base">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-text type="strong">{`Commits on ${branch || 'the default branch'}`}</s-text>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">{`${picked.length} selected`}</s-text>
              <s-button variant="tertiary" disabled={listed.length === 0 || allOnPage} onClick={selectPage}>
                Select all on this page
              </s-button>
              <s-button variant="tertiary" disabled={picked.length === 0} onClick={clearSelection}>
                Clear selection
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
        <s-table
          variant="auto"
          loading={commits.loading}
          paginate
          hasPreviousPage={page > 1}
          hasNextPage={!!commits.data?.hasNextPage}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
        >
          <s-table-header-row>
            <s-table-header>Select</s-table-header>
            <s-table-header listSlot="primary">Message</s-table-header>
            <s-table-header listSlot="kicker">SHA</s-table-header>
            <s-table-header listSlot="secondary">Author</s-table-header>
            <s-table-header listSlot="labeled">Date</s-table-header>
            <s-table-header listSlot="labeled">Files</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {listed.map((commit, index) => {
              const count = stats.data?.[commit.sha];
              return (
                <s-table-row key={commit.sha}>
                  <s-table-cell>
                    <s-checkbox
                      accessibilityLabel={`Select commit ${commit.shortSha}`}
                      checked={isPicked(commit.sha)}
                      onChange={() => toggle(commit.sha, index)}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-text type={isPicked(commit.sha) ? 'strong' : 'generic'}>{firstLine(commit.message)}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={commit.htmlUrl} target="_blank">
                      {commit.shortSha}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{commit.authorLogin ?? commit.authorName ?? '—'}</s-table-cell>
                  <s-table-cell>{formatDate(commit.date)}</s-table-cell>
                  <s-table-cell>
                    {count ? `${count.files}${count.truncated ? '+' : ''}` : stats.loading ? '…' : '—'}
                  </s-table-cell>
                  <s-table-cell>
                    {commit.syncStatus ? (
                      <s-badge tone={SYNC_STATUS[commit.syncStatus].tone}>{SYNC_STATUS[commit.syncStatus].label}</s-badge>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
        {!commits.loading && commits.data?.items.length === 0 && (
          <s-box padding="base">
            <s-paragraph color="subdued">This branch has no commits.</s-paragraph>
          </s-box>
        )}
      </s-section>

      {selectedSha && <CommitDetailSection sha={selectedSha} repository={repository} />}

      {selectedTheme && (
        <s-section heading="Last sync">
          <LastSyncCard themeId={selectedTheme.id} branch={branch || undefined} />
        </s-section>
      )}

      {selectedTheme && (
        <ThemeBranchHistory themeId={selectedTheme.id} branch={branch} themeName={selectedTheme.name} />
      )}

      <ConfirmSyncModal
        open={modalOpen}
        preview={preview}
        submitting={confirmMutation.pending}
        error={confirmMutation.error?.message ?? null}
        onClose={() => setModalOpen(false)}
        onConfirm={confirm}
      />
    </AppLayout>
  );
}
