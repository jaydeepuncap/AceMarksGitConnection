import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBanner } from '../../app/components/ErrorBanner';
import { LoadingState } from '../../app/components/LoadingState';
import { ApiClientError } from '../../app/lib/api-client';
import type * as ApiClientModule from '../../app/lib/api-client';
import SyncHistory from '../../app/routes/SyncHistory';

vi.mock('../../app/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      github: {
        repositories: vi.fn(),
        branches: vi.fn().mockResolvedValue({ items: [], page: 1, perPage: 100, hasNextPage: false }),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ shop: {}, settings: { defaultRepository: null } }),
        update: vi.fn(),
      },
      themes: { list: vi.fn().mockResolvedValue([]) },
      mappings: { list: vi.fn().mockResolvedValue({ items: [] }) },
      sync: { history: vi.fn(), get: vi.fn(), retry: vi.fn() },
    },
  };
});
const { api } = await import('../../app/lib/api-client');
const mocked = api as unknown as {
  github: { repositories: ReturnType<typeof vi.fn> };
  settings: { get: ReturnType<typeof vi.fn> };
  sync: { history: ReturnType<typeof vi.fn> };
};

const wrap = (ui: React.ReactNode, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('loading and error states', () => {
  it('renders an accessible loading state', () => {
    wrap(<LoadingState title="Themes" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the error message, a code-specific hint and the request ID', () => {
    const err = new ApiClientError(
      400,
      'GITHUB_NOT_CONNECTED',
      'Connect GitHub first',
      undefined,
      undefined,
      'req-123',
    );
    wrap(<ErrorBanner error={err} onRetry={() => undefined} />);
    expect(screen.getByText('Connect GitHub first')).toBeInTheDocument();
    expect(screen.getByText(/Connect a GitHub account in Settings/)).toBeInTheDocument();
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
    expect(screen.getByText('Open settings')).toBeInTheDocument();
  });

  it('shows "already up to date" as an info notice, not an error', () => {
    const err = new ApiClientError(
      409,
      'ALREADY_SYNCED',
      'Dawn is already on 5e41c63 from main',
      undefined,
      undefined,
      'req-9',
    );
    const { container } = wrap(<ErrorBanner error={err} heading="Preview failed" />);
    const banner = container.querySelector('s-banner')!;
    expect(banner.getAttribute('tone')).toBe('info');
    expect(banner.getAttribute('heading')).toBe('Already up to date');
    expect(screen.queryByText(/req-9/)).not.toBeInTheDocument();
  });

  it('renders nothing without an error', () => {
    const { container } = wrap(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('pages', () => {
  it('Sync details shows the result, counts, included commits and files', async () => {
    (api.sync.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a237643b-25d7-43af-a214-5266c0a5226d',
      repository: 'acme/theme',
      branch: 'UI-chages',
      commitSha: 'd818759' + '0'.repeat(33),
      commitMessage: 'Fix the upload issue',
      themeId: 'gid://shopify/OnlineStoreTheme/190367367473',
      themeName: 'Copy of Dawn',
      themeRole: 'UNPUBLISHED',
      strategy: 'selected_commits',
      status: 'succeeded',
      filesChanged: 1,
      filesSucceeded: 1,
      filesFailed: 0,
      filesSkipped: 0,
      filesIgnored: 0,
      errorDetails: null,
      attempt: 1,
      initiatedAt: '2026-11-19T10:59:03Z',
      startedAt: '2026-11-19T10:59:03Z',
      completedAt: '2026-11-19T10:59:06Z',
      canRetry: false,
      baseSha: '5e41c63' + '0'.repeat(33),
      commitsIncluded: [
        { sha: '2b69c0d' + '0'.repeat(33), shortSha: '2b69c0d', message: 'Add the slide show section' },
        { sha: 'd818759' + '0'.repeat(33), shortSha: 'd818759', message: 'Fix the upload issue' },
      ],
      backedUp: 1,
      allowDeletes: false,
      canRestore: false,
      restoredAt: null,
      restoredFiles: 0,
      operations: [
        {
          id: 'op1',
          path: 'sections/review-slide-show.liquid',
          action: 'upsert',
          status: 'succeeded',
          changeType: 'modified',
          previousPath: null,
          skipReason: null,
          sourceCommitSha: 'd818759' + '0'.repeat(33),
          attempts: 1,
          lastAttemptAt: null,
          failure: null,
        },
      ],
    });
    const { container } = wrap(<SyncHistory />, '/sync-history?id=a237643b-25d7-43af-a214-5266c0a5226d');
    expect(await screen.findByText('Update complete', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Copy of Dawn is now on d818759 · Fix the upload issue.')).toBeInTheDocument();
    expect(container.querySelector('s-section[heading="Updates included (2)"]')).not.toBeNull();
    expect(screen.getByText('Add the slide show section')).toBeInTheDocument();
    expect(screen.getByText('Theme is now on this')).toBeInTheDocument();
    expect(screen.getByText('Review slide show section')).toBeInTheDocument();
    expect(screen.getByText('Backed up')).toBeInTheDocument();
    expect(container.querySelector('s-button[href="shopify://admin/themes/190367367473/editor"]')).not.toBeNull();
  });

  it('Sync history lists runs with their status', async () => {
    mocked.sync.history.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          repository: 'acme/theme',
          branch: 'main',
          commitSha: 'b'.repeat(40),
          commitMessage: 'Update header\n\nbody',
          themeId: 'gid://shopify/OnlineStoreTheme/1',
          themeName: 'Dev copy',
          themeRole: 'UNPUBLISHED',
          strategy: 'commit_changes',
          status: 'partially_failed',
          filesChanged: 3,
          filesSucceeded: 2,
          filesFailed: 1,
          filesSkipped: 0,
          filesIgnored: 0,
          errorDetails: { code: 'FILES_FAILED', message: '1 file(s) failed to sync' },
          attempt: 1,
          initiatedAt: '2026-01-01T00:00:00Z',
          startedAt: null,
          completedAt: null,
          canRetry: true,
          baseSha: null,
          commitsIncluded: [],
          backedUp: 0,
          allowDeletes: false,
          canRestore: false,
          restoredAt: null,
          restoredFiles: 0,
        },
      ],
      page: 1,
      perPage: 20,
      hasNextPage: false,
    });
    wrap(<SyncHistory />, '/sync-history');
    await waitFor(() => expect(screen.getByText('bbbbbbb')).toBeInTheDocument());
    expect(screen.getByText('Update header')).toBeInTheDocument();
    expect(screen.getAllByText('Partially failed').length).toBeGreaterThan(0);
    // File counts are on the sync's own page, not in the list.
    expect(screen.queryByText(/ok · .* failed/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Single commit').length).toBeGreaterThan(1); // type column + filter option
    expect(screen.getByText('View / retry')).toBeInTheDocument();
  });
});

describe('themeFileLabel', () => {
  it('turns theme paths into readable names', async () => {
    const { themeFileLabel } = await import('../../app/lib/format');
    expect(themeFileLabel('sections/cart.liquid')).toBe('Cart section');
    expect(themeFileLabel('snippets/cart-item.liquid')).toBe('Cart item snippet');
    expect(themeFileLabel('blocks/cart-item.liquid')).toBe('Cart item block');
    expect(themeFileLabel('templates/customers/account.json')).toBe('Customers account template');
    expect(themeFileLabel('assets/cart.css')).toBe('cart.css');
  });
});
