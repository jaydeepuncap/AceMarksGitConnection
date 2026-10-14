import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBanner } from '../../app/components/ErrorBanner';
import { LoadingState } from '../../app/components/LoadingState';
import { ApiClientError } from '../../app/lib/api-client';
import type * as ApiClientModule from '../../app/lib/api-client';
import type { UpdateRunDetail, UpdatesResponse } from '../../app/lib/types';
import History from '../../app/routes/History';
import UpdateRun from '../../app/routes/UpdateRun';
import { UpdateList } from '../../app/components/UpdateList';
import { Route, Routes } from 'react-router-dom';

vi.mock('../../app/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      overview: vi.fn(),
      stores: vi.fn(),
      history: vi.fn(),
      settings: { get: vi.fn(), update: vi.fn() },
      commits: { files: vi.fn() },
      themes: { list: vi.fn(), overview: vi.fn(), get: vi.fn() },
      updates: { list: vi.fn(), get: vi.fn(), plan: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), retry: vi.fn() },
    },
  };
});
const { api } = await import('../../app/lib/api-client');
type Fn = ReturnType<typeof vi.fn>;
const mocked = api as unknown as {
  themes: { list: Fn };
  overview: Fn;
  stores: Fn;
  history: Fn;
  updates: { list: Fn; get: Fn };
};

