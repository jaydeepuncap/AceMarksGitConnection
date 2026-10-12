/**
 * Small read-through KV cache. KV is eventually consistent (writes can take up
 * to ~60 s to appear in other locations), so it only caches data that is either
 * immutable (commit contents keyed by SHA) or tolerably stale (theme lists).
 * Keys are always prefixed with the shop ID so tenants never share entries.
 */
import type { Logger } from './logger';

/** KV's minimum expirationTtl. */
export const KV_MIN_TTL = 60;

export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  logger?: Logger,
): Promise<T> {
  try {
    const hit = await kv.get<T>(key, 'json');
    if (hit !== null) return hit;
  } catch (err) {
    logger?.warn('cache.read_failed', { key, error: err });
  }
  const value = await load();
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(KV_MIN_TTL, ttlSeconds) });
  } catch (err) {
    logger?.warn('cache.write_failed', { key, error: err });
  }
  return value;
}

export async function invalidate(kv: KVNamespace, ...keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => kv.delete(key).catch(() => undefined)));
}

export const cacheKeys = {
  themes: (shopId: string) => `cache:${shopId}:themes`,
  repos: (shopId: string, connectionId: string, page: number, perPage: number) =>
    `cache:${shopId}:gh:${connectionId}:repos:${page}:${perPage}`,
  commitFiles: (shopId: string, repo: string, sha: string) => `cache:${shopId}:gh:${repo}:commit:${sha}:files`,
  oauthState: (state: string) => `oauth-state:${state}`,
  webhookSeen: (webhookId: string) => `webhook-seen:${webhookId}`,
};
