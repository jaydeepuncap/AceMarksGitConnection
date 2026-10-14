/**
 * Worker entry point.
 *
 *   /api/health            public liveness probe
 *   /api/*                 App Bridge session token required (middleware/shopify-session-token.ts)
 *   /auth, /auth/callback  authorization-code OAuth (query HMAC + state)
 *   /webhooks/*            Shopify webhooks (body HMAC)
 *   everything else        React app from the ASSETS binding, with the embedded-app CSP
 *
 * Also exports the Cloudflare Queues consumer (background sync) and a daily
 * scheduled cleanup.
 */
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, inArray, lt } from 'drizzle-orm';
import { syncHistory } from '../drizzle/schema';
import type { AppEnv, Env, HonoEnv, SyncJobMessage } from './env';
import { deleteExpiredSessions, getDb, transitionSyncRun } from './lib/database';
import { createLogger } from './lib/logger';
import { normalizeShopDomain } from './lib/validators';
import {
  apiSecurityHeaders,
  errorHandler,
  notFoundHandler,
  rateLimit,
  requestContext,
  requireServerConfig,
} from './middleware/error-handler';
import { requireShopifySession } from './middleware/shopify-session-token';
import { commitsRoutes } from './routes/commits';
import { githubRoutes } from './routes/github';
import { healthRoutes } from './routes/health';
import { appBaseUrl, decodeAdminHost, oauthRoutes } from './routes/oauth';
import { settingsRoutes } from './routes/settings';
import { syncRoutes } from './routes/sync';
import { themesRoutes } from './routes/themes';
import { webhookRoutes } from './routes/webhooks';
import { handleSyncMessage } from './sync/dispatch';

export const app = new Hono<AppEnv>();

app.use('*', requestContext());
app.onError(errorHandler);

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use('/api/*', apiSecurityHeaders());
// The UI is served from this same origin, so cross-origin browser calls are refused.
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => (origin === appBaseUrl(c.env, c.req.url) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
    exposeHeaders: ['X-Request-Id', 'Retry-After', 'X-Shopify-Retry-Invalid-Session-Request'],
    maxAge: 600,
  }),
);
app.route('/api/health', healthRoutes);

app.use('/api/*', requireServerConfig());
app.use('/api/*', requireShopifySession());
app.use(
  '/api/*',
  rateLimit({ binding: 'API_RATE_LIMITER', limit: 120, periodSeconds: 60, key: (c) => c.get('auth').shopDomain }),
);
app.route('/api/settings', settingsRoutes);
app.route('/api/github', githubRoutes);
app.route('/api/themes', themesRoutes);
app.route('/api/commits', commitsRoutes);
app.route('/api/sync', syncRoutes);
app.all('/api/*', notFoundHandler);

// ---------------------------------------------------------------------------
// OAuth & webhooks (IP-based limits; these are unauthenticated entry points)
// ---------------------------------------------------------------------------
const ipKey = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('cf-connecting-ip') ?? 'unknown';
app.use('/auth/*', rateLimit({ binding: 'API_RATE_LIMITER', limit: 30, periodSeconds: 60, key: ipKey }));
app.use('/auth', rateLimit({ binding: 'API_RATE_LIMITER', limit: 30, periodSeconds: 60, key: ipKey }));
app.use('/auth', requireServerConfig());
app.use('/auth/*', requireServerConfig());
app.use('/webhooks/*', requireServerConfig());
app.route('/auth', oauthRoutes);
app.route('/webhooks', webhookRoutes);
app.all('/webhooks/*', notFoundHandler);

// ---------------------------------------------------------------------------
// Embedded app document + static assets
// ---------------------------------------------------------------------------
/** frame-ancestors must name the shop and Shopify Admin so only they can embed the app. */
export function frameAncestors(shop: string | null): string {
  return shop
    ? `frame-ancestors https://${shop} https://admin.shopify.com;`
    : 'frame-ancestors https://admin.shopify.com;';
}

export async function serveSpa(c: Context<HonoEnv>): Promise<Response> {
  const url = new URL(c.req.url);
  const shop = normalizeShopDomain(url.searchParams.get('shop'));
  const isDocument = !/\.[a-z0-9]+$/i.test(url.pathname);

  // Opened outside Shopify Admin (e.g. after install redirects): send the merchant into the embedded app.
  if (isDocument && shop && url.searchParams.get('embedded') !== '1') {
    const adminHost = decodeAdminHost(url.searchParams.get('host'), shop);
    if (adminHost) return c.redirect(`https://${adminHost}/apps/${c.env.SHOPIFY_API_KEY}${url.pathname}`, 302);
  }

  const res = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return res;

  const html = (await res.text()).replaceAll(
    '__SHOPIFY_API_KEY__',
    c.env.SHOPIFY_API_KEY ?? '',
  );

  c.header('Content-Security-Policy', frameAncestors(shop));
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  return c.html(html);
}

app.get('*', serveSpa);

app.notFound(notFoundHandler);

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------
const MAX_MESSAGE_ATTEMPTS = 5;

export default {
  fetch: app.fetch,

  /** Cloudflare Queues consumer: one sync chunk per message, re-enqueued while work remains. */
  async queue(batch: MessageBatch<SyncJobMessage>, env: Env): Promise<void> {
    const logger = createLogger(env.LOG_LEVEL, { component: 'sync-queue' });
    for (const message of batch.messages) {
      try {
        const delay = await handleSyncMessage(env, message.body, logger);
        if (delay !== null && env.SYNC_QUEUE) {
          await env.SYNC_QUEUE.send(message.body, delay > 0 ? { delaySeconds: Math.min(delay, 43_200) } : undefined);
        }
        message.ack();
      } catch (err) {
        logger.error('sync.queue_message_failed', { syncId: message.body.syncId, attempts: message.attempts, error: err });
        if (message.attempts >= MAX_MESSAGE_ATTEMPTS) {
          await transitionSyncRun(getDb(env.DB), message.body.shopId, message.body.syncId, ['queued', 'running'], 'failed', {
            completedAt: new Date(),
            errorDetails: { code: 'INTERNAL_ERROR', message: 'Background processing failed repeatedly; use Retry' },
          });
          message.ack();
        } else {
          message.retry({ delaySeconds: 30 * message.attempts });
        }
      }
    }
  },

  /** Daily cleanup (wrangler.toml [triggers]): expire stale previews, drop old sessions. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const logger = createLogger(env.LOG_LEVEL, { component: 'cron' });
    const db = getDb(env.DB);
    const now = new Date();
    await db
      .update(syncHistory)
      .set({ status: 'expired' })
      .where(and(inArray(syncHistory.status, ['previewed']), lt(syncHistory.previewExpiresAt, now)));
    // Expired previews older than 7 days are deleted together with their planned operations.
    await db
      .delete(syncHistory)
      .where(
        and(
          inArray(syncHistory.status, ['expired']),
          lt(syncHistory.initiatedAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
        ),
      );
    await deleteExpiredSessions(db, now);
    logger.info('cron.cleanup_completed');
  },
} satisfies ExportedHandler<Env, SyncJobMessage>;
