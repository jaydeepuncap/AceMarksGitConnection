/**
 * Authorization-code OAuth (fallback install / manual re-authorization).
 *
 * The embedded app normally never visits these routes: with Shopify-managed
 * installation the app obtains tokens via token exchange (see
 * middleware/shopify-session-token.ts). These routes remain for non-embedded
 * installs, Partner Dashboard "test on development store" with the legacy flow,
 * and support-driven re-authorization.
 *
 *   GET /auth?shop={shop}.myshopify.com
 *     → state = random 256-bit value, stored in KV (10 min) AND an HttpOnly,
 *       Secure, SameSite=Lax cookie; redirect to Shopify's authorize URL.
 *   GET /auth/callback?code&hmac&host&shop&state&timestamp
 *     → verify query HMAC + timestamp, state cookie == state param == KV entry
 *       for the same shop (single use), exchange code for an expiring offline
 *       token, store it encrypted, redirect into Shopify Admin.
 */
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { cacheKeys } from '../lib/cache';
import { randomToken, timingSafeEqual } from '../lib/crypto';
import { getDb } from '../lib/database';
import { ApiError } from '../lib/response';
import { exchangeAuthorizationCode, storeOfflineToken } from '../lib/sessions';
import { normalizeShopDomain } from '../lib/validators';
import { requireSignedShopifyQuery, verifyQueryHmac } from '../middleware/shopify-oauth';

const STATE_COOKIE = '__Host-ace_oauth_state';
const STATE_TTL_SECONDS = 600;

export function appBaseUrl(env: { SHOPIFY_APP_URL?: string }, requestUrl: string): string {
  const configured = env.SHOPIFY_APP_URL?.trim();
  return (configured ? configured : new URL(requestUrl).origin).replace(/\/+$/, '');
}

/** Decodes the base64 `host` param and accepts only Shopify Admin hosts. */
export function decodeAdminHost(host: string | null | undefined, shop: string): string | null {
  if (!host) return null;
  try {
    const decoded = atob(host.replace(/-/g, '+').replace(/_/g, '/'));
    const store = shop.replace('.myshopify.com', '');
    if (decoded === `admin.shopify.com/store/${store}` || decoded === `${shop}/admin`) return decoded;
  } catch {
    // invalid base64
  }
  return null;
}

/** Minimal page that uses App Bridge to navigate the top window (leaves the Admin iframe). */
export function exitIframeHtml(apiKey: string, target: string): string {
  const safe = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  const attr = (v: string) => v.replace(/[&"<>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="shopify-api-key" content="${attr(apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script></head>
<body><script>window.open(${safe(target)}, '_top');</script></body></html>`;
}

export const oauthRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const url = new URL(c.req.url);
    const shop = normalizeShopDomain(url.searchParams.get('shop'));
    if (!shop) throw new ApiError(400, 'VALIDATION_ERROR', 'A valid ?shop=<store>.myshopify.com parameter is required');

    // If Shopify signed this request, the signature must be valid.
    if (url.searchParams.has('hmac') && !(await verifyQueryHmac(url.searchParams, c.env.SHOPIFY_API_SECRET))) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid Shopify HMAC signature');
    }

    const state = randomToken(32);
    await c.env.KV.put(cacheKeys.oauthState(state), shop, { expirationTtl: STATE_TTL_SECONDS });

    const redirectUri = `${appBaseUrl(c.env, c.req.url)}/auth/callback`;
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set('client_id', c.env.SHOPIFY_API_KEY);
    authorize.searchParams.set('scope', c.env.SHOPIFY_SCOPES);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);
    // No grant_options[]=per-user → offline access token.

    if (url.searchParams.get('embedded') === '1') {
      // Inside the Admin iframe: Shopify's authorize page cannot be framed and the
      // state cookie would be third-party. Break out to the top window first.
      const topLevel = `${appBaseUrl(c.env, c.req.url)}/auth?shop=${encodeURIComponent(shop)}`;
      return c.html(exitIframeHtml(c.env.SHOPIFY_API_KEY, topLevel));
    }

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: STATE_TTL_SECONDS,
    });
    return c.redirect(authorize.toString(), 302);
  })
  .get('/callback', requireSignedShopifyQuery(), async (c) => {
    const params = new URL(c.req.url).searchParams;
    const shop = normalizeShopDomain(params.get('shop'))!;
    const state = params.get('state') ?? '';
    const code = params.get('code') ?? '';
    const logger = c.get('logger').child({ shop });

    const cookieState = getCookie(c, STATE_COOKIE) ?? '';
    deleteCookie(c, STATE_COOKIE, { path: '/', secure: true });
    if (!state || !cookieState || !timingSafeEqual(state, cookieState)) {
      throw new ApiError(403, 'FORBIDDEN', 'OAuth state mismatch. Start the installation again.');
    }
    const stateKey = cacheKeys.oauthState(state);
    const stateShop = await c.env.KV.get(stateKey);
    await c.env.KV.delete(stateKey);
    if (stateShop !== shop) {
      throw new ApiError(403, 'FORBIDDEN', 'OAuth state expired or issued for a different shop');
    }
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(code)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid authorization code');

    const token = await exchangeAuthorizationCode(c.env, shop, code, logger);
    await storeOfflineToken(c.env, getDb(c.env.DB), shop, token);
    logger.info('shopify.oauth_completed', { scopes: token.scope });

    const adminHost = decodeAdminHost(params.get('host'), shop);
    const target = adminHost
      ? `https://${adminHost}/apps/${c.env.SHOPIFY_API_KEY}`
      : `https://${shop}/admin/apps/${c.env.SHOPIFY_API_KEY}`;
    return c.redirect(target, 302);
  });
