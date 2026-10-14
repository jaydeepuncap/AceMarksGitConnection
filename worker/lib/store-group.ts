/**
 * The group of stores that share the master repository (STORE_GROUP).
 *
 * Membership is configured on the Worker, never taken from a request. A request
 * authenticated for a store in the group may read the group's update status and
 * roll an update out to the other stores' Staging themes; a store outside the
 * group only ever sees itself.
 */
import type { Shop } from '../../drizzle/schema';
import type { StoreSummary } from '../../shared/api-types';
import type { Env } from '../env';
import { normalizeShopDomain } from './validators';

export function storeGroup(env: Pick<Env, 'STORE_GROUP'>): string[] {
  const domains = (env.STORE_GROUP ?? '')
    .split(/[\s,]+/)
    .map((d) => normalizeShopDomain(d))
    .filter((d): d is string => !!d);
  return [...new Set(domains)];
}

export function isInGroup(env: Pick<Env, 'STORE_GROUP'>, shopDomain: string): boolean {
  return storeGroup(env).includes(shopDomain);
}

/** Opens this app inside the store's Shopify Admin. */
export function adminAppUrl(env: Pick<Env, 'SHOPIFY_API_KEY'>, shopDomain: string): string {
  const handle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}/apps/${env.SHOPIFY_API_KEY}`;
}

/** "acemarks.myshopify.com" → "Acemarks" when Shopify has not told us the store name yet. */
export function fallbackStoreName(shopDomain: string): string {
  const handle = shopDomain.replace(/\.myshopify\.com$/, '').replace(/[-_]+/g, ' ');
  return handle.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toStoreSummary(env: Env, shopDomain: string, shop: Shop | undefined, currentDomain: string): StoreSummary {
  return {
    shopDomain,
    name: shop?.shopName ?? fallbackStoreName(shopDomain),
    installed: shop?.status === 'installed',
    adminUrl: adminAppUrl(env, shopDomain),
    current: shopDomain === currentDomain,
  };
}
