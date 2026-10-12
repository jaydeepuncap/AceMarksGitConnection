import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit generates plain SQL migrations into ./migrations, the same
 * directory wrangler.toml declares as `migrations_dir`. Wrangler applies them
 * (`wrangler d1 migrations apply`) and records progress in the D1 table
 * `d1_migrations`. Drizzle's own `migrations/meta` journal is only used by
 * `drizzle-kit generate` to diff the schema; Wrangler ignores it.
 *
 * Workflow:
 *   1. edit drizzle/schema.ts
 *   2. npm run db:generate        → migrations/NNNN_<name>.sql
 *   3. npm run db:migrate:local   → local D1 (.wrangler/state)
 *   4. npm run db:migrate:remote  → production D1
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './drizzle/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
