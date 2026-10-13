/**
 * Shopify offline access-token lifecycle.
 *
 * How tokens are obtained
 *  1. Token exchange (primary, embedded): Shopify-managed installation installs
 *     the app; the first authenticated API request carries an App Bridge session
 *     token, which we exchange for an *expiring offline* access token.
 *  2. Authorization-code OAuth (fallback): /auth → /auth/callback for
 *     non-embedded installs or manual re-authorization.
 *
 * Expiring offline tokens (`expiring=1`) come with a refresh token. Refresh
 * tokens rotate: using one invalidates the previous pair, so refreshes are
 * de-duplicated per isolate and written with a compare-and-set on
 * shops.token_version. If a refresh fails with invalid_grant, the shop must be
 * re-authorized; the next embedded request does that silently via token
 * exchange.
 */
import type { Shop } from '../../drizzle/schema';
import type { Env } from '../env';
import { decryptSecret, encryptSecret } from './crypto';
import {
  clearShopTokens,
  findShopById,
  updateShopTokensIfVersion,
  upsertInstalledShop,
  type Database,
  type ShopTokenWrite,
} from './database';
import { fetchWithRetry } from './http';
import { appForShop, type ShopifyAppCredentials } from './shopify-apps';
import type { Logger } from './logger';
import { ApiError } from './response';

/** Refresh this long before expiry to avoid using a token that expires mid-request. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface AccessTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export class ShopifyReauthRequiredError extends ApiError {
  constructor(message = 'Shopify authorization expired. Reopen the app from Shopify Admin to re-authorize.') {
    super(401, 'SHOPIFY_REAUTH_REQUIRED', message);
  }
}

export const offlineTokenAad = (shopDomain: string) => `shopify-offline-access:${shopDomain}`;
export const refreshTokenAad = (shopDomain: string) => `shopify-refresh:${shopDomain}`;

function accessTokenEndpoint(shopDomain: string): string {
  return `https://${shopDomain}/admin/oauth/access_token`;
}

async function requestToken(
  shopDomain: string,
  params: Record<string, string>,
  logger: Logger,
  fetchImpl?: typeof fetch,
): Promise<AccessTokenResponse> {
  const response = await fetchWithRetry(
    accessTokenEndpoint(shopDomain),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    },
    { timeoutMs: 10_000, retries: 1, idempotent: false, fetchImpl },
  );

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Non-JSON error page
  }

  if (!response.ok) {
    const error = typeof body.error === 'string' ? body.error : `http_${response.status}`;
    logger.warn('shopify.token_request_failed', {
      shop: shopDomain,
      status: response.status,
      error,
      grant: params.grant_type ?? 'authorization_code',
    });
    if (
      error === 'invalid_grant' ||
      error === 'invalid_subject_token' ||
      error === 'invalid_request' ||
      response.status === 400 ||
      response.status === 401
    ) {
      throw new ShopifyReauthRequiredError();
    }
    throw new ApiError(502, 'SHOPIFY_ERROR', 'Shopify token endpoint returned an error');
  }

  if (typeof body.access_token !== 'string' || typeof body.scope !== 'string') {
    throw new ApiError(502, 'SHOPIFY_ERROR', 'Shopify token endpoint returned an unexpected response');
  }
  return body as unknown as AccessTokenResponse;
}

/** Session token → expiring offline access token (Shopify token exchange). */
export function exchangeSessionToken(
  app: ShopifyAppCredentials,
  shopDomain: string,
  sessionToken: string,
  logger: Logger,
  fetchImpl?: typeof fetch,
): Promise<AccessTokenResponse> {
  return requestToken(
    shopDomain,
    {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: '1',
    },
    logger,
    fetchImpl,
  );
}

/** Authorization code (OAuth callback) → expiring offline access token. */
export function exchangeAuthorizationCode(
  app: ShopifyAppCredentials,
  shopDomain: string,
  code: string,
  logger: Logger,
  fetchImpl?: typeof fetch,
): Promise<AccessTokenResponse> {
  return requestToken(
    shopDomain,
    { client_id: app.clientId, client_secret: app.clientSecret, code, expiring: '1' },
    logger,
    fetchImpl,
  );
}

