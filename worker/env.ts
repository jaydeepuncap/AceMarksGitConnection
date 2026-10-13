/**
 * Cloudflare bindings and per-request context variables.
 * Bindings are read from Hono's `c.env`, never from process.env.
 */
import type { Shop } from '../drizzle/schema';
import type { Logger } from './lib/logger';
import type { ShopifyAppCredentials } from './lib/shopify-apps';

export interface SyncJobMessage {
  syncId: string;
  shopId: string;
}

export interface Env {
  // Bindings (wrangler.toml)
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  /** Optional: absent on the Workers Free plan; sync falls back to waitUntil(). */
  SYNC_QUEUE?: Queue<SyncJobMessage>;
  /** Optional Workers Rate Limiting bindings; an in-isolate limiter is used when absent. */
  API_RATE_LIMITER?: RateLimit;
  SYNC_RATE_LIMITER?: RateLimit;

  // [vars]
  APP_ENV: string;
  LOG_LEVEL?: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_SCOPES: string;
  SHOPIFY_APP_URL?: string;
  GITHUB_API_BASE_URL?: string;

  // Secrets (wrangler secret put / .dev.vars)
  /**
   * JSON array of every Shopify app served by this Worker (one custom app per
   * store): [{ name, clientId, clientSecret, shops: ["x.myshopify.com"] }].
   * See worker/lib/shopify-apps.ts.
   */
  SHOPIFY_APPS?: string;
  /** Legacy single-app credentials; still supported alongside SHOPIFY_APPS. */
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_PREVIOUS?: string;
}

/** Identity established by worker/middleware/shopify-session-token.ts. */
export interface AuthContext {
  shop: Shop;
  shopDomain: string;
  /** Shopify staff user ID (`sub` claim), when present. */
  userId: string | null;
  sessionId: string | null;
  /** The Shopify app the verified session token was issued for. */
  app: ShopifyAppCredentials;
  /**
   * The verified session token of this request. Kept in memory only so an
   * expired offline token can be re-obtained via token exchange; never logged
   * or persisted.
   */
  sessionToken: string;
}

export interface Variables {
  requestId: string;
  logger: Logger;
  auth: AuthContext;
  /** App identified by a verified Shopify HMAC (OAuth callback). */
  shopifyApp: ShopifyAppCredentials;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type HonoEnv = AppEnv;
