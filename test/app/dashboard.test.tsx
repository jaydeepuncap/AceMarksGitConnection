import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ApiClientModule from '../../app/lib/api-client';
import Dashboard from '../../app/routes/Dashboard';

const { mapping, run } = vi.hoisted(() => ({
  mapping: {
    id: 'm1',
    repository: 'acme/theme',
    branch: 'main',
    themeId: 'gid://shopify/OnlineStoreTheme/1',
    themeName: 'Dawn',
    createdAt: '2026-10-15T10:00:00Z',
  },
  run: {
    id: 'r1',
    repository: 'acme/theme',
    branch: 'main',
    commitSha: 'a'.repeat(40),
    commitMessage: 'Fix header',
    themeId: 'gid://shopify/OnlineStoreTheme/1',
    themeName: 'Dawn',
    themeRole: 'UNPUBLISHED',
    strategy: 'full_snapshot',
    status: 'failed',
    initiatedAt: '2026-10-15T10:00:00Z',
    startedAt: '2026-10-15T10:00:00Z',
    completedAt: '2026-10-15T10:01:00Z',
    commitsIncluded: [],
  },
}));

vi.mock('../../app/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      settings: {
        get: vi.fn().mockResolvedValue({
          shop: { shopDomain: 'acme.myshopify.com', status: 'installed', canReadThemes: true, canWriteThemes: true },
          settings: { defaultRepository: 'acme/theme' },
        }),
      },
      github: {
        connection: vi.fn().mockResolvedValue({ connected: true, connection: { accountLogin: 'octo' } }),
      },
      sync: {
        history: vi.fn().mockResolvedValue({ items: [run], page: 1, perPage: 5, hasNextPage: false }),
        last: vi.fn().mockResolvedValue(null),
      },
      mappings: { list: vi.fn().mockResolvedValue({ items: [mapping] }) },
      themes: {
        list: vi
          .fn()
          .mockResolvedValue([
            { id: mapping.themeId, numericId: '1', name: 'Dawn', role: 'UNPUBLISHED', writable: true },
          ]),
      },
      commits: {
        list: vi.fn().mockResolvedValue({ items: [], lastSynced: null, waiting: 0, waitingMore: false }),
      },
    },
  };
});

const wait = { timeout: 5000 };

describe('Dashboard', () => {
  it('shows the store at a glance once set up', async () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('acme.myshopify.com', {}, wait)).toBeInTheDocument();
    // Setup is complete: no checklist.
    expect(screen.queryByText('Get set up')).not.toBeInTheDocument();
    // Tiles, the mapping card and the recent sync that needs attention.
    expect(screen.getByText('Theme mappings')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Signed in as octo')).toBeInTheDocument();
    expect(screen.getByText('main → Dawn')).toBeInTheDocument();
    await waitFor(
      () => expect(container.querySelector('s-clickable[accessibilityLabel="Open main → Dawn"]')).not.toBeNull(),
      wait,
    );
  });

  it('guides through setup and says mappings are paused while GitHub is disconnected', async () => {
    const { api } = await import('../../app/lib/api-client');
    (api.github.connection as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      connected: false,
      connection: null,
    });
    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Get set up', {}, wait)).toBeInTheDocument();
    expect(screen.getByText('3 of 4 done')).toBeInTheDocument();
    expect(container.querySelector('s-banner[heading="GitHub is not connected"]')).not.toBeNull();
    // The next step's button is the primary one.
    const connect = [...container.querySelectorAll('s-button')].filter((b) => b.textContent === 'Connect GitHub');
    expect(connect.some((b) => b.getAttribute('variant') === 'primary')).toBe(true);
  });
});
