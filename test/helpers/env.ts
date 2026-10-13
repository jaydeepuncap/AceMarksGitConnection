/**
 * Builds a complete Env for Worker tests: D1 (node:sqlite + real migrations),
 * in-memory KV and Queue, a fake ASSETS fetcher and an ExecutionContext whose
 * waitUntil promises can be awaited.
 */
import { SignJWT } from 'jose';
import type { Env, SyncJobMessage } from '../../worker/env';
import { createTestD1 } from './d1';

export const TEST_API_KEY = 'test-client-id';
export const TEST_API_SECRET = 'test-client-secret';
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

export class MemoryKV {
  store = new Map<string, { value: string; expiresAt: number | null }>();
  async get(key: string, type?: 'text' | 'json' | { type: string }) {
    const entry = this.store.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt < Date.now())) return null;
    const kind = typeof type === 'object' ? type.type : type;
    return kind === 'json' ? JSON.parse(entry.value) : entry.value;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }) {
    this.store.set(key, { value, expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list() {
    return { keys: [...this.store.keys()].map((name) => ({ name })), list_complete: true, cursor: '' };
  }
}

export class MemoryQueue {
  sent: { body: SyncJobMessage; delaySeconds?: number }[] = [];
  async send(body: SyncJobMessage, opts?: { delaySeconds?: number }) {
    this.sent.push({ body, delaySeconds: opts?.delaySeconds });
  }
  async sendBatch() {}
}

export interface TestContext {
  env: Env;
  kv: MemoryKV;
  queue: MemoryQueue;
  ctx: ExecutionContext & { flush: () => Promise<void> };
  sqlite: ReturnType<typeof createTestD1>['sqlite'];
}

/** Fake Workers Rate Limiting binding; `allow` can be flipped per test. */
export class FakeRateLimiter {
  allow = true;
  keys: string[] = [];
  async limit({ key }: { key: string }) {
    this.keys.push(key);
    return { success: this.allow };
  }
}

export function createTestEnv(options: { withQueue?: boolean } = {}): TestContext {
  const { d1, sqlite } = createTestD1();
  const kv = new MemoryKV();
  const queue = new MemoryQueue();
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => undefined,
    props: {},
    flush: async () => {
      while (pending.length) await Promise.allSettled(pending.splice(0));
    },
  } as unknown as TestContext['ctx'];

  const env: Env = {
    DB: d1,
    KV: kv as unknown as KVNamespace,
    ASSETS: {
      fetch: async () =>
        new Response('<html><head><meta name="shopify-api-key" content="__SHOPIFY_API_KEY__" /></head></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    } as unknown as Fetcher,
    API_RATE_LIMITER: new FakeRateLimiter() as unknown as RateLimit,
    SYNC_RATE_LIMITER: new FakeRateLimiter() as unknown as RateLimit,
    SYNC_QUEUE: options.withQueue === false ? undefined : (queue as unknown as Queue<SyncJobMessage>),
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    SHOPIFY_API_VERSION: '2026-07',
    SHOPIFY_SCOPES: 'read_themes,write_themes',
    SHOPIFY_APP_URL: 'https://app.example.com',
    GITHUB_API_BASE_URL: 'https://api.github.com',
    SHOPIFY_API_KEY: TEST_API_KEY,
    SHOPIFY_API_SECRET: TEST_API_SECRET,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
  return { env, kv, queue, ctx, sqlite };
}

/** Mints a Shopify-style App Bridge session token. */
export async function sessionToken(
  shop: string,
  overrides: Partial<{ aud: string; secret: string; iss: string; dest: string; exp: number; nbf: number; sub: string }> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ dest: overrides.dest ?? `https://${shop}`, sid: `sid-${shop}`, sub: overrides.sub ?? '42' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(overrides.iss ?? `https://${shop}/admin`)
    .setAudience(overrides.aud ?? TEST_API_KEY)
    .setIssuedAt(now)
    .setNotBefore(overrides.nbf ?? now - 5)
    .setExpirationTime(overrides.exp ?? now + 60)
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(overrides.secret ?? TEST_API_SECRET));
}