const wrap = (ui: React.ReactNode, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('loading and error states', () => {
  it('renders an accessible loading state', () => {
    wrap(<LoadingState title="Themes" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the error message, a code-specific hint and the request ID', () => {
    const err = new ApiClientError(400, 'GITHUB_NOT_CONNECTED', 'Connect GitHub first', undefined, undefined, 'req-123');
    wrap(<ErrorBanner error={err} onRetry={() => undefined} />);
    expect(screen.getByText('Connect GitHub first')).toBeInTheDocument();
    expect(screen.getByText(/Connect a GitHub account in Settings/)).toBeInTheDocument();
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
    expect(screen.getByText('Open settings')).toBeInTheDocument();
  });

  it('renders nothing without an error', () => {
    const { container } = wrap(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const C1 = '1'.repeat(40);
const C3 = '3'.repeat(40);

function makeRun(overrides: Partial<UpdateRunDetail> = {}): UpdateRunDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    selection: { allowDeletes: true, skippedPaths: [] },
    kind: 'update',
    line: 'staging',
    status: 'previewed',
    phase: 'review',
    shopDomain: 'acemarks.myshopify.com',
    theme: { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Staging', role: 'UNPUBLISHED' },
    repository: 'acemarks-collection/master-theme',
    branch: 'main',
    base: { sha: C1, shortSha: '1111111', message: 'Add custom CSS' },
    target: { sha: C3, shortSha: '3333333', message: 'Update cart functionality' },
    direction: 'forward',
    commits: [
      {
        sha: C3,
        shortSha: '3333333',
        message: 'Update cart functionality',
        date: null,
        authorName: null,
        files: [
          { path: 'snippets/cart-item.liquid', change: 'added', protected: false, ignored: false },
          { path: 'snippets/old-cart.liquid', change: 'removed', protected: false, ignored: false },
        ],
        filesTruncated: false,
      },
    ],
    checks: {
      code: { status: 'passed', filesChecked: 7, filesDeferred: 0, issues: [] },
      directEdits: { status: 'passed', files: [], note: null },
    },
    totals: { added: 2, updated: 3, removed: 2, protectedUntouched: 0, skipped: 0 },
    progress: { total: 7, succeeded: 0, failed: 0, pending: 7, backedUp: 0 },
    warnings: [],
    errorDetails: null,
    attempt: 0,
    verifiedOnStagingAt: null,
    restoredFromId: null,
    rolloutId: null,
    previewExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    initiatedAt: '2026-10-06T11:00:00Z',
    confirmedAt: null,
    startedAt: null,
    completedAt: null,
    actions: {
      canConfirm: true,
      needsDirectEditApproval: false,
      blockedByCodeErrors: false,
      canCancel: true,
      canRetry: false,
      canRerun: false,
      canRestore: false,
      canPublish: false,
    },
    files: [],
    ...overrides,
  };
}

const renderRun = (run: UpdateRunDetail) => {
  mocked.updates.get.mockResolvedValue(run);
  mocked.overview.mockResolvedValue({ store: { name: 'Ace Marks', shopDomain: 'acemarks.myshopify.com' }, live: { lastSynced: null, waiting: 0 } });
  return wrap(
    <Routes>
      <Route path="/updates/:id" element={<UpdateRun />} />
    </Routes>,
    `/updates/${run.id}`,
  );
};

describe('update screens', () => {
  it('a theme\u2019s commit list shows NEW / CURRENT, file counts and the apply action', async () => {
    const list: UpdatesResponse = {
      line: 'staging',
      shopifyTheme: null,
      theme: { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Staging' },
      repository: 'acemarks-collection/master-theme',
      branch: 'main',
      current: { sha: C1, shortSha: '1111111', message: 'Add custom CSS', branch: 'main', syncedAt: null, verifiedOnStagingAt: null },
      currentFound: true,
      waiting: 1,
      waitingMore: false,
      items: [
        { sha: C3, shortSha: '3333333', message: 'Update cart functionality', authorName: null, authorLogin: null, authorAvatarUrl: null, date: '2026-10-06T10:00:00Z', htmlUrl: '', parents: [], state: 'new', applied: false, verified: false, counts: { added: 1, modified: 2, removed: 1 } },
        { sha: C1, shortSha: '1111111', message: 'Add custom CSS', authorName: null, authorLogin: null, authorAvatarUrl: null, date: '2026-10-04T10:00:00Z', htmlUrl: '', parents: [], state: 'current', applied: true, verified: true, counts: { added: 0, modified: 1, removed: 0 } },
      ],
      page: 1,
      hasNextPage: false,
    };
    mocked.updates.list.mockResolvedValue(list);
    wrap(<UpdateList mode="update" themeId="gid://shopify/OnlineStoreTheme/1" />, '/themes/1');
    await waitFor(() => expect(screen.getByText('Update cart functionality')).toBeInTheDocument());
    expect(screen.getByText(/1 commit pending sync on main/)).toBeInTheDocument();
    expect(screen.getByText('Pending sync')).toBeInTheDocument();
    expect(screen.getByText('Last synced')).toBeInTheDocument();
    expect(screen.getByText('~2')).toBeInTheDocument();
    expect(screen.getAllByText('Update to this →')).toHaveLength(1);
  });

  it('review shows checks, every update and file, and the confirm action', async () => {
    renderRun(makeRun());
    await waitFor(() => expect(screen.getByText('Confirm update to Staging')).toBeInTheDocument());
    expect(screen.getByText('No Liquid or JSON errors in 7 files')).toBeInTheDocument();
    expect(screen.getByText('snippets/cart-item.liquid')).toBeInTheDocument();
    expect(screen.getByText('2 new')).toBeInTheDocument();
    expect(screen.getByText('2 removed')).toBeInTheDocument();
    expect(screen.getByText(/Checks passed/)).toBeInTheDocument();
  });

  it('asks before replacing files edited directly in Shopify', async () => {
    renderRun(
      makeRun({
        checks: {
          code: { status: 'passed', filesChecked: 7, filesDeferred: 0, issues: [] },
          directEdits: { status: 'warning', files: [{ path: 'assets/cart.css', updatedAt: '2026-10-05T09:00:00Z', reason: 'edited' }], note: null },
        },
        actions: { ...makeRun().actions, needsDirectEditApproval: true },
      }),
    );
    await waitFor(() => expect(screen.getByText('Replace and continue')).toBeInTheDocument());
    expect(screen.getByText('Stop and ask developer')).toBeInTheDocument();
    expect(screen.getByText(/assets\/cart.css was edited in Shopify/)).toBeInTheDocument();
    expect(screen.queryByText('Confirm update to Staging')).not.toBeInTheDocument();
  });

  it('blocks code errors', async () => {
    renderRun(
      makeRun({
        checks: {
          code: { status: 'failed', filesChecked: 7, filesDeferred: 0, issues: [{ path: 'sections/cart.liquid', line: 3, message: '{% if %} is never closed with {% endif %}' }] },
          directEdits: { status: 'passed', files: [], note: null },
        },
        actions: { ...makeRun().actions, canConfirm: false, blockedByCodeErrors: true },
      }),
    );
    await waitFor(() => expect(document.querySelector('s-banner[heading^="Problems found"]')).not.toBeNull());
    expect(screen.getByText(/sections\/cart.liquid line 3/)).toBeInTheDocument();
    expect(screen.queryByText('Confirm update to Staging')).not.toBeInTheDocument();
  });

  it('an incomplete update explains each failed file and offers retry, run again and restore', async () => {
    renderRun(
      makeRun({
        status: 'partially_failed',
        phase: 'done',
        confirmedAt: '2026-10-06T11:29:00Z',
        progress: { total: 7, succeeded: 5, failed: 2, pending: 0, backedUp: 7 },
        actions: { ...makeRun().actions, canConfirm: false, canCancel: false, canRetry: true, canRerun: true, canRestore: true },
        files: [
          { id: 'a', path: 'sections/cart.liquid', action: 'upsert', change: 'modified', status: 'failed', introducedBy: '3333333', skipReason: null, error: 'Shopify is busy', errorKind: 'transient', backup: 'saved', attempts: 3 },
          { id: 'b', path: 'snippets/cart-item.liquid', action: 'upsert', change: 'added', status: 'failed', introducedBy: '3333333', skipReason: null, error: 'Code error on line 2', errorKind: 'code', backup: 'absent', attempts: 1 },
        ],
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('s-banner[heading="Update incomplete · 5 of 7 files updated"]')).not.toBeNull(),
    );
    expect(screen.getAllByText('Can be retried').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs developer fix').length).toBeGreaterThan(0);
    for (const label of ['Retry failed files', 'Run full update again', 'Restore backup']) {
      expect(screen.getAllByText(label).some((el) => el.tagName.toLowerCase() === 's-button')).toBe(true);
    }
  });

  it('update history lists runs per theme', async () => {
    mocked.history.mockResolvedValue({
      items: [makeRun({ status: 'succeeded', phase: 'done', kind: 'publish', line: 'live', theme: { id: 'x', name: 'Live', role: 'MAIN' }, confirmedAt: '2026-10-06T15:10:00Z' })],
      page: 1,
      perPage: 25,
      hasNextPage: false,
    });
    mocked.overview.mockResolvedValue({ store: { name: 'Ace Marks' } });
    mocked.themes.list.mockResolvedValue([{ id: 'x', name: 'Live', isLive: true }]);
    wrap(<History />, '/history');
    await waitFor(() => expect(screen.getAllByText('Live').length).toBeGreaterThan(0));
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Publish to Live')).toBeInTheDocument();
    expect(screen.getByText('3333333')).toBeInTheDocument();
  });
});
