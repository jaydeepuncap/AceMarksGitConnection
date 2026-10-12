/** GET /api/health — liveness probe. Unauthenticated; reveals no configuration. */
import { Hono } from 'hono';
import type { HealthResponse } from '@shared/api-types';
import type { AppEnv } from '../env';
import { ok } from '../lib/response';

export const healthRoutes = new Hono<AppEnv>().get('/', (c) =>
  ok<HealthResponse>(c, { status: 'ok', time: new Date().toISOString() }),
);
