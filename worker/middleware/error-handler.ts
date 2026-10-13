/**
 * Request ID + logger binding, security headers, rate limiting, and the
 * centralized error / not-found handlers registered in worker/index.ts.
 */
import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { createLogger } from '../lib/logger';
import { ApiError, errorBody } from '../lib/response';
import { getShopifyApps } from '../lib/shopify-apps';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Assigns a request ID (honours a well-formed inbound cf-ray/x-request-id) and a bound logger. */
export const requestContext = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const inbound = c.req.header('x-request-id');
  const requestId = inbound && REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
  const url = new URL(c.req.url);
  const logger = createLogger(c.env.LOG_LEVEL, { requestId, method: c.req.method, path: url.pathname });
  c.set('requestId', requestId);
  c.set('logger', logger);

  const started = Date.now();
  await next();
  c.header('X-Request-Id', requestId);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth') || url.pathname.startsWith('/webhooks')) {
    logger.info('request.completed', { status: c.res.status, durationMs: Date.now() - started });
  }
};

/** Baseline security headers for API responses (HTML documents set their own CSP). */
export const apiSecurityHeaders = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
};

/**
 * D1 (via Drizzle) reports a missing or outdated schema as "no such table: x",
 * "no such column: y" or "table x has no column named y".
 */
export function isMissingTableError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
    if (/no such table|no such column|has no column named/i.test(e.message)) return true;
  }
  return false;
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId');
  const logger = c.get('logger') ?? createLogger(c.env?.LOG_LEVEL);

  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error('request.failed', { code: err.code, message: err.message });
    else logger.warn('request.rejected', { code: err.code, status: err.status, message: err.message });
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
    if (err.retryAfter !== undefined) c.header('Retry-After', String(err.retryAfter));
    return c.json(errorBody(err, requestId), err.status);
  }

  if (err instanceof HTTPException) {
    const apiErr = new ApiError(
      err.status as ApiError['status'],
      err.status === 401 ? 'UNAUTHORIZED' : err.status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR',
      err.message || 'Request failed',
    );
    return c.json(errorBody(apiErr, requestId), apiErr.status);
  }

  logger.error('request.unhandled_error', {
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
  });
  if (isMissingTableError(err)) {
    return c.json(
      errorBody(
        new ApiError(
          500,
          'DATABASE_NOT_MIGRATED',
          'The D1 database schema is missing or out of date. Apply the migrations: npm run db:migrate:remote',
        ),
        requestId,
      ),
      500,
    );
  }
  return c.json(
    errorBody(new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'), requestId),
    500,
  );
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(errorBody(new ApiError(404, 'NOT_FOUND', 'Route not found'), c.get('requestId')), 404);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const localWindows = new Map<string, { windowStart: number; count: number }>();

/** Best-effort per-isolate fixed window, used only when no RateLimit binding is configured. */
function localLimit(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  const entry = localWindows.get(key);
  if (!entry || now - entry.windowStart >= periodMs) {
    localWindows.set(key, { windowStart: now, count: 1 });
    if (localWindows.size > 5000) localWindows.clear();
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

export function rateLimit(opts: {
  binding: 'API_RATE_LIMITER' | 'SYNC_RATE_LIMITER';
  limit: number;
  periodSeconds: number;
  key: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = `${opts.binding}:${opts.key(c)}`;
    const binding = c.env[opts.binding];
    const allowed = binding
      ? (await binding.limit({ key })).success
      : localLimit(key, opts.limit, opts.periodSeconds * 1000);
    if (!allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', {
        retryAfter: opts.periodSeconds,
      });
    }
    await next();
  };
}

// ---------------------------------------------------------------------------
// Required configuration
// ---------------------------------------------------------------------------
/**
 * Names of required Worker secrets that are missing or malformed. Values are
 * never returned or logged, only names.
 */
function decodedLength(base64: string | undefined): number {
  if (!base64) return 0;
  try {
    return atob(base64).length;
  } catch {
    return 0;
  }
}

export function missingServerConfig(env: Partial<AppEnv['Bindings']>): string[] {
  const missing: string[] = [...getShopifyApps(env).errors];
  if (decodedLength(env.ENCRYPTION_KEY?.trim()) !== 32) missing.push('ENCRYPTION_KEY (32 random bytes, base64)');
  return missing;
}

/**
 * Fails closed when no Shopify app is configured (or SHOPIFY_APPS is malformed)
 * or ENCRYPTION_KEY is missing, instead of failing later with a generic 500.
 */
export const requireServerConfig = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const missing = missingServerConfig(c.env);
  if (missing.length > 0) {
    throw new ApiError(
      500,
      'SERVER_MISCONFIGURED',
      `Server configuration problem: ${missing.join('; ')}. Fix the Worker secrets with \`wrangler secret put <NAME>\`.`,
      { details: { missing } },
    );
  }
  await next();
};
