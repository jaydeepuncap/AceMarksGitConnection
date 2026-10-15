import { useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import { FILE_STATUS_BADGE, firstLine, formatDate, type Tone } from '../lib/format';
import { useApiQuery, useMutation, type QueryState } from '../lib/hooks';
import type {
  CommitSyncStatus,
  CommitsResponse,
  ShopifyTheme,
  SyncPreview,
  SyncStrategy,
  ThemeMapping,
} from '../lib/types';
import { ErrorBanner } from './ErrorBanner';
import { LoadingInline } from './LoadingState';
import {
  Badge,
  Banner,
  Box,
  Button,
  Checkbox,
  ClickableChip,
  IndexTable,
  IndexTableCell,
  IndexTableRow,
  Link,
  Modal,
  Paragraph,
  Stack,
  Text,
} from './ui';

export const COMMITS_PER_PAGE = 20;
const FILES_PER_PAGE = 100;

export const COMMIT_STATUS: Record<CommitSyncStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'info' },
  last_synced: { label: 'Last synced', tone: 'success' },
  added: { label: 'Added', tone: 'neutral' },
};

/** Files changed by one commit and the theme path each maps to (shown in the files modal). */
function CommitFiles({ sha, repository }: { sha: string; repository: string }) {
  const [filePage, setFilePage] = useState(1);
  useEffect(() => setFilePage(1), [sha]);
  const detail = useApiQuery(() => api.commits.get(sha, repository), [sha, repository]);
  const files = useApiQuery(
    () =>
      api.commits.files(sha, {
        repository,
        page: filePage,
        perPage: FILES_PER_PAGE,
      }),
    [sha, repository, filePage],
  );
  const commit = detail.data;

  return (
    <Stack gap="base">
      <ErrorBanner error={detail.error ?? files.error} onRetry={() => (detail.reload(), files.reload())} />
      {detail.loading && !commit ? (
        <LoadingInline label="Loading commit…" />
      ) : (
        commit && (
          <Stack gap="small-200">
            <Text type="strong">{`${commit.sha.slice(0, 7)} · ${firstLine(commit.message)}`}</Text>
            <Text color="subdued">
              {`${commit.authorLogin ?? commit.authorName ?? 'Unknown author'} · ${formatDate(commit.date)} · ${commit.filesCount} file(s) · +${commit.stats.additions} −${commit.stats.deletions}`}
            </Text>
            {commit.filesTruncated && (
              <Banner tone="warning" heading="Large commit">
                <Paragraph>
                  GitHub lists at most 3000 changed files per commit and this commit reached that limit. Use a full sync
                  to sync it completely.
                </Paragraph>
              </Banner>
            )}
          </Stack>
        )
      )}
      <IndexTable
        variant="auto"
        loading={files.loading}
        paginate
        hasPreviousPage={filePage > 1}
        hasNextPage={!!files.data?.hasNextPage}
        onPreviousPage={() => setFilePage((p) => Math.max(1, p - 1))}
        onNextPage={() => setFilePage((p) => p + 1)}
        columns={[
          { title: 'Change', listSlot: 'inline' },
          { title: 'File', listSlot: 'primary' },
          { title: 'In the theme', listSlot: 'secondary' },
          { title: 'Lines', format: 'numeric' },
        ]}
        rows={(files.data?.items ?? []).map((file) => {
          const badge = FILE_STATUS_BADGE[file.status];
          return (
            <IndexTableRow key={`${file.filename}:${file.previousFilename ?? ''}`}>
              <IndexTableCell>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </IndexTableCell>
              <IndexTableCell>
                <Stack gap="none">
                  <Text>{file.filename}</Text>
                  {file.previousFilename && <Text color="subdued">from {file.previousFilename}</Text>}
                </Stack>
              </IndexTableCell>
              <IndexTableCell>
                {file.themePathError ? (
                  <Text color="subdued">Not synced: {file.themePathError}</Text>
                ) : (
                  <Text tone="success">{file.themePath}</Text>
                )}
              </IndexTableCell>
              <IndexTableCell>{`+${file.additions} −${file.deletions}`}</IndexTableCell>
            </IndexTableRow>
          );
        })}
      />
    </Stack>
  );
}

