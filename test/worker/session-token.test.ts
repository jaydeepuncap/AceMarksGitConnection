import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../worker/index';
import { findShopByDomain, getDb } from '../../worker/lib/database';
import { verifySessionToken } from '../../worker/middleware/shopify-session-token';
import { createTestEnv, sessionToken, TEST_API_KEY, TEST_API_SECRET, type TestContext } from '../helpers/env';
import { installFetchMock, json } from '../helpers/fetch-mock';
import { seedShop } from '../helpers/fixtures';

const SHOP = 'alpha.myshopify.com';
const env = { SHOPIFY_API_KEY: TEST_API_KEY, SHOPIFY_API_SECRET: TEST_API_SECRET };

describe('verifySessionToken', () => {
  it('accepts a valid token and derives the shop from dest', async () => {
    const { shopDomain, claims } = await verifySessionToken(await sessionToken(SHOP), env);
    expect(shopDomain).toBe(SHOP);
    expect(claims.sub).toBe('42');
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sessionToken(SHOP, { exp: now - 60, nbf: now - 120 });
    await expect(verifySessionToken(token, env)).rejects.toMatchObject({ status: 401, message: /expired/ });
  });

  it('rejects a token for another app (aud)', async () => {
    await expect(verifySessionToken(await sessionToken(SHOP, { aud: 'other-app' }), env)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a token signed with the wrong secret', async () => {
    await expect(verifySessionToken(await sessionToken(SHOP, { secret: 'nope' }), env)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects iss/dest pointing at different shops', async () => {
    const token = await sessionToken(SHOP, { iss: 'https://beta.myshopify.com/admin' });
    await expect(verifySessionToken(token, env)).rejects.toMatchObject({ message: /issuer/ });
  });

  it('rejects a destination that is not a myshopify.com store', async () => {
    const token = await sessionToken(SHOP, { dest: 'https://evil.example.com', iss: 'https://evil.example.com/admin' });
    await expect(verifySessionToken(token, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a not-yet-valid token (nbf)', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifySessionToken(await sessionToken(SHOP, { nbf: now + 300 }), env)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('requireShopifySession middleware', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestEnv();
  });
  afterEach(() => vi.unstubAllGlobals());

  const get = async (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, t.env, t.ctx);

  it('returns 401 with the retry header when the token is missing', async () => {
    const res = await get('/api/settings');
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Shopify-Retry-Invalid-Session-Request')).toBe('1');
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('authenticates an installed shop without calling Shopify', async () => {
    const mock = installFetchMock();
    await seedShop(t.env, SHOP);
    const res = await get('/api/settings', await sessionToken(SHOP));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { shop: { shopDomain: string } } };
    expect(body.data.shop.shopDomain).toBe(SHOP);
    expect(mock.calls).toHaveLength(0);
  });

  it('performs token exchange for a newly installed shop and stores the token encrypted', async () => {
    const mock = installFetchMock();
    mock.on((req) =>
      req.url === `https://${SHOP}/admin/oauth/access_token`
        ? json({
            access_token: 'shpat_exchanged_offline_token',
            scope: 'read_themes,write_themes',
            expires_in: 3600,
            refresh_token: 'shprt_refresh_token_value',
            refresh_token_expires_in: 7776000,
          })
        : undefined,
    );
    const token = await sessionToken(SHOP);
    const res = await get('/api/settings', token);
    expect(res.status).toBe(200);

    const sent = new URLSearchParams(mock.calls[0]!.body ?? '');
    expect(sent.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(sent.get('requested_token_type')).toBe('urn:shopify:params:oauth:token-type:offline-access-token');
    expect(sent.get('subject_token')).toBe(token);
    expect(sent.get('expiring')).toBe('1');

    const shop = await findShopByDomain(getDb(t.env.DB), SHOP);
    expect(shop?.status).toBe('installed');
    expect(shop?.accessTokenEncrypted).toMatch(/^v1\./);
    expect(shop?.accessTokenEncrypted).not.toContain('shpat_exchanged');
    expect(shop?.refreshTokenEncrypted).not.toContain('shprt_');
    expect(shop?.accessTokenExpiresAt).toBeInstanceOf(Date);

    // Raw database contents never contain the plaintext token.
    const dump = JSON.stringify(t.sqlite.prepare('SELECT * FROM shops').all());
    expect(dump).not.toContain('shpat_exchanged_offline_token');
  });

  it('refreshes an expiring offline token with the refresh token', async () => {
    const mock = installFetchMock();
    let call = 0;
    mock.on((req) => {
      if (!req.url.endsWith('/admin/oauth/access_token')) return undefined;
      call++;
      return call === 1
        ? json({ access_token: 'shpat_first', scope: 'read_themes', expires_in: 60, refresh_token: 'shprt_one', refresh_token_expires_in: 1000 })
        : json({ access_token: 'shpat_second', scope: 'read_themes', expires_in: 3600, refresh_token: 'shprt_two', refresh_token_expires_in: 1000 });
    });
    mock.on((req) => (req.url.includes('/graphql.json') ? json({ data: { themes: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }) : undefined));

    // First request: token exchange (token expires within the 5-minute refresh skew).
    await get('/api/settings', await sessionToken(SHOP));
    // Second request needs the Admin API: the near-expiry token is refreshed first.
    const res = await get('/api/themes', await sessionToken(SHOP));
    expect(res.status).toBe(200);
    const refresh = mock.calls.find((c) => new URLSearchParams(c.body ?? '').get('grant_type') === 'refresh_token');
    expect(refresh).toBeDefined();
    expect(new URLSearchParams(refresh!.body!).get('refresh_token')).toBe('shprt_one');
    const graphql = mock.calls.find((c) => c.url.includes('/graphql.json'));
    expect(graphql?.headers.get('X-Shopify-Access-Token')).toBe('shpat_second');
  });
});
