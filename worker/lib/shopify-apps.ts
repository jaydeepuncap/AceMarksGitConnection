/**
 * Registry of the Shopify apps served by this Worker.
 *
 * A custom-distribution app can only be installed on one store (or several
 * stores of one Plus organization), so serving N unrelated stores means N
 * Shopify apps: each has its own client ID ("API key") and client secret but
 * shares this one Worker, database and codebase. Deploying the Worker updates
 * every app at once.
 *
 * Configuration (Worker secret, never committed):
 *
 *   SHOPIFY_APPS = [
 *     { "name": "Store A", "clientId": "…", "clientSecret": "…", "shops": ["store-a.myshopify.com"] },
 *     { "name": "Store B", "clientId": "…", "clientSecret": "…", "shops": ["store-b.myshopify.com"] }
 *   ]
 *
 * Legacy single-app setup (SHOPIFY_API_KEY + SHOPIFY_API_SECRET) keeps working
 * and is treated as one more app.
 *
 * Which app a request belongs to is always derived from something Shopify
 * signed with that app's secret: the session token's `aud` claim, the OAuth
 * HMAC, or the webhook HMAC. `shops` and the stored `shops.shopify_client_id`
 * are only used to pick credentials *before* such proof exists (OAuth start,
 * the HTML shell, background jobs).
 */
import { base64UrlToBytes } from './crypto';
import { normalizeShopDomain } from './validators';

export interface ShopifyAppCredentials {
  /** Display name for logs and admin output. */
  name: string;
  /** Client ID (a.k.a. API key). Public. */
  clientId: string;
  /** Client secret. Signs session tokens, OAuth redirects and webhooks. */
  clientSecret: string;
  /** Stores this app is installed on (canonical *.myshopify.com domains). */
  shops: string[];
}

export interface ShopifyAppsEnv {
  SHOPIFY_APPS?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
}

export interface ShopifyAppsConfig {
  apps: ShopifyAppCredentials[];
  /** Human-readable configuration problems (never include secret values). */
  errors: string[];
}

const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;

const cache = new Map<string, ShopifyAppsConfig>();

function parse(env: ShopifyAppsEnv): ShopifyAppsConfig {
  const apps: ShopifyAppCredentials[] = [];
  const errors: string[] = [];

  const raw = env.SHOPIFY_APPS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push('SHOPIFY_APPS is not valid JSON');
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      errors.push('SHOPIFY_APPS must be a JSON array');
    } else {
      parsed.forEach((entry, i) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        const label = typeof e.name === 'string' && e.name.trim() ? e.name.trim() : `app #${i + 1}`;
        const clientId = typeof e.clientId === 'string' ? e.clientId.trim() : '';
        const clientSecret = typeof e.clientSecret === 'string' ? e.clientSecret.trim() : '';
        if (!CLIENT_ID.test(clientId)) errors.push(`SHOPIFY_APPS[${i}] (${label}): clientId is missing or invalid`);
        if (!clientSecret) errors.push(`SHOPIFY_APPS[${i}] (${label}): clientSecret is missing`);
        const shops: string[] = [];
        if (e.shops !== undefined && !Array.isArray(e.shops)) {
          errors.push(`SHOPIFY_APPS[${i}] (${label}): shops must be an array`);
        }
        for (const s of Array.isArray(e.shops) ? e.shops : []) {
          const domain = normalizeShopDomain(typeof s === 'string' ? s : '');
          if (domain) shops.push(domain);
          else errors.push(`SHOPIFY_APPS[${i}] (${label}): "${String(s)}" is not a *.myshopify.com domain`);
        }
        if (CLIENT_ID.test(clientId) && clientSecret) apps.push({ name: label, clientId, clientSecret, shops });
      });
    }
  }

  const legacyId = env.SHOPIFY_API_KEY?.trim();
  const legacySecret = env.SHOPIFY_API_SECRET?.trim();
  if (legacyId && legacySecret && !apps.some((a) => a.clientId === legacyId)) {
    apps.push({ name: 'default', clientId: legacyId, clientSecret: legacySecret, shops: [] });
  } else if ((legacyId && !legacySecret) || (!legacyId && legacySecret)) {
    errors.push('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set together');
  }

  const seenIds = new Set<string>();
  const shopOwner = new Map<string, string>();
  for (const app of apps) {
    if (seenIds.has(app.clientId)) errors.push(`Client ID of "${app.name}" is listed more than once`);
    seenIds.add(app.clientId);
    for (const shop of app.shops) {
      const owner = shopOwner.get(shop);
      if (owner) errors.push(`${shop} is assigned to both "${owner}" and "${app.name}"`);
      shopOwner.set(shop, app.name);
    }
  }
  if (apps.length === 0 && errors.length === 0) {
    errors.push('No Shopify app configured: set SHOPIFY_APPS (or SHOPIFY_API_KEY + SHOPIFY_API_SECRET)');
  }
  return { apps, errors };
}

/** Parsed app registry (cached per isolate; re-parsed when the secrets change). */
export function getShopifyApps(env: ShopifyAppsEnv): ShopifyAppsConfig {
  const key = `${env.SHOPIFY_APPS ?? ''}\u0000${env.SHOPIFY_API_KEY ?? ''}\u0000${env.SHOPIFY_API_SECRET ?? ''}`;
  let config = cache.get(key);
  if (!config) {
    config = parse(env);
    if (cache.size > 8) cache.clear();
    cache.set(key, config);
  }
  return config;
}

export function appByClientId(env: ShopifyAppsEnv, clientId: string | null | undefined): ShopifyAppCredentials | null {
  if (!clientId) return null;
  return getShopifyApps(env).apps.find((a) => a.clientId === clientId) ?? null;
}

/**
 * Credentials to use for a shop when no signed proof is at hand:
 * 1. the app the shop was installed with (stored on the shop row),
 * 2. the app whose `shops` list contains it,
 * 3. the only configured app, if there is exactly one.
 */
export function appForShop(
  env: ShopifyAppsEnv,
  shopDomain: string,
  storedClientId?: string | null,
): ShopifyAppCredentials | null {
  const { apps } = getShopifyApps(env);
  const stored = appByClientId(env, storedClientId);
  if (stored) return stored;
  const listed = apps.find((a) => a.shops.includes(shopDomain));
  if (listed) return listed;
  return apps.length === 1 ? apps[0]! : null;
}

/**
 * Reads a JWT's `aud` claim WITHOUT verifying it, only to choose which app's
 * secret to verify the token with. Callers must verify before trusting it.
 */
export function peekAudience(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { aud?: unknown };
    if (typeof claims.aud === 'string') return claims.aud;
    if (Array.isArray(claims.aud) && typeof claims.aud[0] === 'string') return claims.aud[0];
  } catch {
    // malformed token
  }
  return null;
}

/** Tries each configured app's secret; returns the app whose signature matches. */
export async function findAppBySignature(
  env: ShopifyAppsEnv,
  verify: (secret: string) => Promise<boolean>,
): Promise<ShopifyAppCredentials | null> {
  for (const app of getShopifyApps(env).apps) {
    if (await verify(app.clientSecret)) return app;
  }
  return null;
}
