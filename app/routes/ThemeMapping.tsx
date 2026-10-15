import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { ErrorBanner } from "../components/ErrorBanner";
import { LoadingState } from "../components/LoadingState";
import { themeLabel } from "../components/MappingControls";
import { api } from "../lib/api-client";
import { showToast } from "../lib/app-bridge";
import {
  firstLine,
  formatDate,
  mappingStatus,
  RESULT_BADGE,
  syncTypeLabel,
  THEME_ROLE_BADGE,
} from "../lib/format";
import { useApiQuery, useMutation, useNavigateHandler } from "../lib/hooks";
import type {
  GithubBranch,
  ShopifyTheme,
  ThemeMapping as Mapping,
} from "../lib/types";

const NONE = "__none__";

/** One branch → theme mapping with where it stands; opens its own page. */
function MappingCard({
  mapping,
  theme,
  themesLoaded,
}: {
  mapping: Mapping;
  theme: ShopifyTheme | undefined;
  themesLoaded: boolean;
}) {
  const go = useNavigateHandler();
  // One commit is enough: the response says what the theme is on and how many commits wait.
  const commits = useApiQuery(
    () =>
      api.commits.list({
        repository: mapping.repository,
        branch: mapping.branch,
        page: 1,
        perPage: 1,
        themeId: mapping.themeId,
      }),
    [mapping.id],
  );
  const last = useApiQuery(
    () => api.sync.last({ themeId: mapping.themeId, branch: mapping.branch }),
    [mapping.id],
  );
  const role = theme ? THEME_ROLE_BADGE[theme.role] : null;
  const lastSynced = commits.data?.lastSynced ?? null;
  const run = last.data ?? null;
  const result = run ? RESULT_BADGE[run.status] : undefined;
  const status =
    commits.loading || last.loading
      ? { label: "Checking…", tone: "neutral" as const, description: "" }
      : mappingStatus({
          themeName: mapping.themeName,
          branch: mapping.branch,
          lastSyncedSha: lastSynced?.sha ?? null,
          waiting: commits.data ? commits.data.waiting : null,
          waitingMore: !!commits.data?.waitingMore,
          lastRunStatus: run?.status ?? null,
        });
  const open = go(`/mappings/${mapping.id}`);

  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="base">
        <s-clickable
          onClick={open}
          accessibilityLabel={`Open ${mapping.branch} → ${mapping.themeName}`}
        >
          <s-stack
            direction="inline"
            gap="small-200"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="git-branch" />
              <s-text type="strong">{mapping.branch}</s-text>
              <s-icon type="arrow-right" />
              <s-icon type="theme" />
              <s-text type="strong">{mapping.themeName}</s-text>
              {role && <s-badge tone={role.tone}>{role.label}</s-badge>}
              {themesLoaded && !theme && (
                <s-badge tone="critical">Theme deleted</s-badge>
              )}
            </s-stack>
            <s-badge tone={status.tone}>{status.label}</s-badge>
          </s-stack>
        </s-clickable>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
        >
          <s-stack gap="small-100">
            <s-text color="subdued">Theme is on</s-text>
            <s-text>
              {lastSynced
                ? `${lastSynced.shortSha} · ${firstLine(lastSynced.message)}`
                : "No commit synced yet"}
            </s-text>
          </s-stack>
          <s-stack gap="small-100">
            <s-text color="subdued">Last sync</s-text>
            {run && result ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={result.tone}>{result.label}</s-badge>
                <s-text>{`${syncTypeLabel(run.strategy)} · ${formatDate(run.completedAt)}`}</s-text>
              </s-stack>
            ) : (
              <s-text>{last.loading ? "…" : "No sync performed yet"}</s-text>
            )}
          </s-stack>
        </s-grid>

        <s-stack
          direction="inline"
          gap="small-200"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">{`Theme ID ${mapping.themeId.split("/").pop()} · mapped ${formatDate(mapping.createdAt)}`}</s-text>
          <s-button variant="primary" onClick={open}>
            {status.label === "Not synced yet"
              ? "Start full sync"
              : status.tone === "info"
                ? "Sync updates"
                : "Open"}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/**
 * Theme mapping: connect each repository branch to its own Shopify theme, for
 * example main → Live theme and staging → Staging copy. A branch syncs to one
 * theme only and a theme receives one branch only.
 */