function refreshAccessToken(
  app: ShopifyAppCredentials,
  shopDomain: string,
  refreshToken: string,
  logger: Logger,
  fetchImpl?: typeof fetch,
): Promise<AccessTokenResponse> {
  return requestToken(
    shopDomain,
    {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    logger,
    fetchImpl,
  );
}

async function toTokenWrite(env: Env, shopDomain: string, token: AccessTokenResponse): Promise<ShopTokenWrite> {
  const now = Date.now();
  return {
    scopes: token.scope,
    accessTokenEncrypted: await encryptSecret(env, token.access_token, offlineTokenAad(shopDomain)),
    accessTokenExpiresAt: token.expires_in ? new Date(now + token.expires_in * 1000) : null,
    refreshTokenEncrypted: token.refresh_token
      ? await encryptSecret(env, token.refresh_token, refreshTokenAad(shopDomain))
      : null,
    refreshTokenExpiresAt: token.refresh_token_expires_in
      ? new Date(now + token.refresh_token_expires_in * 1000)
      : null,
  };
}

/** Persists tokens from token exchange or OAuth (install / reinstall). */
export async function storeOfflineToken(
  env: Env,
  db: Database,
  shopDomain: string,
  token: AccessTokenResponse,
  app: ShopifyAppCredentials,
): Promise<Shop> {
  return upsertInstalledShop(db, shopDomain, await toTokenWrite(env, shopDomain, token), app.clientId);
}

/** The app whose credentials refresh this shop's tokens (see shopify-apps.ts). */
export function shopifyAppForShop(env: Env, shop: Shop): ShopifyAppCredentials {
  const app = appForShop(env, shop.shopDomain, shop.shopifyClientId);
  if (!app) {
    throw new ApiError(
      500,
      'SERVER_MISCONFIGURED',
      `No Shopify app credentials configured for ${shop.shopDomain}. Add its app to SHOPIFY_APPS.`,
    );
  }
  return app;
}

export function hasUsableToken(shop: Shop, now = Date.now()): boolean {
  if (shop.status !== 'installed' || !shop.accessTokenEncrypted) return false;
  if (!shop.accessTokenExpiresAt) return true;
  if (shop.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > now) return true;
  // Expired/expiring access token: usable only if it can be refreshed.
  return !!shop.refreshTokenEncrypted && (!shop.refreshTokenExpiresAt || shop.refreshTokenExpiresAt.getTime() > now);
}

const inflightRefreshes = new Map<string, Promise<string>>();

/**
 * Returns a valid offline Admin API access token for the shop, refreshing it if
 * it is about to expire. Throws ShopifyReauthRequiredError when no valid
 * credential exists.
 */
export async function getOfflineAccessToken(
  env: Env,
  db: Database,
  shop: Shop,
  logger: Logger,
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (shop.status !== 'installed' || !shop.accessTokenEncrypted) throw new ShopifyReauthRequiredError();

  const now = Date.now();
  if (!shop.accessTokenExpiresAt || shop.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > now) {
    return decryptSecret(env, shop.accessTokenEncrypted, offlineTokenAad(shop.shopDomain));
  }

  const existing = inflightRefreshes.get(shop.id);
  if (existing) return existing;

  const refresh = (async () => {
    if (!shop.refreshTokenEncrypted) throw new ShopifyReauthRequiredError();
    if (shop.refreshTokenExpiresAt && shop.refreshTokenExpiresAt.getTime() <= now) {
      throw new ShopifyReauthRequiredError();
    }
    const refreshToken = await decryptSecret(env, shop.refreshTokenEncrypted, refreshTokenAad(shop.shopDomain));
    let token: AccessTokenResponse;
    try {
      token = await refreshAccessToken(shopifyAppForShop(env, shop), shop.shopDomain, refreshToken, logger, fetchImpl);
    } catch (err) {
      if (err instanceof ShopifyReauthRequiredError) {
        // Another isolate may have rotated the refresh token first: use its result.
        const latest = await findShopById(db, shop.id);
        if (latest && latest.tokenVersion !== shop.tokenVersion && hasUsableToken(latest)) {
          logger.info('shopify.token_refreshed_elsewhere', { shop: shop.shopDomain });
          return getOfflineAccessToken(env, db, latest, logger, fetchImpl);
        }
        await clearShopTokens(db, shop.id);
      }
      throw err;
    }

    const write = await toTokenWrite(env, shop.shopDomain, token);
    const updated = await updateShopTokensIfVersion(db, shop.id, shop.tokenVersion, write);
    if (!updated) {
      // Lost the race after a successful refresh; our token is still valid for this call.
      logger.warn('shopify.token_refresh_cas_conflict', { shop: shop.shopDomain });
    } else {
      logger.info('shopify.token_refreshed', { shop: shop.shopDomain });
    }
    return token.access_token;
  })();

  inflightRefreshes.set(shop.id, refresh);
  try {
    return await refresh;
  } finally {
    inflightRefreshes.delete(shop.id);
  }
}

export function parseScopes(scopes: string): string[] {
  return scopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** write_X implies read_X in Shopify's scope model. */
export function scopeGrants(granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.startsWith('read_')) return granted.includes(`write_${required.slice(5)}`);
  return false;
}
