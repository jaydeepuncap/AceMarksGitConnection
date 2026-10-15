import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ApiClientModule from '../../app/lib/api-client';
import { Route, Routes } from 'react-router-dom';
import MappingDetail from '../../app/routes/MappingDetail';
import Settings from '../../app/routes/Settings';
import ThemeMapping from '../../app/routes/ThemeMapping';

// vi.mock is hoisted above imports, so its fixtures must be hoisted too.
const { theme, mapping } = vi.hoisted(() => {
  const theme = (id: string, name: string, role = 'UNPUBLISHED') => ({
    id: `gid://shopify/OnlineStoreTheme/${id}`,
    numericId: id,
    name,
    role,
    processing: false,
    processingFailed: false,
    isLive: role === 'MAIN',
    writable: true,
    createdAt: null,
    updatedAt: null,
  });
  const mapping = (id: string, branch: string, themeId: string, themeName: string) => ({
    id,
    repository: 'acme/theme',
    branch,
    themeId: `gid://shopify/OnlineStoreTheme/${themeId}`,
    themeName,
    createdAt: '2026-10-15T10:00:00Z',
  });
  return { theme, mapping };
});

vi.mock('../../app/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      settings: {
        get: vi.fn().mockResolvedValue({
          shop: { canWriteThemes: true },
          settings: {
            defaultRepository: 'acme/theme',
            defaultBranch: 'main',
            syncPreferences: { themeRoot: '', ignorePatterns: [] },
          },
        }),
        update: vi.fn(),
      },
      github: {
        connection: vi.fn().mockResolvedValue({ connected: true, connection: null }),
        branches: vi.fn().mockResolvedValue({
          items: [
            { name: 'main', commitSha: 'a'.repeat(40), protected: false },
            { name: 'staging', commitSha: 'b'.repeat(40), protected: false },
            { name: 'dev', commitSha: 'c'.repeat(40), protected: false },
          ],
          page: 1,
          perPage: 100,
          hasNextPage: false,
        }),
        branch: vi.fn(),
        repositories: vi.fn().mockResolvedValue({
          items: [{ id: 1, fullName: 'acme/theme', private: true, defaultBranch: 'main' }],
          page: 1,
          perPage: 100,
          hasNextPage: false,
        }),
        repository: vi.fn().mockResolvedValue({
          id: 1,
          fullName: 'acme/theme',
          owner: 'acme',
          name: 'theme',
          private: true,
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/acme/theme',
          updatedAt: '2026-10-13T10:00:00Z',
          permissions: { pull: true, push: false, admin: false },
        }),
      },
      themes: {
        list: vi.fn().mockResolvedValue([theme('1', 'abc'), theme('2', 'xyz'), theme('3', 'spare')]),
        lastSynced: vi.fn().mockResolvedValue({}),
      },
      mappings: {
        list: vi
          .fn()
          .mockResolvedValue({ items: [mapping('m1', 'main', '1', 'abc'), mapping('m2', 'staging', '2', 'xyz')] }),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      sync: {
        last: vi.fn().mockResolvedValue(null),
        preview: vi.fn(),
        confirm: vi.fn(),
        history: vi.fn().mockResolvedValue({ items: [], page: 1, perPage: 10, hasNextPage: false }),
      },
      commits: {
        list: vi.fn().mockResolvedValue({
          items: [
            {
              sha: 'd'.repeat(40),
              shortSha: 'ddddddd',
              message: 'Add banner',
              authorName: 'Dev',
              authorLogin: 'dev',
              authorAvatarUrl: null,
              date: '2026-10-15T09:00:00Z',
              htmlUrl: '',
              parents: [],
              syncStatus: 'new',
            },
            {
              sha: 'e'.repeat(40),
              shortSha: 'eeeeeee',
              message: 'Fix header',
              authorName: 'Dev',
              authorLogin: 'dev',
              authorAvatarUrl: null,
              date: '2026-10-14T09:00:00Z',
              htmlUrl: '',
              parents: [],
              syncStatus: 'last_synced',
            },
          ],
          page: 1,
          perPage: 20,
          hasNextPage: false,
          lastSynced: {
            themeId: 'gid://shopify/OnlineStoreTheme/1',
            branch: 'main',
            sha: 'e'.repeat(40),
            shortSha: 'eeeeeee',
            message: 'Fix header',
            syncedAt: '2026-10-14T10:00:00Z',
            syncId: null,
          },
          waiting: 1,
          waitingMore: false,
        }),
        stats: vi.fn().mockResolvedValue({
          ['d'.repeat(40)]: { files: 3, truncated: false },
          ['e'.repeat(40)]: { files: 1, truncated: false },
        }),
        get: vi.fn().mockResolvedValue({
          sha: 'd'.repeat(40),
          message: 'Add banner',
          authorLogin: 'dev',
          authorName: 'Dev',
          date: '2026-10-14T11:00:00Z',
          filesCount: 1,
          filesTruncated: false,
          stats: { additions: 10, deletions: 2 },
        }),
        files: vi.fn().mockResolvedValue({
          items: [
            {
              filename: 'sections/banner.liquid',
              status: 'added',
              additions: 10,
              deletions: 2,
              themePath: 'sections/banner.liquid',
            },
          ],
          page: 1,
          perPage: 100,
          hasNextPage: false,
        }),
      },
    },
  };
});

