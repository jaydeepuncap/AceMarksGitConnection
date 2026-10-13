import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { app } from '../../worker/index';
import { isMissingTableError, missingServerConfig } from '../../worker/middleware/error-handler';
import { createTestEnv, sessionToken, TEST_ENCRYPTION_KEY } from '../helpers/env';

const SHOP = 'alpha.myshopify.com';

async function getSettings(t: ReturnType<typeof createTestEnv>) {
  const res = await app.request(
    '/api/settings',
    { headers: { Authorization: `Bearer ${await sessionToken(SHOP)}` } },
    t.env,
    t.ctx,
  );
  return { status: res.status, body: (await res.json()) as { error?: { code: string; message: string } } };
}

describe('required server configuration', () => {
  it('reports which secrets are missing by name only', () => {
    expect(
      missingServerConfig({ SHOPIFY_API_KEY: 'client-id-1', SHOPIFY_API_SECRET: 's', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }),
    ).toEqual([]);
    expect(missingServerConfig({ SHOPIFY_API_KEY: 'client-id-1', SHOPIFY_API_SECRET: ' ', ENCRYPTION_KEY: 'c2hvcnQ=' })).toEqual([
      'SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set together',
      'ENCRYPTION_KEY (32 random bytes, base64)',
    ]);
    expect(missingServerConfig({})).toEqual([
      'No Shopify app configured: set SHOPIFY_APPS (or SHOPIFY_API_KEY + SHOPIFY_API_SECRET)',
      'ENCRYPTION_KEY (32 random bytes, base64)',
    ]);
  });

  it('fails closed with SERVER_MISCONFIGURED instead of a generic 500', async () => {
    const t = createTestEnv();
    (t.env as { ENCRYPTION_KEY?: string }).ENCRYPTION_KEY = undefined;
    (t.env as { SHOPIFY_API_KEY?: string }).SHOPIFY_API_KEY = undefined;
    const { status, body } = await getSettings(t);
    expect(status).toBe(500);
    expect(body.error?.code).toBe('SERVER_MISCONFIGURED');
    expect(body.error?.message).toContain('SHOPIFY_API_KEY and SHOPIFY_API_SECRET');
    expect(body.error?.message).toContain('ENCRYPTION_KEY');
  });

  it('keeps /api/health available while misconfigured', async () => {
    const t = createTestEnv();
    (t.env as { ENCRYPTION_KEY?: string }).ENCRYPTION_KEY = undefined;
    const res = await app.request('/api/health', {}, t.env, t.ctx);
    expect(res.status).toBe(200);
  });

  it('reports an unmigrated database as DATABASE_NOT_MIGRATED', async () => {
    const t = createTestEnv();
    const empty = new DatabaseSync(':memory:');
    const rows = (sql: string, p: unknown[]) => empty.prepare(sql).all(...(p as never[])) as Record<string, unknown>[];
    (t.env as { DB: unknown }).DB = {
      prepare: (sql: string) => ({
        bind: (...p: unknown[]) => ({
          all: async () => ({ results: rows(sql, p) }),
          raw: async () => rows(sql, p).map((r) => Object.values(r)),
          run: async () => ({}),
        }),
      }),
    };
    const { status, body } = await getSettings(t);
    expect(status).toBe(500);
    expect(body.error?.code).toBe('DATABASE_NOT_MIGRATED');
    expect(body.error?.message).toContain('db:migrate:remote');
  });

  it('recognises missing-table errors wrapped as a cause', () => {
    expect(isMissingTableError(new Error('Failed query', { cause: new Error('no such table: shops') }))).toBe(true);
    expect(isMissingTableError(new Error('table shops has no column named shopify_client_id'))).toBe(true);
    expect(isMissingTableError(new Error('UNIQUE constraint failed'))).toBe(false);
  });
});
