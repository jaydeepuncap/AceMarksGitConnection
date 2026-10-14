import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ConfirmSyncModal } from '../components/ConfirmSyncModal';
import { ErrorBanner } from '../components/ErrorBanner';
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
const NO_THEME = '__none__';

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

export default function Commits() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useApiQuery(() => api.settings.get(), []);
  const themes = useApiQuery(() => api.themes.list(), []);

  const defaults = settings.data?.settings;
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [themeId, setThemeId] = useState(params.get('themeId') ?? '');
  const [strategy, setStrategy] = useState<SyncStrategy>('since_last_sync');
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!defaults) return;
    setBranch((b) => b || defaults.defaultBranch || '');
    setThemeId((t) => t || defaults.defaultThemeId || '');
    setStrategy(defaults.syncPreferences.strategy);
    setAllowDeletes(defaults.syncPreferences.allowDeletes);
  }, [defaults]);

  const repository = defaults?.defaultRepository ?? '';
  const branches = useApiQuery(() => api.github.branches({ repository, perPage: 100 }), [repository], !!repository);
  const commits = useApiQuery(
    () =>
      api.commits.list({ repository, branch: branch || undefined, page, perPage: COMMITS_PER_PAGE, themeId: themeId || undefined }),
    [repository, branch, page, themeId],
    !!repository,
  );
  const lastSynced = commits.data?.lastSynced ?? null;

  const previewMutation = useMutation(api.sync.preview);
  const confirmMutation = useMutation(api.sync.confirm);

  if (settings.loading && !settings.data) return <LoadingState title="Commits" />;

  const writableThemes = (themes.data ?? []).filter((t) => t.writable);
  // Earlier commits (below the selected one) that are not in the theme yet; they are synced along with it.
  const listed = commits.data?.items ?? [];
  const selectedIndex = listed.findIndex((c) => c.sha === selectedSha);
  const catchUp =
    selectedIndex >= 0 && strategy !== 'full_snapshot' && listed[selectedIndex]!.syncStatus === 'new'
      ? listed.slice(selectedIndex + 1).filter((c) => c.syncStatus === 'new').length
      : 0;
  const selectedTheme = writableThemes.find((t) => t.id === themeId);

  const runPreview = async () => {
    if (!selectedSha || !themeId) return;
    confirmMutation.clearError();
    const result = await previewMutation.run({
      repository,
      branch: branch || commits.data?.lastSynced?.branch || undefined,
      commitSha: selectedSha,
      themeId,
      strategy,
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
      <AppLayout title="Commits">
        <s-section heading="Choose a repository first">
          <s-paragraph>Select a default repository in Settings to browse its commits.</s-paragraph>
          <s-button slot="secondary-actions" variant="primary" onClick={() => navigate('/settings')}>
            Open settings
          </s-button>
        </s-section>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Commits"
      subtitle={`${repository}${branch ? ` · ${branch}` : ''}`}
      banners={
        <>
          <ErrorBanner error={settings.error ?? themes.error} onRetry={() => (settings.reload(), themes.reload())} />
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
                setSelectedSha(null);
              }}
            >
              <s-option value={DEFAULT_BRANCH}>Repository default</s-option>
              {(branches.data?.items ?? []).map((b) => (
                <s-option key={b.name} value={b.name}>
                  {b.name}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Target theme"
              value={themeId || NO_THEME}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setThemeId(value === NO_THEME ? '' : value);
                setSelectedSha(null);
              }}
            >
              <s-option value={NO_THEME}>Select a theme</s-option>
              {writableThemes.map((t) => (
                <s-option key={t.id} value={t.id}>
                  {`${t.name}${t.isLive ? ' (LIVE)' : ''}`}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Push"
              details="Default from Settings → Sync preferences"
              value={strategy}
              onChange={(event) => setStrategy(event.currentTarget.value as SyncStrategy)}
            >
              <s-option value="since_last_sync">From the last sync to the selected commit</s-option>
              <s-option value="commit_changes">Only the selected commit</s-option>
              <s-option value="full_snapshot">Full snapshot</s-option>
            </s-select>
          </s-grid>
          <s-checkbox
            label="Apply deletions (removed and renamed-away files)"
            checked={allowDeletes}
            disabled={strategy === 'full_snapshot'}
            onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
          />
          {selectedTheme && (
            <s-box padding="small" background="subdued" borderRadius="base">
              {lastSynced ? (
                <s-stack gap="small-300">
                  <s-text>
                    {`${selectedTheme.name} last synced from ${lastSynced.branch}: `}
                    <s-text type="strong">{lastSynced.shortSha}</s-text> {`${firstLine(lastSynced.message)} · ${formatDate(lastSynced.syncedAt)}`}
                  </s-text>
                  <s-text color="subdued">
                    {commits.data && commits.data.waiting > 0
                      ? `${commits.data.waiting}${commits.data.waitingMore ? '+' : ''} ${commits.data.waiting === 1 ? 'update' : 'updates'} waiting · ${strategy === 'commit_changes' ? 'only the selected one is pushed' : 'syncing one also pushes the earlier ones not added yet'}`
                      : 'Up to date with this branch'}
                  </s-text>
                </s-stack>
              ) : (
                <s-text color="subdued">
                  {`${selectedTheme.name} has no last synced commit from this branch yet. The first sync records it in the theme (assets/theme-sync.json), so duplicates of this theme keep their status.`}
                </s-text>
              )}
            </s-box>
          )}
          {strategy === 'since_last_sync' && (
            <s-text color="subdued">
              Pushes every update between the theme&apos;s last synced commit and the selected one together, in order, so
              no developer work is left out. The preview lists every file and the commit it comes from.
            </s-text>
          )}
          {strategy === 'commit_changes' && (
            <s-text color="subdued">
              Pushes only the files changed in the selected commit; earlier updates that are not in the theme yet are
              left out.
            </s-text>
          )}
          {selectedTheme?.isLive && (
            <s-banner tone="warning" heading="Live theme selected">
              <s-paragraph>Syncing will change the storefront customers see. You will be asked to confirm twice.</s-paragraph>
            </s-banner>
          )}
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button
              variant="primary"
              disabled={!selectedSha || !themeId}
              loading={previewMutation.pending}
              onClick={runPreview}
            >
              Preview sync
            </s-button>
            <s-text color="subdued">
              {selectedSha ? `Selected commit ${selectedSha.slice(0, 7)}` : 'Select a commit below'}
              {catchUp > 0 ? ` · ${strategy === 'commit_changes' ? 'leaves out' : 'also pushes'} ${catchUp}${commits.data?.hasNextPage && listed[listed.length - 1]?.syncStatus === 'new' ? '+' : ''} earlier ${catchUp === 1 ? 'update' : 'updates'} not added yet` : ''}{' '}
              · previews never modify the theme
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section padding="none" accessibilityLabel="Commit history">
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
            <s-table-header listSlot="primary">Message</s-table-header>
            <s-table-header listSlot="kicker">SHA</s-table-header>
            <s-table-header listSlot="secondary">Author</s-table-header>
            <s-table-header listSlot="labeled">Date</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header>Select</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(commits.data?.items ?? []).map((commit) => (
              <s-table-row key={commit.sha}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type={selectedSha === commit.sha ? 'strong' : 'generic'}>{firstLine(commit.message)}</s-text>
                    {selectedSha === commit.sha && <s-badge tone="info">Selected</s-badge>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-link href={commit.htmlUrl} target="_blank">
                    {commit.shortSha}
                  </s-link>
                </s-table-cell>
                <s-table-cell>{commit.authorLogin ?? commit.authorName ?? '—'}</s-table-cell>
                <s-table-cell>{formatDate(commit.date)}</s-table-cell>
                <s-table-cell>
                  {commit.syncStatus ? (
                    <s-badge tone={SYNC_STATUS[commit.syncStatus].tone}>{SYNC_STATUS[commit.syncStatus].label}</s-badge>
                  ) : (
                    <s-text color="subdued">—</s-text>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-button
                    variant={selectedSha === commit.sha ? 'primary' : 'secondary'}
                    accessibilityLabel={`Select commit ${commit.shortSha}`}
                    onClick={() => setSelectedSha(commit.sha)}
                  >
                    {selectedSha === commit.sha ? 'Selected' : 'Select'}
                  </s-button>
                </s-table-cell>
              </s-table-row>
            ))}
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
        <ThemeBranchHistory
          themeId={selectedTheme.id}
          branch={branch || lastSynced?.branch || defaults?.defaultBranch || ''}
          themeName={selectedTheme.name}
        />
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
