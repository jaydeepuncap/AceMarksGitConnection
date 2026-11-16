/**
 * Shopify Admin GraphQL client + the theme queries/mutations this app uses.
 *
 * Endpoint : POST https://{shop}/admin/api/{version}/graphql.json
 * Auth     : X-Shopify-Access-Token: <offline access token>  (never a session token)
 * Version  : env.SHOPIFY_API_VERSION (2026-07)
 *
 * Theme file APIs (OnlineStoreTheme.files, themeFilesUpsert, themeFilesDelete)
 * require `read_themes` / `write_themes`. Writing theme files additionally
 * requires an exemption granted by Shopify; without it the mutations return
 * ACCESS_DENIED, which this client maps to THEME_WRITE_NOT_PERMITTED.
 *
 * Rate limits: Shopify uses a calculated-cost leaky bucket. THROTTLED errors are
 * retried after waiting for enough points to restore, based on
 * extensions.cost.throttleStatus.
 */
import type { ShopifyTheme, ThemeRole } from '../../shared/api-types';
import { bytesToBase64 } from './crypto';
import { fetchWithRetry, sleep } from './http';
import type { Logger } from './logger';
import { ApiError } from './response';
import { ShopifyReauthRequiredError } from './sessions';

export interface ShopifyGraphqlOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  /** Max THROTTLED retries per request. */
  maxThrottleRetries?: number;
}

interface GraphqlError {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
  path?: (string | number)[];
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlError[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } };
}

export class ShopifyGraphqlClient {
  private readonly endpoint: string;

  constructor(private readonly options: ShopifyGraphqlOptions) {
    this.endpoint = `https://${options.shopDomain}/admin/api/${options.apiVersion}/graphql.json`;
  }

