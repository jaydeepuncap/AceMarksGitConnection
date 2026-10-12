import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const shared = fileURLToPath(new URL('./shared', import.meta.url));

/**
 * Two test projects:
 *  - worker: runs Worker modules in Node 22, which provides the same Web APIs
 *    the Workers runtime does (fetch, Request/Response, crypto.subtle, TextEncoder).
 *    D1 is emulated with node:sqlite and the real files in ./migrations,
 *    KV and Queues with in-memory fakes (test/helpers/env.ts).
 *  - app: React components in jsdom with a stubbed App Bridge `shopify` global.
 */
export default defineConfig({
  resolve: { alias: { '@shared': shared } },
  test: {
    projects: [
      {
        resolve: { alias: { '@shared': shared } },
        test: {
          name: 'worker',
          environment: 'node',
          include: ['test/worker/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { '@shared': shared } },
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['test/app/**/*.test.tsx'],
          setupFiles: ['test/setup-dom.ts'],
        },
      },
    ],
  },
});
