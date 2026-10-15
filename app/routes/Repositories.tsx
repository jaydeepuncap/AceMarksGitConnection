import { useState } from "react";
import { AppLayout } from "../components/AppLayout";
import { ErrorBanner } from "../components/ErrorBanner";
import { api } from "../lib/api-client";
import { showToast } from "../lib/app-bridge";
import { formatDate } from "../lib/format";
import { useApiQuery, useMutation, useNavigateHandler } from "../lib/hooks";

const PER_PAGE = 30;

export default function Repositories() {
  const go = useNavigateHandler();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const repos = useApiQuery(
    () => api.github.repositories({ page, perPage: PER_PAGE }),
    [page],
  );
  const settings = useApiQuery(() => api.settings.get(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const select = useMutation(api.settings.update);
  const mappedIn = (fullName: string) =>
    (mappings.data?.items ?? []).filter(
      (m) => m.repository.toLowerCase() === fullName.toLowerCase(),
    );

  const current = settings.data?.settings.defaultRepository;
  const needle = filter.trim().toLowerCase();
  const items = (repos.data?.items ?? []).filter(
    (r) => !needle || r.fullName.toLowerCase().includes(needle),
  );

  const choose = async (fullName: string) => {
    const result = await select.run({ defaultRepository: fullName });
    if (result) {
      settings.setData(result);
      showToast(
        `Using ${fullName} (branch ${result.settings.defaultBranch ?? "default"})`,
      );
    }
  };

  return (
    <AppLayout
      title="Repositories"
      subtitle="Repositories the connected GitHub token can access · open one to see its branches and themes"
      backAction={{ content: "Settings", onAction: () => go("/settings")() }}
      banners={
        <>
          <ErrorBanner error={repos.error} onRetry={repos.reload} />
          <ErrorBanner
            error={select.error}
            heading="Repository could not be selected"
            onDismiss={select.clearError}
          />
        </>
      }
    >
      <s-section padding="none" accessibilityLabel="Repositories">
        <s-table
          variant="auto"
          loading={repos.loading}
          paginate
          hasPreviousPage={page > 1}
          hasNextPage={!!repos.data?.hasNextPage}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
        >
          <s-search-field
            slot="filters"
            label="Filter repositories on this page"
            labelAccessibilityVisibility="exclusive"
            placeholder="Filter by name"
            value={filter}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
          <s-table-header-row>
            <s-table-header listSlot="primary">Repository</s-table-header>
            <s-table-header listSlot="secondary">Default branch</s-table-header>
            <s-table-header listSlot="labeled">Mapped branches</s-table-header>
            <s-table-header listSlot="labeled">Updated</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {items.map((repo) => (
              <s-table-row key={repo.id}>
                <s-table-cell>
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-clickable
                      onClick={go(`/repositories/${repo.fullName}`)}
                      accessibilityLabel={`Open ${repo.fullName}`}
                    >
                      <s-text type="strong">{repo.fullName}</s-text>
                    </s-clickable>
                    {repo.private && <s-badge tone="neutral">Private</s-badge>}
                    {current === repo.fullName && (
                      <s-badge tone="success">Selected</s-badge>
                    )}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{repo.defaultBranch}</s-table-cell>
                <s-table-cell>
                  {mappedIn(repo.fullName).length === 0 ? (
                    <s-text color="subdued">None</s-text>
                  ) : (
                    <s-text>
                      {mappedIn(repo.fullName)
                        .map((m) => `${m.branch} → ${m.themeName}`)
                        .join(", ")}
                    </s-text>
                  )}
                </s-table-cell>
                <s-table-cell>{formatDate(repo.updatedAt)}</s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200">
                    <s-button
                      variant="primary"
                      onClick={go(`/repositories/${repo.fullName}`)}
                    >
                      Open
                    </s-button>
                    <s-button
                      disabled={current === repo.fullName}
                      loading={select.pending}
                      accessibilityLabel={`Use ${repo.fullName}`}
                      onClick={() => choose(repo.fullName)}
                    >
                      {current === repo.fullName
                        ? "Selected"
                        : "Use this repository"}
                    </s-button>
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {!repos.loading && items.length === 0 && !repos.error && (
          <s-box padding="base">
            <s-paragraph color="subdued">
              No repositories found. Fine-grained tokens only see repositories
              listed under “Repository access”.
            </s-paragraph>
          </s-box>
        )}
      </s-section>
    </AppLayout>
  );
}
