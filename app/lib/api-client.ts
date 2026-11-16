/**
 * Authenticated client for the Worker API.
 *
 * - Attaches `Authorization: Bearer <session token>` from App Bridge to every call.
 * - 401 with X-Shopify-Retry-Invalid-Session-Request: fetch a new token, retry once.
 * - 401 SHOPIFY_REAUTH_REQUIRED / 403 with a reauthorize URL: top-level redirect.
 * - 429: surfaces Retry-After; GETs are retried once automatically after it.
 * - 5xx/network: GETs retried once with backoff; writes are never auto-retried.
 * Responses use the { success, data | error } envelope from shared/api-types.ts.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  IgnorePreviewResponse,
  SyncStrategy,
  CommitStatsResponse,
  CreateThemeMappingRequest,
  ThemeMapping,
  ThemeMappingsResponse,
  UpdateThemeMappingRequest,
  ApiResponse,
  AppSettings,
  CommitDetail,
  CommitFilesResponse,
  CommitsResponse,
  LastSynced,
  ConfirmSyncRequest,
  CreateGithubConnectionRequest,
  GithubBranch,
  GithubConnectionResponse,
  GithubRepository,
  Paginated,
  RetrySyncRequest,
  SettingsResponse,
  ShopifyTheme,
  SyncPreview,
  SyncPreviewRequest,
  SyncRun,
  SyncRunDetail,
  SyncStatus,
  UpdateSettingsRequest,
} from './types';
import { getSessionToken, redirectTopLevel } from './app-bridge';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
    readonly retryAfter?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Query = Record<string, string | number | boolean | null | undefined>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);
  let tokenRetried = false;
  let transientRetried = false;

  for (;;) {
    const token = await getSessionToken();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      if (method === 'GET' && !transientRetried) {
        transientRetried = true;
        await sleep(800);
        continue;
      }
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Network error. Check your connection and try again.');
    }

    // Expired/invalid session token: get a new one and retry once (safe for any method,
    // because the server rejected the request before doing anything).
    if (
      response.status === 401 &&
      response.headers.get('X-Shopify-Retry-Invalid-Session-Request') === '1' &&
      !tokenRetried
    ) {
      tokenRetried = true;
      continue;
    }

    const reauthUrl = response.headers.get('X-Shopify-API-Request-Failure-Reauthorize-Url');
    if (response.status === 403 && reauthUrl) {
      redirectTopLevel(reauthUrl);
      throw new ApiClientError(403, 'SHOPIFY_REAUTH_REQUIRED', 'Redirecting to re-authorize the app…');
    }

    let payload: ApiResponse<T> | null;
    try {
      payload = (await response.json()) as ApiResponse<T>;
    } catch {
      payload = null;
    }

    if (response.ok && payload?.success) return payload.data;

    const error = (payload as ApiErrorBody | null)?.error;
    const retryAfter = Number(response.headers.get('Retry-After') ?? error?.retryAfter ?? NaN);

    if (method === 'GET' && !transientRetried && (response.status >= 500 || response.status === 429)) {
      const wait = response.status === 429 && Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
      if (wait <= 5000) {
        transientRetried = true;
        await sleep(wait);
        continue;
      }
    }

    throw new ApiClientError(
      response.status,
      error?.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'),
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
      error?.requestId,
    );
  }
}

/** Typed endpoint map — mirrors worker/routes/*. */
export const api = {
  settings: {
    get: () => apiRequest<SettingsResponse>('GET', '/api/settings'),
    update: (body: UpdateSettingsRequest) => apiRequest<SettingsResponse>('PUT', '/api/settings', { body }),
    ignorePreview: (patterns: string[]) =>
      apiRequest<IgnorePreviewResponse>('POST', '/api/settings/ignore-preview', { body: { patterns } }),
  },
  github: {
    connection: () => apiRequest<GithubConnectionResponse>('GET', '/api/github/connection'),
    connect: (body: CreateGithubConnectionRequest) =>
      apiRequest<GithubConnectionResponse>('POST', '/api/github/connection', { body }),
    disconnect: () => apiRequest<GithubConnectionResponse>('DELETE', '/api/github/connection'),
    repositories: (query: { page?: number; perPage?: number; q?: string } = {}) =>
      apiRequest<Paginated<GithubRepository>>('GET', '/api/github/repositories', { query }),
    branches: (query: { repository?: string; page?: number; perPage?: number } = {}) =>
      apiRequest<Paginated<GithubBranch>>('GET', '/api/github/branches', { query }),
    repository: (repository: string) => apiRequest<GithubRepository>('GET', '/api/github/repository', { query: { repository } }),
    branch: (name: string, repository?: string) =>
      apiRequest<GithubBranch>('GET', '/api/github/branch', { query: { name, repository } }),
  },
  mappings: {
    list: () => apiRequest<ThemeMappingsResponse>('GET', '/api/mappings'),
    create: (body: CreateThemeMappingRequest) => apiRequest<ThemeMapping>('POST', '/api/mappings', { body }),
    update: (id: string, body: UpdateThemeMappingRequest) =>
      apiRequest<ThemeMapping>('PUT', `/api/mappings/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => apiRequest<ThemeMapping>('DELETE', `/api/mappings/${encodeURIComponent(id)}`, { body: { confirm: true } }),
  },
  themes: {
    list: (refresh = false) => apiRequest<ShopifyTheme[]>('GET', '/api/themes', { query: { refresh: refresh ? 1 : undefined } }),
    lastSynced: () => apiRequest<Record<string, LastSynced>>('GET', '/api/themes/last-synced'),
  },
  commits: {
    list: (query: { repository?: string; branch?: string; page?: number; perPage?: number; path?: string; themeId?: string }) =>
      apiRequest<CommitsResponse>('GET', '/api/commits', { query }),
    get: (sha: string, repository?: string) =>
      apiRequest<CommitDetail>('GET', `/api/commits/${encodeURIComponent(sha)}`, { query: { repository } }),
    files: (sha: string, query: { repository?: string; page?: number; perPage?: number } = {}) =>
      apiRequest<CommitFilesResponse>('GET', `/api/commits/${encodeURIComponent(sha)}/files`, { query }),
    stats: (shas: string[], repository?: string) =>
      apiRequest<CommitStatsResponse>('GET', '/api/commits/stats', { query: { shas: shas.join(','), repository } }),
  },
  sync: {
    preview: (body: SyncPreviewRequest) => apiRequest<SyncPreview>('POST', '/api/sync/preview', { body }),
    confirm: (body: ConfirmSyncRequest) => apiRequest<SyncRun>('POST', '/api/sync', { body }),
    history: (
      query: {
        page?: number;
        perPage?: number;
        status?: SyncStatus;
        themeId?: string;
        branch?: string;
        strategy?: SyncStrategy;
        from?: string;
        to?: string;
      } = {},
    ) =>
      apiRequest<Paginated<SyncRun>>('GET', '/api/sync/history', { query }),
    get: (id: string) => apiRequest<SyncRunDetail>('GET', `/api/sync/history/${encodeURIComponent(id)}`),
    retry: (id: string, body: RetrySyncRequest = {}) =>
      apiRequest<SyncRun>('POST', `/api/sync/history/${encodeURIComponent(id)}/retry`, { body }),
    last: (query: { themeId: string; branch?: string }) => apiRequest<SyncRun | null>('GET', '/api/sync/last', { query }),
    restore: (id: string, body: RetrySyncRequest = {}) =>
      apiRequest<SyncRun>('POST', `/api/sync/history/${encodeURIComponent(id)}/restore`, { body }),
  },
};

export type { AppSettings };
