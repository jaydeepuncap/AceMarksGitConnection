import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The React app lives in ./app and is built to ./dist/client, which is the
 * directory wrangler.toml serves through the ASSETS binding.
 *
 * Embedded development (`npm run dev` / `shopify app dev`) does NOT use the Vite
 * dev server: Vite rebuilds into dist/client in watch mode and `wrangler dev`
 * serves API + assets from one origin behind the Shopify CLI tunnel. That keeps
 * App Bridge, session tokens and CSP identical to production.
 *
 * `npm run dev:frontend` starts the Vite dev server for isolated UI work only;
 * its /api proxy points at a separately running `wrangler dev` on :8787.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
