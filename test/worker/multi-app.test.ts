import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../worker/index';
import { findShopByDomain, getDb } from '../../worker/lib/database';
import { appForShop, getShopifyApps } from '../../worker/lib/shopify-apps';
import { createTestEnv, sessionToken, type TestContext } from '../helpers/env';
import { installFetchMock, json } from '../helpers/fetch-mock';
import { seedShop } from '../helpers/fixtures';

const ALPHA = 'alpha.myshopify.com';
const BETA = 'beta.myshopify.com';
const APP_A = { name: 'Store A', clientId: 'client-id-aaaa', clientSecret: 'secret-a', shops: [ALPHA] };
const APP_B = { name: 'Store B', clientId: 'client-id-bbbb', clientSecret: 'secret-b', shops: [BETA] };

function multiAppEnv(): TestContext {
  const t = createTestEnv();
  Object.assign(t.env, {
    SHOPIFY_API_KEY: undefined,
    SHOPIFY_API_SECRET: undefined,
    SHOPIFY_APPS: JSON.stringify([APP_A, APP_B]),
  });
  return t;
}

const tokenFor = (shop: string, a: { clientId: string; clientSecret: string }) =>
  sessionToken(shop, { aud: a.clientId, secret: a.clientSecret });

describe('SHOPIFY_APPS registry', () => {
  it('parses apps and resolves a shop to its app', () => {
    const env = { SHOPIFY_APPS: JSON.stringify([APP_A, APP_B]) };
    expect(getShopifyApps(env).apps.map((a) => a.name)).toEqual(['Store A', 'Store B']);
    expect(appForShop(env, BETA)?.clientId).toBe(APP_B.clientId);
    expect(appForShop(env, 'gamma.myshopify.com')).toBeNull();
    // The app a shop actually installed wins over the configured list.
    expect(appForShop(env, BETA, APP_A.clientId)?.clientId).toBe(APP_A.clientId);
  });

  it('reports configuration mistakes without exposing secrets', () => {
    expect(getShopifyApps({ SHOPIFY_APPS: '{not json' }).errors).toEqual(['SHOPIFY_APPS is not valid JSON']);
    const dup = getShopifyApps({ SHOPIFY_APPS: JSON.stringify([APP_A, { ...APP_B, shops: [ALPHA] }]) });
    expect(dup.errors).toEqual([`${ALPHA} is assigned to both "Store A" and "Store B"`]);
    const bad = getShopifyApps({ SHOPIFY_APPS: JSON.stringify([{ name: 'X', clientId: 'client-id-xxxx' }]) });
    expect(bad.errors.join(' ')).toContain('clientSecret is missing');
    expect(JSON.stringify(bad)).not.toContain('secret-');
  });

  it('keeps the legacy single-app variables working', () => {
    const env = { SHOPIFY_API_KEY: 'legacy-client-id', SHOPIFY_API_SECRET: 's' };
    expect(appForShop(env, 'any.myshopify.com')?.clientId).toBe('legacy-client-id');
  });
});

describe('one Worker serving several Shopify apps', () => {
  let t: TestContext;
  beforeEach(() => {
    t = multiAppEnv();
  });
  afterEach(() => vi.unstubAllGlobals());

  const get = async (path: string, token: string) =>
    app.request(path, { headers: { Authorization: `Bearer ${token}` } }, t.env, t.ctx);

  it('verifies each store’s session token with its own app and exchanges with that app’s credentials', async () => {
    const mock = installFetchMock();
    mock.on((req) =>
      req.url === `https://${BETA}/admin/oauth/access_token`
        ? json({ access_token: 'shpat_beta', scope: 'read_themes,write_themes' })
        : undefined,
    );
    const res = await get('/api/settings', await tokenFor(BETA, APP_B));
    expect(res.status).toBe(200);
    const sent = new URLSearchParams(mock.calls[0]!.body ?? '');
    expect(sent.get('client_id')).toBe(APP_B.clientId);
    expect(sent.get('client_secret')).toBe(APP_B.clientSecret);
    expect((await findShopByDomain(getDb(t.env.DB), BETA))?.shopifyClientId).toBe(APP_B.clientId);
  });

  it('rejects a token whose audience names one app but is signed with another app’s secret', async () => {
    const forged = await sessionToken(BETA, { aud: APP_B.clientId, secret: APP_A.clientSecret });
    expect((await get('/api/settings', forged)).status).toBe(401);
  });

  it('rejects tokens for apps this server does not know (no retry loop)', async () => {
    const res = await get('/api/settings', await sessionToken(BETA, { aud: 'client-id-zzzz', secret: 'x' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Shopify-Retry-Invalid-Session-Request')).toBeNull();
  });

  it('serves each store the client ID of its own app in the HTML shell', async () => {
    const html = async (query: string) => (await (await app.request(`/?${query}`, {}, t.env, t.ctx)).text());
    expect(await html(`shop=${BETA}&embedded=1`)).toContain(`content="${APP_B.clientId}"`);
    expect(await html(`shop=${ALPHA}&embedded=1`)).toContain(`content="${APP_A.clientId}"`);
    const idToken = await tokenFor(BETA, APP_B);
    expect(await html(`id_token=${idToken}&embedded=1`)).toContain(`content="${APP_B.clientId}"`);
  });

  it('starts OAuth with the store’s own app and refuses to guess when unassigned', async () => {
    const res = await app.request(`/auth?shop=${BETA}`, {}, t.env, t.ctx);
    expect(new URL(res.headers.get('location')!).searchParams.get('client_id')).toBe(APP_B.clientId);
    const unknown = await app.request('/auth?shop=gamma.myshopify.com', {}, t.env, t.ctx);
    expect(unknown.status).toBe(400);
  });

  it('identifies the app from the webhook signature and ignores webhooks from an app the shop no longer uses', async () => {
    await seedShop(t.env, ALPHA, { clientId: APP_A.clientId, github: false });
    const deliver = (secret: string) => {
      const body = JSON.stringify({ domain: ALPHA });
      return app.request(
        '/webhooks/app/uninstalled',
        {
          method: 'POST',
          body,
          headers: {
            'X-Shopify-Hmac-Sha256': createHmac('sha256', secret).update(body).digest('base64'),
            'X-Shopify-Topic': 'app/uninstalled',
            'X-Shopify-Shop-Domain': ALPHA,
            'X-Shopify-Webhook-Id': crypto.randomUUID(),
          },
        },
        t.env,
        t.ctx,
      );
    };
    expect((await deliver('not-a-secret')).status).toBe(401);
    expect((await deliver(APP_B.clientSecret)).status).toBe(200);
    expect((await findShopByDomain(getDb(t.env.DB), ALPHA))?.status).toBe('installed');
    expect((await deliver(APP_A.clientSecret)).status).toBe(200);
    expect((await findShopByDomain(getDb(t.env.DB), ALPHA))?.status).toBe('uninstalled');
  });
});
