import { defineConfig } from 'drizzle-kit';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Finds the local D1 SQLite file managed by Wrangler.
 * When you run `npm run db:migrate:local` or `wrangler dev`, Wrangler stores
 * the local D1 database in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<id>.sqlite`.
 */
function getLocalD1DB(): string {
  try {
    const basePath = path.resolve('.wrangler');
    if (fs.existsSync(basePath)) {
      const files = fs
        .readdirSync(basePath, { recursive: true, encoding: 'utf-8' })
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => path.resolve(basePath, f));

      if (files.length > 0) {
        // Return the most recently modified sqlite file
        files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return files[0]!;
      }
    }
  } catch {
    // Ignore read errors
  }

  // Ensure parent directory exists for fallback if migrations haven't run yet
  const fallbackDir = path.resolve('.wrangler/state/v3/d1');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return path.resolve(fallbackDir, 'local.sqlite');
}

const isRemote = process.env.DB_REMOTE === 'true';

export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  ...(isRemote && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
    ? {
        driver: 'd1-http',
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID || '0fa8cf96-ed3d-4505-9028-79064d9a422a',
          token: process.env.CLOUDFLARE_API_TOKEN,
        },
      }
    : {
        dbCredentials: {
          url: process.env.LOCAL_DB_PATH || getLocalD1DB(),
        },
      }),
});
