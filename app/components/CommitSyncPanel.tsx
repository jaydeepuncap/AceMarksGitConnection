import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import {
  FILE_STATUS_BADGE,
  firstLine,
  formatDate,
  type Tone,
} from "../lib/format";
import { useApiQuery, useMutation, type QueryState } from "../lib/hooks";
import type {
  CommitSyncStatus,
  CommitsResponse,
  ShopifyTheme,
  SyncPreview,
  SyncStrategy,
  ThemeMapping,
} from "../lib/types";
import { ErrorBanner } from "./ErrorBanner";
import { LoadingInline } from "./LoadingState";

export const COMMITS_PER_PAGE = 20;
const FILES_PER_PAGE = 100;

export const COMMIT_STATUS: Record<
  CommitSyncStatus,
  { label: string; tone: Tone }
> = {
  new: { label: "New", tone: "info" },
  last_synced: { label: "Last synced", tone: "success" },
  added: { label: "Added", tone: "neutral" },
};

/** Files changed by one commit and the theme path each maps to. */
function CommitFiles({ sha, repository }: { sha: string; repository: string }) {
  const [filePage, setFilePage] = useState(1);
  useEffect(() => setFilePage(1), [sha]);
  const detail = useApiQuery(
    () => api.commits.get(sha, repository),
    [sha, repository],
  );
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
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="base">
        <ErrorBanner
          error={detail.error ?? files.error}
          onRetry={() => (detail.reload(), files.reload())}
        />
        {detail.loading && !commit ? (
          <LoadingInline label="Loading commit…" />
        ) : (
          commit && (
            <s-stack gap="small-200">
              <s-text type="strong">{`${commit.sha.slice(0, 7)} · ${firstLine(commit.message)}`}</s-text>
              <s-text color="subdued">
                {`${commit.authorLogin ?? commit.authorName ?? "Unknown author"} · ${formatDate(commit.date)} · ${commit.filesCount} file(s) · +${commit.stats.additions} −${commit.stats.deletions}`}
              </s-text>
              {commit.filesTruncated && (
                <s-banner tone="warning" heading="Large commit">
                  <s-paragraph>
                    GitHub lists at most 3000 changed files per commit and this
                    commit reached that limit. Use a full sync to sync it
                    completely.
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
            <s-table-header listSlot="inline">Change</s-table-header>
            <s-table-header listSlot="primary">File</s-table-header>
            <s-table-header listSlot="secondary">In the theme</s-table-header>
            <s-table-header format="numeric">Lines</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {(files.data?.items ?? []).map((file) => {
              const badge = FILE_STATUS_BADGE[file.status];
              return (
                <s-table-row
                  key={`${file.filename}:${file.previousFilename ?? ""}`}
                >
                  <s-table-cell>
                    <s-badge tone={badge.tone}>{badge.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text>{file.filename}</s-text>
                      {file.previousFilename && (
                        <s-text color="subdued">
                          from {file.previousFilename}
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {file.themePathError ? (
                      <s-text color="subdued">
                        Not synced: {file.themePathError}
                      </s-text>
                    ) : (
                      <s-text tone="success">{file.themePath}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{`+${file.additions} −${file.deletions}`}</s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-stack>
    </s-box>
  );
}

/** A selected commit and where it sits in the branch (0 = newest), for ordering. */
interface Picked {
  sha: string;
  shortSha: string;
  message: string;
  position: number;
}

/**
 * Commit list of a mapped branch with single and multiple selection, the push
 * choice and the preview. The branch and theme are fixed by the mapping.
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
  const [strategy, setStrategy] = useState<SyncStrategy>("since_last_sync");
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const previewMutation = useMutation(api.sync.preview);

  const listed = commits.data?.items ?? [];
  const pageShas = listed.map((c) => c.sha).join(",");
  // Changed-file counts for the commits on this page (cached per commit on the server).
  const stats = useApiQuery(
    () => api.commits.stats(pageShas.split(","), repository),
    [pageShas, repository],
    !!pageShas,
  );
  const lastSynced = commits.data?.lastSynced ?? null;

  const offset = (page - 1) * COMMITS_PER_PAGE;
  const isPicked = (sha: string) => picked.some((p) => p.sha === sha);
  const toggle = (index: number) => {
    previewMutation.clearError();
    const commit = listed[index]!;
    setPicked((current) =>
      current.some((p) => p.sha === commit.sha)
        ? current.filter((p) => p.sha !== commit.sha)
        : [
            ...current,
            {
              sha: commit.sha,
              shortSha: commit.shortSha,
              message: commit.message,
              position: offset + index,
            },
          ],
    );
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
        }))
        .filter((c) => !current.some((p) => p.sha === c.sha)),
    ]);
  const selectWaiting = () =>
    setPicked(
      listed
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.syncStatus === "new")
        .map(({ c, i }) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          position: offset + i,
        })),
    );

  const multiple = picked.length > 1;
  const ordered = [...picked].sort((a, b) => a.position - b.position); // newest first
  const newest = ordered[0] ?? null;
  const selectedSha = picked.length === 1 ? picked[0]!.sha : null;
  const effectiveStrategy: SyncStrategy = multiple
    ? "selected_commits"
    : strategy;

  const selectedIndex = listed.findIndex((c) => c.sha === selectedSha);
  const catchUp =
    selectedIndex >= 0 &&
    strategy !== "full_snapshot" &&
    listed[selectedIndex]!.syncStatus === "new"
      ? listed.slice(selectedIndex + 1).filter((c) => c.syncStatus === "new")
          .length
      : 0;
  const selectedStatus =
    selectedIndex >= 0 ? listed[selectedIndex]!.syncStatus : null;
  const alreadyOn =
    !multiple &&
    strategy === "since_last_sync" &&
    !!selectedSha &&
    selectedSha === lastSynced?.sha;
  const goesBack =
    !multiple && strategy === "since_last_sync" && selectedStatus === "added";
  const gaps = multiple
    ? ordered[ordered.length - 1]!.position -
      ordered[0]!.position +
      1 -
      ordered.length
    : 0;
  const waitingOnPage = listed.filter((c) => c.syncStatus === "new").length;

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

  const reviewLabel = multiple
    ? `Review ${picked.length} commits`
    : "Review sync";

  return (
    <s-stack gap="base">
      <ErrorBanner
        error={commits.error}
        onRetry={commits.reload}
        heading="Commits could not be loaded"
      />
      <ErrorBanner
        error={previewMutation.error}
        heading="Preview failed"
        onDismiss={previewMutation.clearError}
      />

      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-badge tone="info">1</s-badge>
        <s-text>Select commits</s-text>
        <s-icon type="chevron-right" />
        <s-badge tone="info">2</s-badge>
        <s-text>Review the files</s-text>
        <s-icon type="chevron-right" />
        <s-badge tone="info">3</s-badge>
        <s-text>Confirm & sync</s-text>
        <s-text color="subdued">
          · nothing changes in the theme until you confirm
        </s-text>
      </s-stack>

      {multiple ? (
        <s-banner
          tone={gaps > 0 ? "warning" : "info"}
          heading={`${picked.length} commits will be combined`}
        >
          <s-paragraph>
            {`They are applied oldest to newest. When several selected commits change the same file, the newest version is used, read from exactly that commit.${
              gaps > 0
                ? ` ${gaps} commit(s) in between are not selected: files they also changed are listed as conflicts in the review.`
                : ""
            }`}
          </s-paragraph>
          <s-stack direction="inline" gap="small-200">
            {[...ordered].reverse().map((p) => (
              <s-clickable-chip
                key={p.sha}
                removable
                accessibilityLabel={`Remove ${p.shortSha} from the selection`}
                onRemove={() =>
                  setPicked((cur) => cur.filter((x) => x.sha !== p.sha))
                }
              >
                {`${p.shortSha} ${firstLine(p.message).slice(0, 40)}`}
              </s-clickable-chip>
            ))}
          </s-stack>
        </s-banner>
      ) : (
        <s-choice-list
          label="What to sync when one commit is selected"
          values={[strategy]}
          onChange={(event) =>
            setStrategy(
              (event.currentTarget.values[0] as SyncStrategy) ??
                "since_last_sync",
            )
          }
        >
          <s-choice
            value="since_last_sync"
            selected={strategy === "since_last_sync"}
          >
            Everything up to the selected commit (recommended)
            <s-text slot="details">
              {lastSynced
                ? `Brings in every commit after ${lastSynced.shortSha} up to the selected one, so nothing is skipped.`
                : "The theme was never synced from this branch: the complete theme at the selected commit is applied."}
            </s-text>
          </s-choice>
          <s-choice
            value="commit_changes"
            selected={strategy === "commit_changes"}
          >
            Only the selected commit
            <s-text slot="details">
              Applies just the files that commit changed; earlier commits that
              are not in the theme are left out.
            </s-text>
          </s-choice>
        </s-choice-list>
      )}
      <s-checkbox
        label="Also delete files that the commits removed or renamed"
        details="Off by default. Every deletion is listed in the review first; protected and ignored files are never deleted."
        checked={allowDeletes}
        onChange={(event) => setAllowDeletes(event.currentTarget.checked)}
      />

      {alreadyOn && lastSynced && (
        <s-banner tone="info" heading="Already up to date">
          <s-paragraph>
            {`${mapping.themeName} is already on ${lastSynced.shortSha}, so there is nothing new to bring in. Select a newer commit, or choose "Only the selected commit" to apply this commit's files again.`}
          </s-paragraph>
        </s-banner>
      )}
      {goesBack && lastSynced && selectedSha && (
        <s-banner tone="warning" heading="This commit is already in the theme">
          <s-paragraph>
            {`${selectedSha.slice(0, 7)} is older than the theme's commit ${lastSynced.shortSha}. Syncing up to it undoes the updates made after it — the review shows exactly which files change.`}
          </s-paragraph>
        </s-banner>
      )}

      <s-box padding="small" background="subdued" borderRadius="base">
        <s-stack
          direction="inline"
          gap="small-200"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge
              tone={picked.length ? "info" : "neutral"}
            >{`${picked.length} selected`}</s-badge>
            <s-button
              variant="tertiary"
              disabled={waitingOnPage === 0}
              onClick={selectWaiting}
            >
              {`Select new (${waitingOnPage})`}
            </s-button>
            <s-button
              variant="tertiary"
              disabled={listed.length === 0 || allOnPage}
              onClick={selectPage}
            >
              Select all
            </s-button>
            <s-button
              variant="tertiary"
              disabled={picked.length === 0}
              onClick={() => setPicked([])}
            >
              Clear
            </s-button>
          </s-stack>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {catchUp > 0 && !multiple && strategy === "since_last_sync" && (
              <s-text color="subdued">{`+ ${catchUp} earlier commit${catchUp === 1 ? "" : "s"} not in the theme yet`}</s-text>
            )}
            <s-button
              variant="primary"
              disabled={picked.length === 0 || alreadyOn || !theme}
              loading={previewMutation.pending}
              onClick={runPreview}
            >
              {reviewLabel}
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
          <s-table-header>
            <s-text accessibilityVisibility="exclusive">Select</s-text>
          </s-table-header>
          <s-table-header listSlot="primary">Commit</s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Files
          </s-table-header>
          <s-table-header listSlot="inline">Status</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {listed.map((commit, index) => {
            const count = stats.data?.[commit.sha];
            const on = isPicked(commit.sha);
            return (
              <s-table-row key={commit.sha}>
                <s-table-cell>
                  <s-checkbox
                    accessibilityLabel={`Select commit ${commit.shortSha}`}
                    checked={on}
                    onChange={() => toggle(index)}
                  />
                </s-table-cell>
                <s-table-cell>
                  <s-stack gap="none">
                    <s-text type={on ? "strong" : "generic"}>
                      {firstLine(commit.message)}
                    </s-text>
                    <s-text color="subdued">
                      <s-link href={commit.htmlUrl} target="_blank">
                        {commit.shortSha}
                      </s-link>
                      {` · ${commit.authorLogin ?? commit.authorName ?? "unknown"} · ${formatDate(commit.date)}`}
                    </s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  {count
                    ? `${count.files}${count.truncated ? "+" : ""}`
                    : stats.loading
                      ? "…"
                      : "—"}
                </s-table-cell>
                <s-table-cell>
                  {commit.syncStatus ? (
                    <s-badge tone={COMMIT_STATUS[commit.syncStatus].tone}>
                      {COMMIT_STATUS[commit.syncStatus].label}
                    </s-badge>
                  ) : (
                    <s-text color="subdued">—</s-text>
                  )}
                </s-table-cell>
              </s-table-row>
            );
          })}
        </s-table-body>
      </s-table>
      {commits.loading && listed.length === 0 && (
        <LoadingInline label="Loading commits…" />
      )}
      {!commits.loading && !commits.error && listed.length === 0 && (
        <s-paragraph color="subdued">{`${mapping.branch} has no commits.`}</s-paragraph>
      )}
      <s-text color="subdued">
        <s-badge tone="info">New</s-badge> not in the theme yet ·{" "}
        <s-badge tone="success">Last synced</s-badge> the commit the theme is on
        · <s-badge tone="neutral">Added</s-badge> already in the theme
      </s-text>

      {selectedSha && (
        <s-stack gap="small-200">
          <s-stack direction="inline">
            <s-button
              variant="tertiary"
              onClick={() => setShowFiles((v) => !v)}
            >
              {showFiles
                ? "Hide changed files"
                : `Show files changed in ${selectedSha.slice(0, 7)}`}
            </s-button>
          </s-stack>
          {showFiles && (
            <CommitFiles sha={selectedSha} repository={repository} />
          )}
        </s-stack>
      )}
    </s-stack>
  );
}
