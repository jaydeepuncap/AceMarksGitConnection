import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../worker/index';
import { findShopByDomain, getDb, getGithubConnection } from '../../worker/lib/database';
import { buildQueryHmacMessage, verifyQueryHmac, verifyWebhookHmac } from '../../worker/middleware/shopify-oauth';
import { createTestEnv, TEST_API_SECRET, type TestContext } from '../helpers/env';
import { installFetchMock, json } from '../helpers/fetch-mock';
import { seedShop } from '../helpers/fixtures';

const SHOP = 'alpha.myshopify.com';

function signQuery(params: Record<string, string>): URLSearchParams {
  const search = new URLSearchParams(params);
  const hmac = createHmac('sha256', TEST_API_SECRET).update(buildQueryHmacMessage(search)).digest('hex');
  search.set('hmac', hmac);
  return search;
}

describe('query HMAC', () => {
  it('signs sorted params excluding hmac/signature', () => {
    const msg = buildQueryHmacMessage(new URLSearchParams('shop=a.myshopify.com&code=x&hmac=zz&timestamp=1&signature=s'));
    expect(msg).toBe('code=x&shop=a.myshopify.com&timestamp=1');
  });

  it('verifies a valid signature and rejects tampering', async () => {
    const signed = signQuery({ shop: SHOP, code: 'abc', timestamp: '1700000000' });
    expect(await verifyQueryHmac(signed, TEST_API_SECRET)).toBe(true);
    signed.set('shop', 'evil.myshopify.com');
    expect(await verifyQueryHmac(signed, TEST_API_SECRET)).toBe(false);
  });
});

describe('OAuth flow', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestEnv();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function begin() {
    const res = await app.request(`/auth?shop=${SHOP}`, {}, t.env, t.ctx);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe(`https://${SHOP}`);
    expect(location.searchParams.get('scope')).toBe('read_themes,write_themes');
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    return { state: location.searchParams.get('state')!, cookie: cookie.split(';')[0]! };
  }

  const now = () => String(Math.floor(Date.now() / 1000));

  it('completes the callback: HMAC + state valid → code exchanged → redirect into Admin', async () => {
    const mock = installFetchMock();
    mock.on((req) =>
      req.url === `https://${SHOP}/admin/oauth/access_token`
        ? json({ access_token: 'shpat_from_code', scope: 'read_themes,write_themes', expires_in: 3600, refresh_token: 'shprt_x', refresh_token_expires_in: 1000 })
        : undefined,
    );
    const { state, cookie } = await begin();
    const query = signQuery({ shop: SHOP, code: 'auth-code-123', state, timestamp: now(), host: btoa('admin.shopify.com/store/alpha') });
    const res = await app.request(`/auth/callback?${query}`, { headers: { Cookie: cookie } }, t.env, t.ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://admin.shopify.com/store/alpha/apps/test-client-id');
    expect(new URLSearchParams(mock.calls[0]!.body!).get('code')).toBe('auth-code-123');
    expect((await findShopByDomain(getDb(t.env.DB), SHOP))?.status).toBe('installed');

    // State is single-use.
    const replay = await app.request(`/auth/callback?${query}`, { headers: { Cookie: cookie } }, t.env, t.ctx);
    expect(replay.status).toBe(403);
  });

  it('rejects an invalid HMAC', async () => {
    const { state, cookie } = await begin();
    const query = signQuery({ shop: SHOP, code: 'c', state, timestamp: now() });
    query.set('code', 'tampered');
    const res = await app.request(`/auth/callback?${query}`, { headers: { Cookie: cookie } }, t.env, t.ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a state that does not match the cookie', async () => {
    const { cookie } = await begin();
    const query = signQuery({ shop: SHOP, code: 'c', state: 'forged-state', timestamp: now() });
    const res = await app.request(`/auth/callback?${query}`, { headers: { Cookie: cookie } }, t.env, t.ctx);
    expect(res.status).toBe(403);
  });

  it('rejects a stale timestamp', async () => {
    const { state, cookie } = await begin();
    const query = signQuery({ shop: SHOP, code: 'c', state, timestamp: String(Math.floor(Date.now() / 1000) - 3600) });
    const res = await app.request(`/auth/callback?${query}`, { headers: { Cookie: cookie } }, t.env, t.ctx);
    expect(res.status).toBe(401);
  });

  it('rejects non-Shopify shop domains', async () => {
    const res = await app.request('/auth?shop=evil.example.com', {}, t.env, t.ctx);
    expect(res.status).toBe(400);
  });
});

describe('webhooks', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestEnv();
  });

  async function deliver(path: string, topic: string, payload: unknown, opts: { tamper?: boolean; id?: string } = {}) {
    const body = JSON.stringify(payload);
    const hmac = createHmac('sha256', TEST_API_SECRET).update(body).digest('base64');
    return app.request(
      `/webhooks${path}`,
      {
        method: 'POST',
        body: opts.tamper ? body.replace('}', ',"x":1}') : body,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': hmac,
          'X-Shopify-Topic': topic,
          'X-Shopify-Shop-Domain': SHOP,
          'X-Shopify-Webhook-Id': opts.id ?? crypto.randomUUID(),
        },
      },
      t.env,
      t.ctx,
    );
  }

  it('verifies the signature over the raw body', async () => {
    const body = new TextEncoder().encode('{"a":1}');
    const sig = createHmac('sha256', TEST_API_SECRET).update(body).digest('base64');
    expect(await verifyWebhookHmac(body, sig, TEST_API_SECRET)).toBe(true);
    expect(await verifyWebhookHmac(new TextEncoder().encode('{"a": 1}'), sig, TEST_API_SECRET)).toBe(false);
  });

  it('app/uninstalled: clears tokens and removes the GitHub credential', async () => {
    const shop = await seedShop(t.env, SHOP);
    const res = await deliver('/app/uninstalled', 'app/uninstalled', { domain: SHOP });
    expect(res.status).toBe(200);
    const db = getDb(t.env.DB);
    const after = await findShopByDomain(db, SHOP);
    expect(after?.status).toBe('uninstalled');
    expect(after?.accessTokenEncrypted).toBeNull();
    expect(await getGithubConnection(db, shop.id)).toBeUndefined();
  });

  it('rejects a tampered body with 401 and changes nothing', async () => {
    await seedShop(t.env, SHOP);
    const res = await deliver('/app/uninstalled', 'app/uninstalled', { domain: SHOP }, { tamper: true });
    expect(res.status).toBe(401);
    expect((await findShopByDomain(getDb(t.env.DB), SHOP))?.status).toBe('installed');
  });

  it('app/scopes_update stores the current scopes', async () => {
    await seedShop(t.env, SHOP);
    await deliver('/app/scopes_update', 'app/scopes_update', { current: ['read_themes'], previous: ['read_themes', 'write_themes'] });
    expect((await findShopByDomain(getDb(t.env.DB), SHOP))?.scopes).toBe('read_themes');
  });

  it('shop/redact erases all shop data; duplicates are acknowledged once', async () => {
    await seedShop(t.env, SHOP);
    const id = crypto.randomUUID();
    expect((await deliver('/compliance', 'shop/redact', { shop_domain: SHOP }, { id })).status).toBe(200);
    await t.ctx.flush();
    expect(await findShopByDomain(getDb(t.env.DB), SHOP)).toBeUndefined();
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM github_connections').get()).toEqual({ n: 0 });
    expect((await deliver('/compliance', 'shop/redact', { shop_domain: SHOP }, { id })).status).toBe(200);
  });
});
