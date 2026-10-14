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
  ApiResponse,
  BaselineRequest,
  CommitFilesResponse,
  ConfirmUpdateRequest,
  ConnectionTestResponse,
  CreateGithubConnectionRequest,
  CreateUpdatePlanRequest,
  GithubBranch,
  GithubConnectionResponse,
  OverviewResponse,
  Paginated,
  PublishOptionsResponse,
  RolloutConfirmRequest,
  RolloutConfirmResult,
  RolloutPreviewRequest,
  RolloutPreviewResult,
  RolloutResponse,
  SettingsResponse,
  ShopifyTheme,
  StoreSummary,
  ThemeLine,
  UpdateRun,
  UpdateRunDetail,
  UpdatesResponse,
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
  overview: (refresh = false) => apiRequest<OverviewResponse>('GET', '/api/overview', { query: { refresh: refresh ? 1 : undefined } }),
  stores: () => apiRequest<StoreSummary[]>('GET', '/api/stores'),
  settings: {
    get: () => apiRequest<SettingsResponse>('GET', '/api/settings'),
    update: (body: UpdateSettingsRequest) => apiRequest<SettingsResponse>('PUT', '/api/settings', { body }),
    test: () => apiRequest<ConnectionTestResponse>('POST', '/api/settings/test', { body: {} }),
  },
  github: {
    connection: () => apiRequest<GithubConnectionResponse>('GET', '/api/github/connection'),
    connect: (body: CreateGithubConnectionRequest) =>
      apiRequest<GithubConnectionResponse>('POST', '/api/github/connection', { body }),
    disconnect: () => apiRequest<GithubConnectionResponse>('DELETE', '/api/github/connection'),
    branches: (query: { repository?: string; page?: number; perPage?: number } = {}) =>
      apiRequest<Paginated<GithubBranch>>('GET', '/api/github/branches', { query }),
  },
  themes: {
    list: (refresh = false) => apiRequest<ShopifyTheme[]>('GET', '/api/themes', { query: { refresh: refresh ? 1 : undefined } }),
  },
  commits: {
    files: (sha: string, query: { page?: number; perPage?: number } = {}) =>
      apiRequest<CommitFilesResponse>('GET', `/api/commits/${encodeURIComponent(sha)}/files`, { query }),
  },
  updates: {
    list: (query: { line?: ThemeLine; ref?: 'branch' | 'current'; page?: number; perPage?: number } = {}) =>
      apiRequest<UpdatesResponse>('GET', '/api/updates', { query }),
    plan: (body: CreateUpdatePlanRequest) => apiRequest<UpdateRun>('POST', '/api/updates/plan', { body }),
    baseline: (body: BaselineRequest) => apiRequest<UpdateRun>('POST', '/api/updates/baseline', { body }),
    publishOptions: () => apiRequest<PublishOptionsResponse>('GET', '/api/updates/publish-options'),
    get: (id: string) => apiRequest<UpdateRunDetail>('GET', `/api/updates/${encodeURIComponent(id)}`),
    confirm: (id: string, body: ConfirmUpdateRequest = {}) =>
      apiRequest<UpdateRun>('POST', `/api/updates/${encodeURIComponent(id)}/confirm`, { body }),
    retry: (id: string) => apiRequest<UpdateRun>('POST', `/api/updates/${encodeURIComponent(id)}/retry`, { body: {} }),
    rerun: (id: string) => apiRequest<UpdateRun>('POST', `/api/updates/${encodeURIComponent(id)}/rerun`, { body: {} }),
    restore: (id: string) => apiRequest<UpdateRun>('POST', `/api/updates/${encodeURIComponent(id)}/restore`, { body: {} }),
    cancel: (id: string) => apiRequest<UpdateRun>('POST', `/api/updates/${encodeURIComponent(id)}/cancel`, { body: {} }),
  },
  history: (query: { page?: number; perPage?: number; line?: ThemeLine } = {}) =>
    apiRequest<Paginated<UpdateRun>>('GET', '/api/history', { query }),
  rollout: {
    get: (sha?: string) => apiRequest<RolloutResponse>('GET', '/api/rollout', { query: { sha } }),
    preview: (body: RolloutPreviewRequest) => apiRequest<RolloutPreviewResult[]>('POST', '/api/rollout/preview', { body }),
    confirm: (body: RolloutConfirmRequest) => apiRequest<RolloutConfirmResult[]>('POST', '/api/rollout/confirm', { body }),
  },
};
