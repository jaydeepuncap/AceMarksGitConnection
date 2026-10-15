import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { themeLabel } from '../components/MappingControls';
import { StatTile } from '../components/Common';
import { api } from '../lib/api-client';
import { showToast } from '../lib/app-bridge';
import { formatDate, THEME_ROLE_BADGE } from '../lib/format';
import { useApiQuery, useMutation } from '../lib/hooks';
import type { GithubBranch, ShopifyTheme, ThemeMapping } from '../lib/types';

const NONE = '__none__';
const BRANCHES_PER_PAGE = 50;

/** "Map to a theme" inside a branch row: pick a free theme and map it. */
function MapBranchControl({
  branch,
  repository,
  freeThemes,
  disabledReason,
  onMapped,
}: {
  branch: string;
  repository: string;
  freeThemes: ShopifyTheme[];
  disabledReason: string | null;
  onMapped: (mapping: ThemeMapping) => void;
}) {
  const [open, setOpen] = useState(false);
  const [themeId, setThemeId] = useState('');
  const create = useMutation(api.mappings.create);
  if (disabledReason) return <s-text color="subdued">{disabledReason}</s-text>;
  if (!open) {
    return (
      <s-button variant="secondary" disabled={freeThemes.length === 0} onClick={() => setOpen(true)}>
        {freeThemes.length === 0 ? 'No free theme' : 'Map to a theme'}
      </s-button>
    );
  }
  const save = async () => {
    const created = await create.run({ repository, branch, themeId });
    if (created) {
      showToast(`${created.branch} → ${created.themeName} added`);
      onMapped(created);
    }
  };
  return (
    <s-stack gap="small-200">
      <s-select
        label={`Theme for ${branch}`}
        labelAccessibilityVisibility="exclusive"
        value={themeId || NONE}
        onChange={(event) => setThemeId(event.currentTarget.value === NONE ? '' : event.currentTarget.value)}
      >
        <s-option value={NONE}>Select a theme</s-option>
        {freeThemes.map((t) => (
          <s-option key={t.id} value={t.id}>
            {themeLabel(t)}
          </s-option>
        ))}
      </s-select>
      <s-stack direction="inline" gap="small-200">
        <s-button variant="primary" disabled={!themeId} loading={create.pending} onClick={save}>
          Map
        </s-button>
        <s-button variant="tertiary" onClick={() => (setOpen(false), setThemeId(''), create.clearError())}>
          Cancel
        </s-button>
      </s-stack>
      {create.error && <s-text tone="critical">{create.error.message}</s-text>}
    </s-stack>
  );
}

/**
 * One repository: its details, every branch with the theme it is mapped to,
 * and the store's themes with the branch each one receives.
 */
