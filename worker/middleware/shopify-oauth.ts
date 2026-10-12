/**
 * HMAC verification for requests signed by Shopify with the app's client secret.
 *
 * Two distinct mechanisms — they are NOT interchangeable:
 *
 *  1. Query-string HMAC (OAuth install/callback redirects, app-load URLs)
 *     hex(HMAC-SHA256(secret, "k1=v1&k2=v2…")) over every query parameter except
 *     `hmac` (and legacy `signature`), sorted by key. Sent as `?hmac=…`.
 *
 *  2. Webhook HMAC
 *     base64(HMAC-SHA256(secret, raw request body)). Sent in the
 *     X-Shopify-Hmac-Sha256 header. Must be computed over the exact raw bytes,
 *     before any JSON parsing.
 *
 * Embedded API requests use neither: they carry an App Bridge session token
 * (JWT) verified in shopify-session-token.ts.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { bytesToBase64, bytesToHex, hmacSha256, timingSafeEqual } from '../lib/crypto';
import { ApiError } from '../lib/response';
import { normalizeShopDomain } from '../lib/validators';

/** Builds the message Shopify signs for query-string HMACs. */
export function buildQueryHmacMessage(params: URLSearchParams): string {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params) {
    if (key === 'hmac' || key === 'signature') continue;
    const list = grouped.get(key) ?? [];
    list.push(value);
    grouped.set(key, list);
  }
  return [...grouped.keys()]
    .sort()
    .map((key) => {
      const values = grouped.get(key)!;
      // Array params (e.g. ids[]=1&ids[]=2) are signed as ids=["1","2"]
      const value = key.endsWith('[]')
        ? `[${values.map((v) => JSON.stringify(v)).join(',')}]`
        : values.join(',');
      return `${key.replace(/\[\]$/, '')}=${value}`;
    })
    .join('&');
}

export async function verifyQueryHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const provided = params.get('hmac');
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = bytesToHex(await hmacSha256(secret, buildQueryHmacMessage(params)));
  return timingSafeEqual(expected, provided.toLowerCase());
}

/** Rejects stale signed redirects (Shopify includes a `timestamp` parameter, seconds). */
export function isFreshTimestamp(value: string | null, maxAgeSeconds = 600, now = Date.now()): boolean {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Math.abs(now / 1000 - ts) <= maxAgeSeconds;
}

export async function verifyWebhookHmac(
  rawBody: ArrayBuffer | Uint8Array,
  headerValue: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!headerValue) return false;
  const bytes = rawBody instanceof Uint8Array ? rawBody : new Uint8Array(rawBody);
  const expected = bytesToBase64(await hmacSha256(secret, bytes));
  return timingSafeEqual(expected, headerValue.trim());
}

/**
 * Middleware for Shopify-signed redirects (OAuth callback): verifies the HMAC,
 * the timestamp window and the shop domain format before the handler runs.
 */
export const requireSignedShopifyQuery = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const params = new URL(c.req.url).searchParams;
  const shop = normalizeShopDomain(params.get('shop'));
  if (!shop) throw new ApiError(400, 'VALIDATION_ERROR', 'Missing or invalid shop parameter');
  if (!(await verifyQueryHmac(params, c.env.SHOPIFY_API_SECRET))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid Shopify HMAC signature');
  }
  if (!isFreshTimestamp(params.get('timestamp'))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Shopify request timestamp is too old');
  }
  await next();
};
