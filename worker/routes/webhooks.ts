/**
 * Shopify webhooks (subscribed in shopify.app.toml).
 *
 * Authentication: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(client secret, raw body)).
 * The raw body is read once as bytes and verified BEFORE parsing. Invalid
 * signatures get 401. Handlers are idempotent and deliveries are de-duplicated
 * by X-Shopify-Webhook-Id, because Shopify retries until it receives a 200.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { syncHistory } from '../../drizzle/schema';
import type { AppEnv } from '../env';
import { cacheKeys } from '../lib/cache';
import {
  deleteGithubConnection,
  deleteShopData,
  findShopByDomain,
  getDb,
  markShopUninstalled,
  updateShopScopes,
} from '../lib/database';
import { ApiError } from '../lib/response';
import { normalizeShopDomain } from '../lib/validators';
import { verifyWebhookHmac } from '../middleware/shopify-oauth';

type WebhookVars = AppEnv & {
  Variables: AppEnv['Variables'] & { webhook: { shop: string; topic: string; id: string | null; payload: unknown } };
};

const MAX_WEBHOOK_BYTES = 1024 * 1024;

const verifyWebhook = (): MiddlewareHandler<WebhookVars> => async (c, next) => {
  const raw = new Uint8Array(await c.req.raw.arrayBuffer());
  if (raw.byteLength > MAX_WEBHOOK_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Webhook payload too large');

  const valid = await verifyWebhookHmac(raw, c.req.header('X-Shopify-Hmac-Sha256'), c.env.SHOPIFY_API_SECRET);
  if (!valid) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid webhook signature');

  const shop = normalizeShopDomain(c.req.header('X-Shopify-Shop-Domain'));
  const topic = c.req.header('X-Shopify-Topic') ?? '';
  if (!shop || !topic) throw new ApiError(400, 'VALIDATION_ERROR', 'Missing webhook headers');

  let payload: unknown;
  try {
    payload = raw.byteLength ? JSON.parse(new TextDecoder().decode(raw)) : null;
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Webhook body is not JSON');
  }

  const id = c.req.header('X-Shopify-Webhook-Id') ?? null;
  if (id) {
    const key = cacheKeys.webhookSeen(id);
    if (await c.env.KV.get(key)) {
      c.get('logger').info('webhook.duplicate', { topic, shop });
      return c.body(null, 200);
    }
    c.executionCtx.waitUntil(c.env.KV.put(key, '1', { expirationTtl: 24 * 60 * 60 }));
  }
  c.set('webhook', { shop, topic, id, payload });
  c.set('logger', c.get('logger').child({ shop, topic, webhookId: id }));
  await next();
};

export const webhookRoutes = new Hono<WebhookVars>()
  .use('*', verifyWebhook())
  .post('/app/uninstalled', async (c) => {
    const { shop } = c.get('webhook');
    const db = getDb(c.env.DB);
    const record = await findShopByDomain(db, shop);
    await markShopUninstalled(db, shop);
    if (record) {
      // Remove the GitHub credential immediately and stop pending work.
      await deleteGithubConnection(db, record.id);
      await db
        .update(syncHistory)
        .set({
          status: 'cancelled',
          completedAt: new Date(),
          errorDetails: { code: 'SHOP_UNINSTALLED', message: 'App was uninstalled' },
        })
        .where(and(eq(syncHistory.shopId, record.id), inArray(syncHistory.status, ['previewed', 'queued', 'running'])));
    }
    c.get('logger').info('webhook.app_uninstalled');
    return c.body(null, 200);
  })
  .post('/app/scopes_update', async (c) => {
    const { shop, payload } = c.get('webhook');
    const current = (payload as { current?: unknown })?.current;
    if (Array.isArray(current)) {
      await updateShopScopes(getDb(c.env.DB), shop, current.filter((s) => typeof s === 'string').join(','));
    }
    c.get('logger').info('webhook.scopes_updated');
    return c.body(null, 200);
  })
  .post('/compliance', async (c) => {
    const { shop, topic } = c.get('webhook');
    switch (topic) {
      case 'customers/data_request':
      case 'customers/redact':
        // This app stores no customer personal data; nothing to export or erase.
        break;
      case 'shop/redact':
        // Sent 48 h after uninstall: erase everything for the shop.
        await deleteShopData(getDb(c.env.DB), shop);
        break;
      default:
        throw new ApiError(400, 'VALIDATION_ERROR', `Unexpected compliance topic ${topic}`);
    }
    c.get('logger').info('webhook.compliance_handled');
    return c.body(null, 200);
  });