describe('Theme mapping page', () => {
  it('lists every branch → theme mapping and only offers free branches and themes', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/mappings']}>
        <ThemeMapping />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Mappings (2)', {}, { timeout: 5000 })).toBeInTheDocument();
    // Each card says where its theme stands (the mocked commits list has 1 commit waiting).
    expect(await screen.findAllByText('1 update waiting', {}, { timeout: 5000 })).toHaveLength(2);
    expect(screen.getAllByText('Sync updates')).toHaveLength(2);
    // The commit was recorded from the theme file, not by a sync in this app — the card says so.
    expect(screen.getAllByText(/Not synced from this app yet · recorded from the theme file/)).toHaveLength(2);
    // The whole card is the clickable surface (no nested buttons).
    const cards = container.querySelectorAll(
      's-clickable[accessibilityLabel^="Open "], s-clickable[accessibilitylabel^="Open "]',
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('s-button')).toBeNull();

    // The add form opens from the page action and only offers free branches and themes.
    fireEvent.click(screen.getAllByText('Add mapping')[0]!);
    const option = (text: string) => [...container.querySelectorAll('s-option')].find((o) => o.textContent === text);
    await waitFor(() => expect(option('main — mapped to abc')).toBeDefined(), { timeout: 5000 });
    expect(option('main — mapped to abc')!.hasAttribute('disabled')).toBe(true);
    expect(option('dev')!.hasAttribute('disabled')).toBe(false);
    expect(option('xyz — mapped to staging')!.hasAttribute('disabled')).toBe(true);
    expect(option('spare')!.hasAttribute('disabled')).toBe(false);
  });
});

