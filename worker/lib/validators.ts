/**
 * Request validation (zod) for every API route, plus identifier validators for
 * shop domains, GitHub names, commit SHAs and Shopify theme IDs.
 */
import { z } from 'zod';
import { SYNC_STRATEGY_VALUES } from '../../shared/api-types';
import { ignorePatternError, MAX_IGNORE_PATTERNS, normalizeThemeRoot, validateThemePath } from '../../shared/theme-paths';
import { badRequest } from './response';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Returns the canonical lowercase shop domain, or null if it is not a *.myshopify.com host. */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (value.length > 255 || !SHOP_DOMAIN.test(value)) return null;
  return value;
}

// GitHub: owner 1–39 chars (alnum + single hyphens), repo up to 100 chars of [A-Za-z0-9._-].
const GITHUB_OWNER = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;
const GITHUB_REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

export const repositorySchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\.git$/, ''))
  .refine((v) => {
    const [owner, name, ...rest] = v.split('/');
    return rest.length === 0 && !!owner && !!name && GITHUB_OWNER.test(owner) && GITHUB_REPO.test(name);
  }, 'Repository must look like "owner/name"');

export function splitRepository(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/') as [string, string];
  return { owner, repo };
}

/** Git ref names: no "..", no control chars/space/~^:?*[\, not starting with "-" or "/". */
export const branchSchema = z
  .string()
  .trim()
  .min(1)
  .max(250)
  .refine(
    // eslint-disable-next-line no-control-regex
    (v) => !/(\.\.|[\u0000- ~^:?*[\\]|@\{|\/\/|^[-/]|\/$|\.lock$|\.$)/.test(v),
    'Invalid branch name',
  );

export const commitShaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{40}$/, 'Commit SHA must be the full 40-character hexadecimal SHA');

/** Accepts a numeric theme ID or an OnlineStoreTheme GID; returns the GID. */
export const themeIdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^(gid:\/\/shopify\/OnlineStoreTheme\/)?\d{1,20}$/.test(v), 'Invalid Shopify theme ID')
  .transform((v) => (v.startsWith('gid://') ? v : `gid://shopify/OnlineStoreTheme/${v}`));

export const themePathSchema = z.string().superRefine((value, ctx) => {
  const result = validateThemePath(value);
  if (!result.ok) ctx.addIssue({ code: 'custom', message: result.reason });
});

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
});

export const repositoriesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
});

export const branchesQuerySchema = paginationSchema.extend({
  repository: repositorySchema.optional(),
});

export const branchQuerySchema = z
  .object({
    repository: repositorySchema.optional(),
    name: branchSchema,
  })
  .strict();

export const commitsQuerySchema = paginationSchema.extend({
  repository: repositorySchema.optional(),
  branch: branchSchema.optional(),
  /** Mark each commit New / Last synced / Added for this theme. */
  themeId: themeIdSchema.optional(),
  path: z.string().trim().max(255).optional(),
});

export const commitQuerySchema = z.object({
  repository: repositorySchema.optional(),
});

export const commitFilesQuerySchema = paginationSchema.extend({
  repository: repositorySchema.optional(),
  perPage: z.coerce.number().int().min(1).max(300).default(100),
});

export const historyQuerySchema = paginationSchema.extend({
  themeId: themeIdSchema.optional(),
  branch: branchSchema.optional(),
  status: z
    .enum(['previewed', 'queued', 'running', 'succeeded', 'partially_failed', 'failed', 'cancelled', 'expired'])
    .optional(),
  includePreviews: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /** Sync type. */
  strategy: z.enum(SYNC_STRATEGY_VALUES).optional(),
  /** Started on or after this day (YYYY-MM-DD, UTC). */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  /** Started on or before this day (YYYY-MM-DD, UTC, inclusive). */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});

export const uuidSchema = z.string().uuid('Invalid ID');

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
const ignorePatternSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const error = ignorePatternError(v);
    if (error) ctx.addIssue({ code: 'custom', message: `Ignore pattern "${v}": ${error}` });
  });

