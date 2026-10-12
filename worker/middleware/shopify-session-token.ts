/**
 * Authenticates embedded-app API requests with the App Bridge session token.
 *
 * The React app calls `shopify.idToken()` and sends `Authorization: Bearer <JWT>`.
 * We verify (HS256, signed with the app's client secret):
 *   - signature, `exp`, `nbf` (10 s clock tolerance)
 *   - `aud` === SHOPIFY_API_KEY (token minted for THIS app)
 *   - `dest` === https://{shop} and `iss` === https://{shop}/admin, same shop
 *   - shop is a valid *.myshopify.com domain
 *
 * The shop is taken ONLY from the verified token — never from a header, query
 * parameter or body — so every downstream query is scoped to the shop that
 * Shopify vouched for.
 *
 * If the shop has no usable offline token (first load after a Shopify-managed
 * install, reinstall, or an expired refresh token) we obtain one right here via
 * token exchange using this same session token.
 *
 * On failure: 401 + `X-Shopify-Retry-Invalid-Session-Request: 1`, which tells the
 * client to fetch a fresh session token and retry once.
 */
import type { MiddlewareHandler } from 'hono';
import { errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import type { AppEnv, Env } from '../env';
import { findShopByDomain, getDb, recordSession } from '../lib/database';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import { exchangeSessionToken, hasUsableToken, storeOfflineToken } from '../lib/sessions';
import { normalizeShopDomain } from '../lib/validators';

export interface ShopifySessionClaims extends JWTPayload {
  iss: string;
  dest: string;
  aud: string;
  sub?: string;
  sid?: string;
  exp: number;
  nbf: number;
  iat: number;
}

const encoder = new TextEncoder();
const RETRY_HEADER = { 'X-Shopify-Retry-Invalid-Session-Request': '1' };

const invalidSession = (message: string) =>
  new ApiError(401, 'UNAUTHORIZED', message, { headers: RETRY_HEADER });

/** Verifies a Shopify session token and returns its claims plus the canonical shop domain. */
export async function verifySessionToken(
  token: string,
  env: Pick<Env, 'SHOPIFY_API_KEY' | 'SHOPIFY_API_SECRET'>,
): Promise<{ claims: ShopifySessionClaims; shopDomain: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, encoder.encode(env.SHOPIFY_API_SECRET), {
      algorithms: ['HS256'],
      audience: env.SHOPIFY_API_KEY,
      clockTolerance: 10,
      requiredClaims: ['iss', 'dest', 'aud', 'exp', 'nbf', 'iat'],
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw invalidSession('Session token expired');
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw invalidSession(`Session token claim "${err.claim}" is invalid`);
    }
    throw invalidSession('Invalid session token');
  }

  const claims = payload as ShopifySessionClaims;
  let destHost: string;
  let issUrl: URL;
  try {
    destHost = new URL(claims.dest).hostname;
    issUrl = new URL(claims.iss);
  } catch {
    throw invalidSession('Session token has malformed iss/dest');
  }

  const shopDomain = normalizeShopDomain(destHost);
  if (!shopDomain || claims.dest !== `https://${shopDomain}`) {
    throw invalidSession('Session token destination is not a Shopify store');
  }
  if (issUrl.hostname !== shopDomain || issUrl.pathname.replace(/\/$/, '') !== '/admin') {
    throw invalidSession('Session token issuer does not match its destination');
  }
  return { claims, shopDomain };
}

async function rememberSession(
  env: Env,
  shopId: string,
  claims: ShopifySessionClaims,
  logger: Logger,
): Promise<void> {
  if (!claims.sid) return;
  // Session tokens are minted every minute; record each Shopify session once per
  // ~10 minutes instead of writing to D1 on every request.
  const cacheKey = `session-seen:${shopId}:${claims.sid}`;
  try {
    if (await env.KV.get(cacheKey)) return;
    await recordSession(getDb(env.DB), {
      id: claims.sid,
      shopId,
      userId: claims.sub ?? null,
      // The user's admin session outlives individual tokens; keep a rolling 24 h record.
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await env.KV.put(cacheKey, '1', { expirationTtl: 600 });
  } catch (err) {
    logger.warn('session.record_failed', { error: err });
  }
}

export const requireShopifySession = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header);
  if (!match) throw invalidSession('Missing session token');
  const token = match[1]!;

  const { claims, shopDomain } = await verifySessionToken(token, c.env);
  const logger = c.get('logger').child({ shop: shopDomain });
  c.set('logger', logger);

  const db = getDb(c.env.DB);
  let shop = await findShopByDomain(db, shopDomain);

  if (!shop || !hasUsableToken(shop)) {
    logger.info('shopify.token_exchange', { reason: shop ? 'token_unusable' : 'new_shop' });
    const offline = await exchangeSessionToken(c.env, shopDomain, token, logger);
    shop = await storeOfflineToken(c.env, db, shopDomain, offline);
  }

  c.set('auth', {
    shop,
    shopDomain,
    userId: claims.sub ?? null,
    sessionId: claims.sid ?? null,
    sessionToken: token,
  });

  c.executionCtx.waitUntil(rememberSession(c.env, shop.id, claims, logger));
  await next();
};
