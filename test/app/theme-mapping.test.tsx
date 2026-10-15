import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ApiClientModule from '../../app/lib/api-client';
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
      settings: { get: vi.fn().mockResolvedValue({ shop: {}, settings: { defaultRepository: 'acme/theme', defaultBranch: 'main' } }) },
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
      },
      themes: { list: vi.fn().mockResolvedValue([theme('1', 'abc'), theme('2', 'xyz'), theme('3', 'spare')]) },
      mappings: {
        list: vi.fn().mockResolvedValue({ items: [mapping('m1', 'main', '1', 'abc'), mapping('m2', 'staging', '2', 'xyz')] }),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      sync: { last: vi.fn().mockResolvedValue(null), preview: vi.fn(), confirm: vi.fn() },
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
    await waitFor(() => expect(container.querySelector('s-section[heading="Mappings (2)"]')).not.toBeNull());
    expect(screen.getAllByText('Sync commits')).toHaveLength(2);
    expect(await screen.findAllByText('Last sync: no sync performed yet')).toHaveLength(2);

    const option = (text: string) => [...container.querySelectorAll('s-option')].find((o) => o.textContent === text);
    await waitFor(() => expect(option('main — mapped to abc')).toBeDefined());
    expect(option('main — mapped to abc')!.hasAttribute('disabled')).toBe(true);
    expect(option('dev')!.hasAttribute('disabled')).toBe(false);
    expect(option('xyz — mapped to staging')!.hasAttribute('disabled')).toBe(true);
    expect(option('spare')!.hasAttribute('disabled')).toBe(false);
  });
});
