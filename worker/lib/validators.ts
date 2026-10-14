/**
 * Request validation (zod) for every API route, plus identifier validators for
 * shop domains, GitHub names, commit SHAs and Shopify theme IDs.
 */
import { z } from 'zod';
import { normalizeThemeRoot, validateThemePath } from '../../shared/theme-paths';
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

export const commitsQuerySchema = paginationSchema.extend({
  repository: repositorySchema.optional(),
  branch: branchSchema.optional(),
  path: z.string().trim().max(255).optional(),
  withFiles: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const commitQuerySchema = z.object({
  repository: repositorySchema.optional(),
});

export const commitFilesQuerySchema = paginationSchema.extend({
  repository: repositorySchema.optional(),
  perPage: z.coerce.number().int().min(1).max(300).default(100),
});

export const lineSchema = z.enum(['staging', 'live', 'other']);

export const historyQuerySchema = paginationSchema.extend({
  line: lineSchema.optional(),
  themeId: themeIdSchema.optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'partially_failed', 'failed', 'cancelled']).optional(),
  branch: branchSchema.optional(),
  includeUnknownBranch: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const updatesQuerySchema = z.object({
  line: lineSchema.default('staging'),
  /** Any theme of the store (overrides `line`). */
  themeId: themeIdSchema.optional(),
  /** Branch to list (defaults to the store's branch). */
  branch: branchSchema.optional(),
  /** branch – newest updates first; current – the theme's update and earlier ones (going back). */
  ref: z.enum(['branch', 'current']).default('branch'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

export const rolloutQuerySchema = z.object({
  sha: commitShaSchema.optional(),
  /** Chosen test theme per store: "shop.myshopify.com:123,other.myshopify.com:456". */
  themes: z.string().max(2000).optional(),
});

export const uuidSchema = z.string().uuid('Invalid ID');

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
const ignorePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !v.includes('..') && !v.startsWith('/'), 'Invalid ignore pattern');

export const syncPreferencesPatchSchema = z
  .object({
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
    protectedPatterns: z.array(ignorePatternSchema).max(50).optional(),
    ignorePatterns: z.array(ignorePatternSchema).max(50).optional(),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    repository: repositorySchema.nullable().optional(),
    branch: branchSchema.nullable().optional(),
    stagingThemeId: themeIdSchema.nullable().optional(),
    liveThemeId: themeIdSchema.nullable().optional(),
    preferences: syncPreferencesPatchSchema.optional(),
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

export const createPlanSchema = z
  .object({
    kind: z.enum(['update', 'publish', 'rollback']),
    targetSha: commitShaSchema,
    themeId: themeIdSchema.optional(),
    line: lineSchema.optional(),
    branch: branchSchema.optional(),
  })
  .strict();

export const updateSelectionSchema = z
  .object({
    allowDeletes: z.boolean(),
    skippedPaths: z.array(themePathSchema).max(5000),
  })
  .strict();

export const confirmUpdateSchema = z
  .object({
    acceptDirectEdits: z.boolean().optional(),
  })
  .strict();

export const baselineSchema = z
  .object({
    line: lineSchema,
    sha: commitShaSchema,
    themeId: themeIdSchema.optional(),
    branch: branchSchema.optional(),
  })
  .strict();

export const rolloutPreviewSchema = z
  .object({
    sha: commitShaSchema,
    targets: z
      .array(z.object({ shopDomain: z.string().trim().min(1).max(255), themeId: themeIdSchema }).strict())
      .min(1)
      .max(20),
  })
  .strict();

export const rolloutConfirmSchema = z
  .object({
    runs: z
      .array(
        z
          .object({
            shopDomain: z.string().trim().min(1).max(255),
            runId: uuidSchema,
            acceptDirectEdits: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
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