export default function ThemeMapping() {
  const go = useNavigateHandler();
  const [params] = useSearchParams();
  const settings = useApiQuery(() => api.settings.get(), []);
  const github = useApiQuery(() => api.github.connection(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);

  const repository = settings.data?.settings.defaultRepository ?? "";
  const connected = !!github.data?.connected;
  const branches = useApiQuery(
    () => api.github.branches({ repository, perPage: 100 }),
    [repository, connected],
    !!repository && connected,
  );

  const [adding, setAdding] = useState(
    !!(params.get("branch") || params.get("themeId")),
  );
  const [newBranch, setNewBranch] = useState(params.get("branch") ?? "");
  const [newThemeId, setNewThemeId] = useState(params.get("themeId") ?? "");
  const [refreshKey, setRefreshKey] = useState(0);
  const create = useMutation(api.mappings.create);

  if (
    (settings.loading && !settings.data) ||
    (mappings.loading && !mappings.data)
  ) {
    return <LoadingState title="Theme mapping" />;
  }

  if (!repository || !connected) {
    return (
      <AppLayout title="Theme mapping">
        <s-section heading="Connect a repository first">
          <s-paragraph>
            Connect GitHub and choose a repository in Settings, then map its
            branches to themes here.
          </s-paragraph>
          <s-button
            slot="secondary-actions"
            variant="primary"
            onClick={go("/settings")}
          >
            Open settings
          </s-button>
        </s-section>
      </AppLayout>
    );
  }

  const items = mappings.data?.items ?? [];
  const sameRepo = (m: Mapping) =>
    m.repository.toLowerCase() === repository.toLowerCase();
  const repoItems = items.filter(sameRepo);
  const otherRepoItems = items.filter((m) => !sameRepo(m));
  const allThemes = themes.data ?? [];
  const branchList: GithubBranch[] = branches.data?.items ?? [];
  const mappingForBranch = (name: string) =>
    repoItems.find((m) => m.branch === name);
  const themeBlocked = (t: ShopifyTheme): string | null => {
    if (!t.writable) return "cannot be synced";
    const m = items.find((x) => x.themeId === t.id);
    return m ? `mapped to ${m.branch}` : null;
  };
  const freeBranches = branchList.filter((b) => !mappingForBranch(b.name));
  const freeThemes = allThemes.filter((t) => !themeBlocked(t));
  const showForm = adding || repoItems.length === 0;
  const nothingFree =
    !branches.loading &&
    !themes.loading &&
    (freeBranches.length === 0 || freeThemes.length === 0);

  const refresh = () => {
    mappings.reload();
    setRefreshKey((k) => k + 1);
  };

  const doCreate = async () => {
    if (!newBranch || !newThemeId) return;
    const created = await create.run({
      branch: newBranch,
      themeId: newThemeId,
    });
    if (created) {
      showToast(`${created.branch} → ${created.themeName} added`);
      setNewBranch("");
      setNewThemeId("");
      setAdding(false);
      refresh();
    }
  };

  return (
    <AppLayout
      title="Theme mapping"
      subtitle={`${repository} · each branch syncs to its own theme`}
      primaryAction={
        showForm
          ? undefined
          : { content: "Add mapping", onAction: () => setAdding(true) }
      }
      secondaryActions={[
        {
          content: "Refresh",
          onAction: () => (refresh(), themes.reload(), branches.reload()),
        },
      ]}
      banners={
        <>
          <ErrorBanner
            error={settings.error ?? mappings.error}
            onRetry={() => (settings.reload(), mappings.reload())}
          />
          <ErrorBanner
            error={themes.error}
            heading="Themes could not be loaded"
            onRetry={themes.reload}
          />
          <ErrorBanner
            error={branches.error}
            heading="Branches could not be loaded"
            onRetry={branches.reload}
          />
        </>
      }
    >
      {showForm && (
        <s-section
          heading={
            repoItems.length === 0 ? "Map your first branch" : "Add a mapping"
          }
        >
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Pick a branch and the theme it should update — for example{" "}
              <s-text type="strong">main → Live theme</s-text> and{" "}
              <s-text type="strong">staging → Staging copy</s-text>. A branch
              updates one theme only, and a theme is updated by one branch only.
              Nothing in the theme changes until you sync.
            </s-paragraph>
            {nothingFree ? (
              <s-banner tone="info">
                <s-paragraph>
                  {freeBranches.length === 0
                    ? "Every branch is already mapped. Remove or change a mapping to free a branch."
                    : "Every theme that can be synced is already mapped. Remove or change a mapping to free a theme, or duplicate a theme in Shopify."}
                </s-paragraph>
              </s-banner>
            ) : (
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                gap="base"
                alignItems="end"
              >
                <s-select
                  label="Branch"
                  value={newBranch || NONE}
                  details={
                    branches.loading
                      ? "Loading branches…"
                      : `${freeBranches.length} of ${branchList.length} branches free`
                  }
                  onChange={(event) =>
                    setNewBranch(
                      event.currentTarget.value === NONE
                        ? ""
                        : event.currentTarget.value,
                    )
                  }
                >
                  <s-option value={NONE}>Select a branch</s-option>
                  {branchList.map((b) => {
                    const m = mappingForBranch(b.name);
                    return (
                      <s-option key={b.name} value={b.name} disabled={!!m}>
                        {`${b.name}${m ? ` — mapped to ${m.themeName}` : ""}`}
                      </s-option>
                    );
                  })}
                  {newBranch &&
                    !branchList.some((b) => b.name === newBranch) && (
                      <s-option value={newBranch}>{newBranch}</s-option>
                    )}
                </s-select>
                <s-select
                  label="Shopify theme"
                  value={newThemeId || NONE}
                  details={
                    themes.loading
                      ? "Loading themes…"
                      : `${freeThemes.length} of ${allThemes.length} themes free`
                  }
                  onChange={(event) =>
                    setNewThemeId(
                      event.currentTarget.value === NONE
                        ? ""
                        : event.currentTarget.value,
                    )
                  }
                >
                  <s-option value={NONE}>Select a theme</s-option>
                  {allThemes.map((t) => {
                    const reason = themeBlocked(t);
                    return (
                      <s-option key={t.id} value={t.id} disabled={!!reason}>
                        {`${themeLabel(t)}${reason ? ` — ${reason}` : ""}`}
                      </s-option>
                    );
                  })}
                </s-select>
                <s-stack direction="inline" gap="small-200">
                  <s-button
                    variant="primary"
                    disabled={!newBranch || !newThemeId}
                    loading={create.pending}
                    onClick={doCreate}
                  >
                    Add mapping
                  </s-button>
                  {repoItems.length > 0 && (
                    <s-button
                      variant="tertiary"
                      onClick={() => (setAdding(false), create.clearError())}
                    >
                      Cancel
                    </s-button>
                  )}
                </s-stack>
              </s-grid>
            )}
            <ErrorBanner
              error={create.error}
              heading="Mapping not added"
              onDismiss={create.clearError}
            />
          </s-stack>
        </s-section>
      )}

      {repoItems.length > 0 && (
        <s-section heading={`Mappings (${repoItems.length})`}>
          <s-stack gap="base">
            {repoItems.map((m) => (
              <MappingCard
                key={`${m.id}:${refreshKey}`}
                mapping={m}
                theme={allThemes.find((t) => t.id === m.themeId)}
                themesLoaded={!!themes.data}
              />
            ))}
          </s-stack>
        </s-section>
      )}

      {otherRepoItems.length > 0 && (
        <s-section heading="Mappings of other repositories">
          <s-stack gap="small-200">
            <s-paragraph color="subdued">
              These themes are mapped to another repository and cannot be used
              here until that mapping is removed (select that repository in
              Settings to manage them).
            </s-paragraph>
            {otherRepoItems.map((m) => (
              <s-text
                key={m.id}
              >{`${m.repository} · ${m.branch} → ${m.themeName}`}</s-text>
            ))}
          </s-stack>
        </s-section>
      )}
    </AppLayout>
  );
}