  get shopDomain(): string {
    return this.options.shopDomain;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const { logger, maxThrottleRetries = 4 } = this.options;
    for (let attempt = 0; ; attempt++) {
      const response = await fetchWithRetry(
        this.endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': this.options.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        },
        {
          timeoutMs: 30_000,
          // Every operation this client sends is safe to repeat (reads, or idempotent
          // upserts/deletes of the same content), so 5xx/network errors may be retried.
          idempotent: true,
          retries: 2,
          fetchImpl: this.options.fetchImpl,
          onRetry: (info) => logger.warn('shopify.graphql_retry', { shop: this.shopDomain, ...info }),
        },
      );

      if (response.status === 401) throw new ShopifyReauthRequiredError();
      if (response.status === 402) {
        throw new ApiError(402, 'SHOPIFY_ERROR', 'This store is frozen or its plan does not allow this action');
      }
      if (response.status === 403) {
        throw new ApiError(403, 'FORBIDDEN', 'The app is missing a required Shopify access scope');
      }
      if (response.status === 423) throw new ApiError(423, 'SHOPIFY_ERROR', 'This store is locked');
      if (response.status === 429) {
        throw new ApiError(429, 'SHOPIFY_THROTTLED', 'Shopify rate limit reached', { retryAfter: 2 });
      }
      if (!response.ok) {
        throw new ApiError(502, 'SHOPIFY_ERROR', `Shopify API responded with HTTP ${response.status}`);
      }

      const body = (await response.json()) as GraphqlResponse<T>;
      const errors = body.errors ?? [];

      if (errors.some((e) => e.extensions?.code === 'THROTTLED')) {
        const status = body.extensions?.cost?.throttleStatus;
        const cost = body.extensions?.cost?.requestedQueryCost ?? 50;
        const waitMs = status
          ? Math.ceil((Math.max(0, cost - status.currentlyAvailable) / Math.max(1, status.restoreRate)) * 1000) + 250
          : 2000;
        if (attempt < maxThrottleRetries) {
          logger.warn('shopify.graphql_throttled', { shop: this.shopDomain, waitMs, attempt });
          await sleep(Math.min(waitMs, 15_000));
          continue;
        }
        throw new ApiError(429, 'SHOPIFY_THROTTLED', 'Shopify rate limit reached', {
          retryAfter: Math.ceil(waitMs / 1000),
        });
      }

      const denied = errors.filter((e) => e.extensions?.code === 'ACCESS_DENIED');
      if (denied.length > 0) {
        // Include Shopify's own wording: it states whether a scope or the exemption is missing.
        const shopifySays = [...new Set(denied.map((e) => e.message.trim()))].join(' ').slice(0, 600);
        logger.warn('shopify.graphql_access_denied', { shop: this.shopDomain, errors: shopifySays });
        throw new ApiError(
          403,
          'THEME_WRITE_NOT_PERMITTED',
          'Shopify denied access. Writing theme files requires the write_themes scope AND a theme-modification ' +
            `exemption granted to this app by Shopify. Shopify said: ${shopifySays}`,
          { details: errors.map((e) => e.message) },
        );
      }

      if (errors.length > 0) {
        logger.error('shopify.graphql_errors', { shop: this.shopDomain, errors: errors.map((e) => e.message) });
        throw new ApiError(502, 'SHOPIFY_ERROR', 'Shopify GraphQL request failed', {
          details: errors.map((e) => e.message),
        });
      }
      if (!body.data) throw new ApiError(502, 'SHOPIFY_ERROR', 'Shopify GraphQL response had no data');
      return body.data;
    }
  }
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
const THEME_FIELDS = `
  id
  name
  role
  processing
  processingFailed
  createdAt
  updatedAt
`;

export const THEMES_QUERY = `#graphql
  query AceThemes($first: Int!, $after: String) {
    themes(first: $first, after: $after) {
      nodes { ${THEME_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const THEME_QUERY = `#graphql
  query AceTheme($id: ID!) {
    theme(id: $id) { ${THEME_FIELDS} }
  }
`;

export const THEME_FILES_QUERY = `#graphql
  query AceThemeFiles($id: ID!, $filenames: [String!], $first: Int!, $after: String) {
    theme(id: $id) {
      id
      files(filenames: $filenames, first: $first, after: $after) {
        nodes { filename size checksumMd5 updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const THEME_FILE_BODIES_QUERY = `#graphql
  query AceThemeFileBodies($id: ID!, $filenames: [String!], $first: Int!) {
    theme(id: $id) {
      id
      files(filenames: $filenames, first: $first) {
        nodes {
          filename
          body {
            __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
      }
    }
  }
`;

export const THEME_FILES_UPSERT_MUTATION = `#graphql
  mutation AceThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      job { id done }
      userErrors { field message code filename }
    }
  }
`;

export const THEME_FILES_DELETE_MUTATION = `#graphql
  mutation AceThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles { filename }
      userErrors { field message code filename }
    }
  }
`;

export const JOB_QUERY = `#graphql
  query AceJob($id: ID!) {
    job(id: $id) { id done }
  }
`;

interface RawTheme {
  id: string;
  name: string;
  role: ThemeRole;
  processing: boolean;
  processingFailed: boolean;
  createdAt: string;
  updatedAt: string;
}

const NON_WRITABLE_ROLES: ThemeRole[] = ['LOCKED', 'DEMO', 'ARCHIVED'];

export function toTheme(raw: RawTheme): ShopifyTheme {
  return {
    id: raw.id,
    numericId: raw.id.split('/').pop() ?? raw.id,
    name: raw.name,
    role: raw.role,
    processing: raw.processing,
    processingFailed: raw.processingFailed,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    isLive: raw.role === 'MAIN',
    writable: !NON_WRITABLE_ROLES.includes(raw.role) && !raw.processing,
  };
}

export async function listThemes(client: ShopifyGraphqlClient): Promise<ShopifyTheme[]> {
  const themes: ShopifyTheme[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      themes: { nodes: RawTheme[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await client.request(THEMES_QUERY, { first: 50, after });
    themes.push(...data.themes.nodes.map(toTheme));
    if (!data.themes.pageInfo.hasNextPage) break;
    after = data.themes.pageInfo.endCursor;
  }
  // Live theme first, then most recently updated.
  return themes.sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Fetches one theme of the authenticated shop; null if it does not exist in this shop. */
export async function getTheme(client: ShopifyGraphqlClient, themeId: string): Promise<ShopifyTheme | null> {
  const data = await client.request<{ theme: RawTheme | null }>(THEME_QUERY, { id: themeId });
  return data.theme ? toTheme(data.theme) : null;
}

export interface ThemeFileInfo {
  filename: string;
  size: number | null;
  checksumMd5: string | null;
  updatedAt: string | null;
}

interface ThemeFilesPage {
  theme: {
    files: {
      nodes: { filename: string; size: string | number | null; checksumMd5: string | null; updatedAt?: string | null }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  } | null;
}

/** Shopify accepts up to 50 filenames per files() lookup. */
const FILENAME_LOOKUP_BATCH = 50;

async function collectFiles(
  client: ShopifyGraphqlClient,
  themeId: string,
  filenames: string[] | null,
  maxPages: number,
): Promise<ThemeFileInfo[]> {
  const out: ThemeFileInfo[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: ThemeFilesPage = await client.request(THEME_FILES_QUERY, {
      id: themeId,
      filenames,
      first: 250,
      after,
    });
    if (!data.theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
    const files = data.theme.files;
    if (!files) break;
    for (const node of files.nodes) {
      out.push({
        filename: node.filename,
        size: node.size === null ? null : Number(node.size),
        checksumMd5: node.checksumMd5,
        updatedAt: node.updatedAt ?? null,
      });
    }
    if (!files.pageInfo.hasNextPage) break;
    after = files.pageInfo.endCursor;
  }
  return out;
}

/** Looks up which of `filenames` exist in the theme (metadata only, no bodies). */
export async function getThemeFilesMetadata(
  client: ShopifyGraphqlClient,
  themeId: string,
  filenames: string[],
): Promise<Map<string, ThemeFileInfo>> {
  const result = new Map<string, ThemeFileInfo>();
  for (let i = 0; i < filenames.length; i += FILENAME_LOOKUP_BATCH) {
    const batch = filenames.slice(i, i + FILENAME_LOOKUP_BATCH);
    for (const file of await collectFiles(client, themeId, batch, 2)) result.set(file.filename, file);
  }
  return result;
}

/** Lists every file in the theme (used by the full_snapshot preview). */
export async function listAllThemeFiles(client: ShopifyGraphqlClient, themeId: string): Promise<ThemeFileInfo[]> {
  return collectFiles(client, themeId, null, 40);
}

export type ThemeFileBody = { type: 'TEXT' | 'BASE64'; value: string };

export interface ThemeWriteResult {
  succeeded: string[];
  failed: { filename: string; message: string; code: string | null }[];
  jobId: string | null;
  jobDone: boolean;
}

interface UserError {
  field: string[] | null;
  message: string;
  code: string | null;
  filename: string | null;
}

/** Max files per themeFilesUpsert / themeFilesDelete call. */
export const THEME_WRITE_BATCH_LIMIT = 50;

function splitUserErrors(requested: string[], okNames: string[], userErrors: UserError[]) {
  const failed: ThemeWriteResult['failed'] = [];
  const failedNames = new Set<string>();
  for (const err of userErrors) {
    const filename = err.filename ?? null;
    if (filename) {
      failedNames.add(filename);
      failed.push({ filename, message: err.message, code: err.code });
    }
  }
  const generic = userErrors.filter((e) => !e.filename);
  const ok = new Set(okNames);
  for (const name of requested) {
    if (!ok.has(name) && !failedNames.has(name)) {
      failed.push({
        filename: name,
        message: generic[0]?.message ?? 'Shopify did not confirm this file',
        code: generic[0]?.code ?? null,
      });
    }
  }
  return failed;
}

export async function upsertThemeFiles(
  client: ShopifyGraphqlClient,
  themeId: string,
  files: { filename: string; body: ThemeFileBody }[],
): Promise<ThemeWriteResult> {
  if (files.length > THEME_WRITE_BATCH_LIMIT) throw new Error('Too many files in one upsert batch');
  const data = await client.request<{
    themeFilesUpsert: {
      upsertedThemeFiles: { filename: string }[] | null;
      job: { id: string; done: boolean } | null;
      userErrors: UserError[];
    } | null;
  }>(THEME_FILES_UPSERT_MUTATION, { themeId, files });
  const payload = data.themeFilesUpsert;
  if (!payload) throw new ApiError(502, 'SHOPIFY_ERROR', 'themeFilesUpsert returned no payload');
  const okNames = (payload.upsertedThemeFiles ?? []).map((f) => f.filename);
  const failed = splitUserErrors(
    files.map((f) => f.filename),
    okNames,
    payload.userErrors,
  );
  const failedSet = new Set(failed.map((f) => f.filename));
  return {
    succeeded: okNames.filter((n) => !failedSet.has(n)),
    failed,
    jobId: payload.job?.id ?? null,
    jobDone: payload.job ? payload.job.done : true,
  };
}

export async function deleteThemeFiles(
  client: ShopifyGraphqlClient,
  themeId: string,
  filenames: string[],
): Promise<ThemeWriteResult> {
  if (filenames.length > THEME_WRITE_BATCH_LIMIT) throw new Error('Too many files in one delete batch');
  const data = await client.request<{
    themeFilesDelete: { deletedThemeFiles: { filename: string }[] | null; userErrors: UserError[] } | null;
  }>(THEME_FILES_DELETE_MUTATION, { themeId, files: filenames });
  const payload = data.themeFilesDelete;
  if (!payload) throw new ApiError(502, 'SHOPIFY_ERROR', 'themeFilesDelete returned no payload');
  const okNames = (payload.deletedThemeFiles ?? []).map((f) => f.filename);

  // Deleting a file that is already gone is a success for our purposes (idempotent retries).
  const userErrors = payload.userErrors.filter((e) => !(e.code === 'NOT_FOUND' || /not found/i.test(e.message)));
  const alreadyGone = payload.userErrors
    .filter((e) => e.filename && (e.code === 'NOT_FOUND' || /not found/i.test(e.message)))
    .map((e) => e.filename as string);
  const succeeded = [...okNames, ...alreadyGone];
  const failed = splitUserErrors(filenames, succeeded, userErrors);
  return { succeeded, failed, jobId: null, jobDone: true };
}

/** Polls an asynchronous Shopify job until it finishes or `timeoutMs` elapses. */
export async function waitForJob(
  client: ShopifyGraphqlClient,
  jobId: string,
  timeoutMs = 20_000,
  intervalMs = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await client.request<{ job: { id: string; done: boolean } | null }>(JOB_QUERY, { id: jobId });
    if (!data.job || data.job.done) return true;
    await sleep(intervalMs);
  }
  return false;
}

export type ThemeFileBodyContent = { type: 'TEXT' | 'BASE64'; value: string };

/**
 * Current contents of `filenames` in the theme (backups before a sync).
 * Files that do not exist are absent from the map. Large binary files are
 * returned by Shopify as a URL and downloaded here.
 */
export async function getThemeFileBodies(
  client: ShopifyGraphqlClient,
  themeId: string,
  filenames: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, ThemeFileBodyContent>> {
  const result = new Map<string, ThemeFileBodyContent>();
  for (let i = 0; i < filenames.length; i += FILENAME_LOOKUP_BATCH) {
    const batch = filenames.slice(i, i + FILENAME_LOOKUP_BATCH);
    const data = await client.request<{
      theme: {
        files: { nodes: { filename: string; body: { content?: string; contentBase64?: string; url?: string } | null }[] } | null;
      } | null;
    }>(THEME_FILE_BODIES_QUERY, { id: themeId, filenames: batch, first: batch.length });
    if (!data.theme) throw new ApiError(404, 'NOT_FOUND', 'Theme not found in this store');
    for (const node of data.theme.files?.nodes ?? []) {
      const body = node.body;
      if (!body) continue;
      if (typeof body.content === 'string') result.set(node.filename, { type: 'TEXT', value: body.content });
      else if (typeof body.contentBase64 === 'string') result.set(node.filename, { type: 'BASE64', value: body.contentBase64 });
      else if (typeof body.url === 'string') {
        const response = await fetchWithRetry(body.url, { method: 'GET' }, { timeoutMs: 30_000, idempotent: true, retries: 2, fetchImpl });
        if (!response.ok) throw new ApiError(502, 'SHOPIFY_ERROR', `Could not download ${node.filename} for the backup`);
        result.set(node.filename, { type: 'BASE64', value: bytesToBase64(new Uint8Array(await response.arrayBuffer())) });
      }
    }
  }
  return result;
}
