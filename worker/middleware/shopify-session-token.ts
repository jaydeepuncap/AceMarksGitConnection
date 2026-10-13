/**
 * Authenticates embedded-app API requests with the App Bridge session token.
 *
 * The React app calls `shopify.idToken()` and sends `Authorization: Bearer <JWT>`.
 * We verify (HS256, signed with the app's client secret):
 *   - signature, `exp`, `nbf` (10 s clock tolerance)
 *   - `aud` === the client ID of one of the configured apps (SHOPIFY_APPS),
 *     verified with that app's own secret
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
import { findShopByDomain, getDb, recordSession, setShopClientId } from '../lib/database';
import type { Logger } from '../lib/logger';
import { ApiError } from '../lib/response';
import { exchangeSessionToken, hasUsableToken, storeOfflineToken } from '../lib/sessions';
import { appByClientId, peekAudience, type ShopifyAppCredentials, type ShopifyAppsEnv } from '../lib/shopify-apps';
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

/**
 * Verifies a Shopify session token and returns its claims, the canonical shop
 * domain and the app it was issued for. The `aud` claim selects which
 * configured app's secret to verify with; the signature and `aud` are then
 * checked against that same app, so a token can never be validated with a
 * different app's credentials.
 */
export async function verifySessionToken(
  token: string,
  env: ShopifyAppsEnv,
): Promise<{ claims: ShopifySessionClaims; shopDomain: string; app: ShopifyAppCredentials }> {
  const app = appByClientId(env, peekAudience(token));
  if (!app) {
    // Retrying with a fresh token cannot help, so no retry header here.
    throw new ApiError(401, 'UNAUTHORIZED', 'Session token was issued for an app this server does not know');
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, encoder.encode(app.clientSecret), {
      algorithms: ['HS256'],
      audience: app.clientId,
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
  return { claims, shopDomain, app };
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

  const { claims, shopDomain, app } = await verifySessionToken(token, c.env);
  const logger = c.get('logger').child({ shop: shopDomain, app: app.name });
  c.set('logger', logger);

  const db = getDb(c.env.DB);
  let shop = await findShopByDomain(db, shopDomain);

  // A token from another app (the store switched to a different custom app)
  // means the stored offline token belongs to the old app: replace it.
  const appChanged = !!shop?.shopifyClientId && shop.shopifyClientId !== app.clientId;
  if (!shop || appChanged || !hasUsableToken(shop)) {
    logger.info('shopify.token_exchange', {
      reason: !shop ? 'new_shop' : appChanged ? 'app_changed' : 'token_unusable',
    });
    const offline = await exchangeSessionToken(app, shopDomain, token, logger);
    shop = await storeOfflineToken(c.env, db, shopDomain, offline, app);
  } else if (!shop.shopifyClientId) {
    // Installed before multi-app support: remember the app this verified token proves.
    await setShopClientId(db, shop.id, app.clientId);
    shop = { ...shop, shopifyClientId: app.clientId };
  }

  c.set('auth', {
    shop,
    shopDomain,
    userId: claims.sub ?? null,
    sessionId: claims.sid ?? null,
    app,
    sessionToken: token,
  });

  c.executionCtx.waitUntil(rememberSession(c.env, shop.id, claims, logger));
  await next();
};