/** A selected commit and where it sits in the branch (0 = newest), for ordering. */
interface Picked {
  sha: string;
  shortSha: string;
  message: string;
  position: number;
  status: CommitSyncStatus | null;
}

/**
 * Commit list of a mapped branch with single and multiple selection and the
 * preview. The branch and theme are fixed by the mapping. One new commit brings
 * every commit up to it; one commit already in the theme re-applies only its
 * own files; several commits are combined.
 */
export function CommitSyncPanel({
  mapping,
  theme,
  commits,
  page,
  setPage,
  onPreview,
}: {
  mapping: ThemeMapping;
  theme: ShopifyTheme | undefined;
  commits: QueryState<CommitsResponse>;
  page: number;
  setPage: (update: (page: number) => number) => void;
  onPreview: (preview: SyncPreview) => void;
}) {
  const repository = mapping.repository;
  const [picked, setPicked] = useState<Picked[]>([]);
  const [allowDeletes, setAllowDeletes] = useState(false);
  // The commit whose changed files are shown in the modal.
  const [filesOf, setFilesOf] = useState<{ sha: string; shortSha: string } | null>(null);
  const previewMutation = useMutation(api.sync.preview);

  const listed = commits.data?.items ?? [];
  const pageShas = listed.map((c) => c.sha).join(',');
  // Changed-file counts for the commits on this page (cached per commit on the server).
  const stats = useApiQuery(
    () => api.commits.stats(pageShas.split(','), repository),
    [pageShas, repository],
    !!pageShas,
  );
  const lastSynced = commits.data?.lastSynced ?? null;

  const offset = (page - 1) * COMMITS_PER_PAGE;
  const isPicked = (sha: string) => picked.some((p) => p.sha === sha);
  /**
   * Selects or unselects a commit from the checkbox's own checked value, not by
   * flipping the current selection, so a repeated change event cannot leave the
   * box ticked while the commit is not selected.
   */
  const setCommitPicked = (index: number, checked: boolean) => {
    previewMutation.clearError();
    const commit = listed[index]!;
    setPicked((current) => {
      const others = current.filter((p) => p.sha !== commit.sha);
      if (!checked) return others;
      return [
        ...others,
        {
          sha: commit.sha,
          shortSha: commit.shortSha,
          message: commit.message,
          position: offset + index,
          status: commit.syncStatus,
        },
      ];
    });
  };
  const allOnPage = listed.length > 0 && listed.every((c) => isPicked(c.sha));
  const selectPage = () =>
    setPicked((current) => [
      ...current,
      ...listed
        .map((c, i) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          position: offset + i,
          status: c.syncStatus,
        }))
        .filter((c) => !current.some((p) => p.sha === c.sha)),
    ]);
  const selectWaiting = () =>
    setPicked(
      listed
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.syncStatus === 'new')
        .map(({ c, i }) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          position: offset + i,
          status: c.syncStatus,
        })),
    );

  const multiple = picked.length > 1;
  const ordered = [...picked].sort((a, b) => a.position - b.position); // newest first
  const newest = ordered[0] ?? null;
  const selected = picked.length === 1 ? picked[0]! : null;
  const selectedSha = selected?.sha ?? null;
  // A commit already in the theme is re-applied on its own instead of rolling the theme back to it.
  const reapply = !!selected && (selected.status === 'added' || selected.status === 'last_synced');
  const effectiveStrategy: SyncStrategy = multiple
    ? 'selected_commits'
    : reapply
      ? 'commit_changes'
      : 'since_last_sync';

  const selectedIndex = listed.findIndex((c) => c.sha === selectedSha);
  const catchUp =
    selectedIndex >= 0 && !reapply && listed[selectedIndex]!.syncStatus === 'new'
      ? listed.slice(selectedIndex + 1).filter((c) => c.syncStatus === 'new').length
      : 0;
  const gaps = multiple ? ordered[ordered.length - 1]!.position - ordered[0]!.position + 1 - ordered.length : 0;
  const waitingOnPage = listed.filter((c) => c.syncStatus === 'new').length;

  const runPreview = async () => {
    if (!newest) return;
    const result = await previewMutation.run({
      repository,
      branch: mapping.branch,
      commitSha: newest.sha,
      themeId: mapping.themeId,
      strategy: effectiveStrategy,
      ...(multiple ? { commitShas: picked.map((p) => p.sha) } : {}),
      allowDeletes,
    });
    if (result) onPreview(result);
  };

  const reviewLabel = multiple ? `Review ${picked.length} commits` : 'Review sync';
  const upToDate = !!lastSynced && commits.data?.waiting === 0 && !commits.data?.waitingMore;

  return (
    <Stack gap="base">
      <ErrorBanner error={commits.error} onRetry={commits.reload} heading="Commits could not be loaded" />
      <ErrorBanner error={previewMutation.error} heading="Preview failed" onDismiss={previewMutation.clearError} />

      {upToDate && picked.length === 0 && (
        <Banner tone="success" heading="All commits are in the theme">
          <Paragraph>
            {`${mapping.themeName} already has every commit of ${mapping.branch}. Select an older commit only if you want to apply it again.`}
          </Paragraph>
        </Banner>
      )}

      {multiple ? (
        <Banner tone={gaps > 0 ? 'warning' : 'info'} heading={`${picked.length} commits will be combined`}>
          <Paragraph>
            {`They are applied oldest to newest. When several selected commits change the same file, the newest version is used, read from exactly that commit.${
              gaps > 0
                ? ` ${gaps} commit(s) in between are not selected: files they also changed are listed as conflicts in the review.`
                : ''
            }`}
          </Paragraph>
          <Stack direction="inline" gap="small-200">
            {[...ordered].reverse().map((p) => (
              <ClickableChip
                key={p.sha}
                removable
                accessibilityLabel={`Remove ${p.shortSha} from the selection`}
                onRemove={() => setPicked((cur) => cur.filter((x) => x.sha !== p.sha))}
              >
                {`${p.shortSha} ${firstLine(p.message).slice(0, 40)}`}
              </ClickableChip>
            ))}
          </Stack>
        </Banner>
      ) : null}
      <Checkbox
        label="Also delete files the commits removed"
        details="Off by default; every deletion is listed in the review first."
        checked={allowDeletes}
        onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
      />

      {reapply && selected && (
        <Banner tone="info" heading={`${selected.shortSha} is already in the theme`}>
          <Paragraph>
            {`Only the files ${selected.shortSha} changed are synced to ${mapping.themeName} again. Newer commits in the theme stay as they are.`}
          </Paragraph>
        </Banner>
      )}

      <Box padding="small" background="subdued" borderRadius="base">
        <Stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <Stack direction="inline" gap="small-200" alignItems="center">
            <Badge tone={picked.length ? 'info' : 'neutral'}>{`${picked.length} selected`}</Badge>
            <Button variant="tertiary" disabled={waitingOnPage === 0} onClick={selectWaiting}>
              {`Select new (${waitingOnPage})`}
            </Button>
            <Button variant="tertiary" disabled={listed.length === 0 || allOnPage} onClick={selectPage}>
              Select all
            </Button>
            <Button variant="tertiary" disabled={picked.length === 0} onClick={() => setPicked([])}>
              Clear
            </Button>
          </Stack>
          <Stack direction="inline" gap="small-200" alignItems="center">
            {catchUp > 0 && !multiple && (
              <Text color="subdued">{`+ ${catchUp} earlier commit${catchUp === 1 ? '' : 's'} not in the theme yet`}</Text>
            )}
            <Button
              variant="primary"
              disabled={picked.length === 0 || !theme}
              loading={previewMutation.pending}
              onClick={runPreview}
            >
              {reviewLabel}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <IndexTable
        variant="auto"
        loading={commits.loading}
        paginate
        hasPreviousPage={page > 1}
        hasNextPage={!!commits.data?.hasNextPage}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        columns={[
          { title: <Text accessibilityVisibility="exclusive">Select</Text> },
          { title: 'Commit', listSlot: 'primary' },
          { title: 'Changed files', listSlot: 'labeled' },
          { title: 'Status', listSlot: 'inline' },
        ]}
        rows={listed.map((commit, index) => {
          const count = stats.data?.[commit.sha];
          const on = isPicked(commit.sha);
          return (
            <IndexTableRow key={commit.sha}>
              <IndexTableCell>
                <Checkbox
                  accessibilityLabel={`Select commit ${commit.shortSha}`}
                  checked={on}
                  // Keep the box showing the selection after every render; the element keeps its own
                  // checked state otherwise, which can drift from what is actually selected.
                  ref={(el: (HTMLElement & { checked: boolean }) | null) => {
                    if (el && el.checked !== on) el.checked = on;
                  }}
                  onChange={(event) => setCommitPicked(index, !!event.currentTarget.checked)}
                />
              </IndexTableCell>
              <IndexTableCell>
                <Stack gap="none">
                  <Text type={on ? 'strong' : 'generic'}>{firstLine(commit.message)}</Text>
                  <Text color="subdued">
                    <Link href={commit.htmlUrl} target="_blank">
                      {commit.shortSha}
                    </Link>
                    {` · ${commit.authorLogin ?? commit.authorName ?? 'unknown'} · ${formatDate(commit.date)}`}
                  </Text>
                </Stack>
              </IndexTableCell>
              <IndexTableCell>
                <Button
                  variant="secondary"
                  icon="file"
                  accessibilityLabel={`View files changed in ${commit.shortSha}`}
                  onClick={() => setFilesOf({ sha: commit.sha, shortSha: commit.shortSha })}
                >
                  {count
                    ? `${count.files}${count.truncated ? '+' : ''} file${count.files === 1 ? '' : 's'}`
                    : stats.loading
                      ? '…'
                      : 'View files'}
                </Button>
              </IndexTableCell>
              <IndexTableCell>
                {commit.syncStatus ? (
                  <Badge tone={COMMIT_STATUS[commit.syncStatus].tone}>{COMMIT_STATUS[commit.syncStatus].label}</Badge>
                ) : (
                  <Text color="subdued">—</Text>
                )}
              </IndexTableCell>
            </IndexTableRow>
          );
        })}
      />
      {commits.loading && listed.length === 0 && <LoadingInline label="Loading commits…" />}
      {!commits.loading && !commits.error && listed.length === 0 && (
        <Paragraph color="subdued">{`${mapping.branch} has no commits.`}</Paragraph>
      )}
      <Stack direction="inline" gap="base" alignItems="center">
        <Text color="subdued">Status:</Text>
        <Stack direction="inline" gap="small-200" alignItems="center">
          <Badge tone="info">New</Badge>
          <Text color="subdued">not in the theme yet</Text>
        </Stack>
        <Stack direction="inline" gap="small-200" alignItems="center">
          <Badge tone="success">Last synced</Badge>
          <Text color="subdued">the commit the theme is on</Text>
        </Stack>
        <Stack direction="inline" gap="small-200" alignItems="center">
          <Badge tone="neutral">Added</Badge>
          <Text color="subdued">already in the theme</Text>
        </Stack>
      </Stack>

      <Modal
        id="commit-files"
        open={filesOf !== null}
        heading={filesOf ? `Files changed in ${filesOf.shortSha}` : 'Files changed'}
        size="large"
        onHide={() => setFilesOf(null)}
      >
        {filesOf && <CommitFiles sha={filesOf.sha} repository={repository} />}
        <Button slot="primary-action" variant="primary" onClick={() => setFilesOf(null)}>
          Close
        </Button>
      </Modal>
    </Stack>
  );
}