export default function RepositoryDetail() {
  const { owner = '', name = '' } = useParams();
  const fullName = `${owner}/${name}`;
  const navigate = useNavigate();
  const [branchPage, setBranchPage] = useState(1);

  const repo = useApiQuery(() => api.github.repository(fullName), [fullName]);
  const branches = useApiQuery(
    () =>
      api.github.branches({
        repository: fullName,
        page: branchPage,
        perPage: BRANCHES_PER_PAGE,
      }),
    [fullName, branchPage],
  );
  const settings = useApiQuery(() => api.settings.get(), []);
  const themes = useApiQuery(() => api.themes.list(), []);
  const mappings = useApiQuery(() => api.mappings.list(), []);
  const select = useMutation(api.settings.update);

  if (repo.loading && !repo.data) return <LoadingState title={fullName} />;

  const data = repo.data;
  const selected = settings.data?.settings.defaultRepository?.toLowerCase() === fullName.toLowerCase();
  const all = mappings.data?.items ?? [];
  const here = all.filter((m) => m.repository.toLowerCase() === fullName.toLowerCase());
  const allThemes = themes.data ?? [];
  const branchList: GithubBranch[] = branches.data?.items ?? [];
  const freeThemes = allThemes.filter((t) => t.writable && !all.some((m) => m.themeId === t.id));
  const themeFor = (id: string) => allThemes.find((t) => t.id === id);

  const choose = async () => {
    const result = await select.run({ defaultRepository: fullName });
    if (result) {
      settings.setData(result);
      showToast(`Using ${fullName}`);
    }
  };

  return (
    <AppLayout
      title={fullName}
      subtitle={
        data ? `${data.private ? 'Private' : 'Public'} repository · default branch ${data.defaultBranch}` : undefined
      }
      backAction={{
        content: 'Repositories',
        onAction: () => navigate('/repositories'),
      }}
      primaryAction={
        selected || !data
          ? undefined
          : {
              content: 'Use this repository',
              onAction: choose,
              loading: select.pending,
            }
      }
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => (repo.reload(), branches.reload(), mappings.reload(), themes.reload()),
        },
      ]}
      banners={
        <>
          <ErrorBanner error={repo.error} heading="Repository could not be read" onRetry={repo.reload} />
          <ErrorBanner error={select.error} heading="Repository could not be selected" onDismiss={select.clearError} />
          {data && !selected && (
            <s-banner tone="info" heading="This is not the selected repository">
              <s-paragraph>
                Theme mapping and syncing work with the repository selected in Settings. Use this repository to map its
                branches to themes.
              </s-paragraph>
            </s-banner>
          )}
        </>
      }
    >
      {data && (
        <s-section accessibilityLabel="Repository">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type="git-repository" />
                <s-text type="strong">{data.fullName}</s-text>
                <s-badge tone="neutral">{data.private ? 'Private' : 'Public'}</s-badge>
                {selected && <s-badge tone="success">Selected</s-badge>}
                <s-badge tone={data.permissions.push ? 'info' : 'neutral'}>
                  {data.permissions.push ? 'Read & write' : 'Read only'}
                </s-badge>
              </s-stack>
              <s-link href={data.htmlUrl} target="_blank">
                View on GitHub
              </s-link>
            </s-stack>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
              <StatTile label="Default branch">
                <s-text type="strong">{data.defaultBranch}</s-text>
              </StatTile>
              <StatTile label="Branches">
                <s-text type="strong">
                  {branches.loading && !branches.data
                    ? '…'
                    : `${branchList.length}${branches.data?.hasNextPage ? '+' : ''}`}
                </s-text>
              </StatTile>
              <StatTile label="Mapped branches" hint={here.length ? 'each to its own theme' : 'none yet'}>
                <s-text type="strong">{here.length}</s-text>
              </StatTile>
              <StatTile label="Free themes" hint="not mapped to any branch">
                <s-text type="strong">{themes.loading && !themes.data ? '…' : freeThemes.length}</s-text>
              </StatTile>
              <StatTile label="Last updated">
                <s-text type="strong">{formatDate(data.updatedAt)}</s-text>
              </StatTile>
            </s-grid>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Branches and their themes">
        <s-stack gap="base">
          <ErrorBanner error={branches.error} heading="Branches could not be loaded" onRetry={branches.reload} />
          <s-table
            variant="auto"
            loading={branches.loading}
            paginate
            hasPreviousPage={branchPage > 1}
            hasNextPage={!!branches.data?.hasNextPage}
            onPreviousPage={() => setBranchPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setBranchPage((p) => p + 1)}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">Branch</s-table-header>
              <s-table-header listSlot="labeled">Latest commit</s-table-header>
              <s-table-header listSlot="secondary">Shopify theme</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {branchList.map((b) => {
                const m = here.find((x) => x.branch === b.name);
                const theme = m ? themeFor(m.themeId) : undefined;
                const role = theme ? THEME_ROLE_BADGE[theme.role] : null;
                return (
                  <s-table-row key={b.name}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-icon type="git-branch" />
                        <s-text type="strong">{b.name}</s-text>
                        {data?.defaultBranch === b.name && <s-badge tone="info">Default</s-badge>}
                        {b.protected && <s-badge tone="neutral">Protected</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-link href={`https://github.com/${fullName}/commit/${b.commitSha}`} target="_blank">
                        {b.commitSha.slice(0, 7)}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {m ? (
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-icon type="theme" />
                          <s-text>{m.themeName}</s-text>
                          {role && <s-badge tone={role.tone}>{role.label}</s-badge>}
                          {themes.data && !theme && <s-badge tone="critical">Theme deleted</s-badge>}
                        </s-stack>
                      ) : (
                        <s-text color="subdued">Not mapped</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {m ? (
                        <s-button variant="primary" onClick={() => navigate(`/mappings/${m.id}`)}>
                          Open mapping
                        </s-button>
                      ) : (
                        <MapBranchControl
                          branch={b.name}
                          repository={fullName}
                          freeThemes={freeThemes}
                          disabledReason={selected ? null : 'Use this repository to map'}
                          onMapped={(created) => (mappings.reload(), navigate(`/mappings/${created.id}`))}
                        />
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {!branches.loading && !branches.error && branchList.length === 0 && (
            <s-paragraph color="subdued">This repository has no branches.</s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Store themes">
        <s-stack gap="base">
          <ErrorBanner error={themes.error} heading="Themes could not be loaded" onRetry={themes.reload} />
          <s-table variant="auto" loading={themes.loading}>
            <s-table-header-row>
              <s-table-header listSlot="primary">Theme</s-table-header>
              <s-table-header listSlot="inline">Role</s-table-header>
              <s-table-header listSlot="secondary">Receives</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {allThemes.map((t) => {
                const m = all.find((x) => x.themeId === t.id);
                const role = THEME_ROLE_BADGE[t.role];
                const fromHere = m && m.repository.toLowerCase() === fullName.toLowerCase();
                return (
                  <s-table-row key={t.id}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-text type="strong">{t.name}</s-text>
                        <s-text color="subdued">{`ID ${t.numericId}`}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={role.tone}>{role.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {m ? (
                        <s-text>{fromHere ? `Branch ${m.branch}` : `${m.repository} · ${m.branch}`}</s-text>
                      ) : (
                        <s-text color="subdued">{t.writable ? 'Free — not mapped' : 'Cannot be synced'}</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {m && fromHere ? (
                        <s-button variant="tertiary" onClick={() => navigate(`/mappings/${m.id}`)}>
                          Open mapping
                        </s-button>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>
    </AppLayout>
  );
}