export const syncPreferencesPatchSchema = z
  .object({
    strategy: z.enum(SYNC_STRATEGY_VALUES).optional(),
    allowDeletes: z.boolean().optional(),
    themeRoot: z
      .string()
      .max(200)
      .transform((v, ctx) => {
        const r = normalizeThemeRoot(v);
        if (!r.ok) {
          ctx.addIssue({ code: 'custom', message: r.reason });
          return z.NEVER;
        }
        return r.root;
      })
      .optional(),
    ignorePatterns: z
      .array(ignorePatternSchema)
      .max(MAX_IGNORE_PATTERNS)
      // Duplicates are dropped; the order the merchant entered is kept.
      .transform((patterns) => [...new Set(patterns)])
      .optional(),
  })
  .strict();

export const ignorePreviewSchema = z
  .object({ patterns: z.array(ignorePatternSchema).max(MAX_IGNORE_PATTERNS) })
  .strict();

export const updateSettingsSchema = z
  .object({
    defaultRepository: repositorySchema.nullable().optional(),
    defaultBranch: branchSchema.nullable().optional(),
    defaultThemeId: themeIdSchema.nullable().optional(),
    syncPreferences: syncPreferencesPatchSchema.optional(),
  })
  .strict();

export const createGithubConnectionSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(20, 'Token looks too short')
      .max(400)
      .regex(/^(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)$/, 'Expected a GitHub personal access token'),
    repository: repositorySchema.optional(),
  })
  .strict();

/** Most commits a multi-commit sync can combine. */
export const MAX_SELECTED_COMMITS = 50;

export const syncPreviewSchema = z
  .object({
    repository: repositorySchema.optional(),
    branch: branchSchema.optional(),
    commitSha: commitShaSchema,
    themeId: themeIdSchema,
    strategy: z.enum(SYNC_STRATEGY_VALUES).optional(),
    commitShas: z.array(commitShaSchema).min(2).max(MAX_SELECTED_COMMITS).optional(),
    allowDeletes: z.boolean().optional(),
    includePaths: z.array(themePathSchema).max(3000).optional(),
  })
  .strict()
  .refine((v) => (v.strategy === 'selected_commits') === (v.commitShas !== undefined), {
    message: 'Select at least two commits for strategy "selected_commits" (and only for it)',
    path: ['commitShas'],
  })
  .refine((v) => !v.commitShas || v.commitShas.includes(v.commitSha), {
    message: 'commitSha must be one of the selected commits (the newest)',
    path: ['commitSha'],
  });

export const confirmSyncSchema = z
  .object({
    syncId: uuidSchema,
    confirm: z.literal(true, { message: 'Explicit confirmation (confirm: true) is required' }),
    confirmLiveTheme: z.boolean().optional(),
    confirmThemeName: z.string().max(200).optional(),
    acceptDirectEdits: z.boolean().optional(),
  })
  .strict();

export const retrySyncSchema = z
  .object({
    confirmLiveTheme: z.boolean().optional(),
    confirmThemeName: z.string().max(200).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'The request contains invalid parameters',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Reads a JSON body with a size cap; rejects non-JSON content types. */
export async function readJsonBody(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    throw badRequest('Content-Type must be application/json');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw badRequest('Request body is too large');
  const text = await request.text();
  if (text.length > maxBytes) throw badRequest('Request body is too large');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
}

export const createMappingSchema = z
  .object({
    repository: repositorySchema.optional(),
    branch: branchSchema,
    themeId: themeIdSchema,
  })
  .strict();

export const updateMappingSchema = z
  .object({
    branch: branchSchema.optional(),
    themeId: themeIdSchema.optional(),
    confirm: z.literal(true),
  })
  .strict()
  .refine((v) => v.branch !== undefined || v.themeId !== undefined, 'Give a new branch or theme');

export const removeMappingSchema = z.object({ confirm: z.literal(true) }).strict();

export const lastSyncQuerySchema = z
  .object({
    themeId: themeIdSchema,
    branch: branchSchema.optional(),
  })
  .strict();

export const commitStatsQuerySchema = z
  .object({
    repository: repositorySchema.optional(),
    shas: z
      .string()
      .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(commitShaSchema).min(1).max(30)),
  })
  .strict();
