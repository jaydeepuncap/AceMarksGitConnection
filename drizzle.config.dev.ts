import { defineConfig } from 'drizzle-kit';
import fs from 'node:fs';
import path from 'node:path';

function getLocalD1DB(): string {
  try {
    const basePath = path.resolve('.wrangler');
    if (fs.existsSync(basePath)) {
      const files = fs
        .readdirSync(basePath, { recursive: true, encoding: 'utf-8' })
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => path.resolve(basePath, f));

      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return files[0]!;
      }
    }
  } catch {
    // Ignore read errors
  }

  const fallbackDir = path.resolve('.wrangler/state/v3/d1');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return path.resolve(fallbackDir, 'local.sqlite');
}

export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.LOCAL_DB_PATH || getLocalD1DB(),
  },
});