describe('Theme mapping page when everything is mapped', () => {
  it('disables "Add mapping" and explains why', async () => {
    const { api } = await import('../../app/lib/api-client');
    (api.github.branches as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        { name: 'main', commitSha: 'a'.repeat(40), protected: false },
        { name: 'staging', commitSha: 'b'.repeat(40), protected: false },
      ],
      page: 1,
      perPage: 100,
      hasNextPage: false,
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/mappings']}>
        <ThemeMapping />
      </MemoryRouter>,
    );
    const reason = /Each branch of acme\/theme already syncs to a theme/;
    expect((await screen.findAllByText(reason, {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    const add = [...container.querySelectorAll('s-button')].filter((b) => b.textContent === 'Add mapping');
    expect(add.length).toBeGreaterThan(0);
    for (const button of add) expect(button.hasAttribute('disabled')).toBe(true);
    // Only the page header offers "Add mapping"; a banner explains why it is disabled.
    expect(add).toHaveLength(1);
    expect(add[0]!.getAttribute('slot')).toBe('primary-action');
    expect(container.querySelector('s-banner[heading^="Every branch is mapped"]')).not.toBeNull();
  });
});

describe('Mapping page', () => {
  it('shows where the theme stands, its commits and applied syncs for the fixed branch and theme', async () => {
    render(
      <MemoryRouter initialEntries={['/mappings/m1']}>
        <Routes>
          <Route path="/mappings/:id" element={<MappingDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const wait = { timeout: 5000 };
    // Summary card: where the theme stands and the one next step.
    expect(await screen.findByText('eeeeeee · Fix header', {}, wait)).toBeInTheDocument();
    expect(await screen.findByText('Review 1 update', {}, wait)).toBeInTheDocument();
    expect(screen.getByText('1 commit')).toBeInTheDocument();
    // Commits tab (default).
    expect(await screen.findByText('Add banner', {}, wait)).toBeInTheDocument();
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Last synced').length).toBeGreaterThan(0);
    expect(screen.getByText('Select new (1)')).toBeInTheDocument();
    // History and Full sync tabs.
    fireEvent.click(screen.getByText('History'));
    expect(
      await screen.findByText('No syncs applied to this theme from this branch yet.', {}, wait),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Full sync'));
    expect(await screen.findByText('Review full sync', {}, wait)).toBeInTheDocument();
    // Change theme and Remove mapping are page actions at the top.
    expect(screen.getAllByText('Change theme').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remove mapping').length).toBeGreaterThan(0);
  });
});

describe('Commit selection on the mapping page', () => {
  it('syncs everything up to a new commit and re-applies only the files of a commit already in the theme', async () => {
    const { api } = await import('../../app/lib/api-client');
    const preview = api.sync.preview as unknown as ReturnType<typeof vi.fn>;
    preview.mockReset();
    preview.mockResolvedValue(null);
    const { container } = render(
      <MemoryRouter initialEntries={['/mappings/m1']}>
        <Routes>
          <Route path="/mappings/:id" element={<MappingDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const wait = { timeout: 5000 };
    await screen.findByText('Add banner', {}, wait);
    // Like the real checkbox: the element flips its own checked state, then dispatches change.
    const box = (shortSha: string) =>
      [...container.querySelectorAll('s-checkbox')].find(
        (c) => c.getAttribute('accessibilityLabel') === `Select commit ${shortSha}`,
      ) as HTMLElement & { checked?: boolean };
    const toggle = (shortSha: string) => {
      const el = box(shortSha);
      el.checked = !el.checked;
      fireEvent(el, new Event('change', { bubbles: true }));
    };
    expect(screen.queryByText('When you select one commit, sync')).not.toBeInTheDocument();
    const reviewSync = () => screen.getByText('Review sync');

    toggle('ddddddd');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    // A repeated change event keeps the commit selected once instead of flipping it back.
    fireEvent(box('ddddddd'), new Event('change', { bubbles: true }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(box('ddddddd').checked).toBe(true);
    fireEvent.click(reviewSync());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1), wait);
    expect(preview.mock.calls[0]![0]).toMatchObject({ commitSha: 'd'.repeat(40), strategy: 'since_last_sync' });

    toggle('ddddddd');
    toggle('eeeeeee');
    expect(box('ddddddd').checked).toBe(false);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(container.querySelector('s-banner[heading="eeeeeee is already in the theme"]')).not.toBeNull();
    fireEvent.click(reviewSync());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2), wait);
    expect(preview.mock.calls[1]![0]).toMatchObject({ commitSha: 'e'.repeat(40), strategy: 'commit_changes' });
  });
});

describe('Changed files of a commit', () => {
  it('opens in a modal from the commit row', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/mappings/m1']}>
        <Routes>
          <Route path="/mappings/:id" element={<MappingDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    const wait = { timeout: 5000 };
    await screen.findByText('Add banner', {}, wait);
    expect(await screen.findByText('3 files', {}, wait)).toBeInTheDocument();
    expect(screen.getByText('1 file')).toBeInTheDocument();
    expect(screen.queryByText(/Show files changed in/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('3 files'));
    expect(container.querySelector('s-modal[heading="Files changed in ddddddd"]')).not.toBeNull();
    expect(await screen.findAllByText('sections/banner.liquid', {}, wait)).toHaveLength(2);
  });
});

describe('Store themes on the Theme mapping page', () => {
  it('lists every theme with the branch it receives and offers to map a free theme', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/mappings']}>
        <ThemeMapping />
      </MemoryRouter>,
    );
    const wait = { timeout: 5000 };
    expect(await screen.findByText('spare', {}, wait)).toBeInTheDocument();
    // main → abc and staging → xyz open their mapping; "spare" can receive a free branch.
    expect(await screen.findAllByText('Open mapping', {}, wait)).not.toHaveLength(0);
    fireEvent.click(screen.getByText('Map a branch'));
    await waitFor(() => expect(container.querySelector('s-section[heading="Add a mapping"]')).not.toBeNull(), wait);
    // The theme is preselected in the form.
    const themeSelect = [...container.querySelectorAll('s-select')].find(
      (el) => el.getAttribute('label') === 'Shopify theme',
    );
    expect(themeSelect?.getAttribute('value')).toBe('gid://shopify/OnlineStoreTheme/3');
  });
});

describe('Settings', () => {
  it('chooses one repository, with no branch choice and no separate repositories page', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <Settings />
      </MemoryRouter>,
    );
    const wait = { timeout: 5000 };
    expect(await screen.findByText('View on GitHub', {}, wait)).toBeInTheDocument();
    expect(screen.getByText('Default branch main')).toBeInTheDocument();
    const labels = [...container.querySelectorAll('s-select')].map((el) => el.getAttribute('label'));
    expect(labels).toContain('Repository');
    expect(labels).not.toContain('Branch');
    expect(screen.queryByText('Browse repositories')).not.toBeInTheDocument();
  });
});
