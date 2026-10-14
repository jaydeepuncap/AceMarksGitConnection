/**
 * Validates local configuration before `npm run dev`:
 *   - .dev.vars exists and defines the required secrets (values are never printed)
 *   - ENCRYPTION_KEY decodes to 32 bytes
 *   - wrangler.toml / shopify.app.toml placeholders are reported
 *
 * Usage: npm run check-env            (local)
 *        npm run check-env -- --prod  (also fail on production placeholders)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { getShopifyApps } from '../worker/lib/shopify-apps.ts';

const prod = process.argv.includes('--prod');
const errors: string[] = [];
const warnings: string[] = [];

function parseDevVars(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#')) {
      // Strip one pair of surrounding quotes ('…' lets SHOPIFY_APPS hold JSON).
      out[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return out;
}

if (!prod) {
  if (!existsSync('.dev.vars')) {
    errors.push('.dev.vars is missing. Copy .dev.vars.example to .dev.vars and fill it in.');
  } else {
    const vars = parseDevVars('.dev.vars');
    const value = (name: string) => {
      const v = vars[name] ?? process.env[name];
      return v && !v.startsWith('replace-with') ? v : undefined;
    };
    if (!value('ENCRYPTION_KEY')) errors.push('ENCRYPTION_KEY is not set in .dev.vars');
    // Same validation the Worker applies (worker/lib/shopify-apps.ts); secrets are never printed.
    const apps = getShopifyApps({
      SHOPIFY_APPS: value('SHOPIFY_APPS'),
      SHOPIFY_API_KEY: value('SHOPIFY_API_KEY'),
      SHOPIFY_API_SECRET: value('SHOPIFY_API_SECRET'),
    });
    errors.push(...apps.errors);
    if (apps.apps.length > 0) {
      console.log(`Shopify apps: ${apps.apps.map((a) => `${a.name} (${a.clientId})`).join(', ')}`);
    }
    const key = vars.ENCRYPTION_KEY;
    if (key && !key.startsWith('replace-with')) {
      const len = key.length === 32 || (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) ? 32 : Buffer.from(key, 'base64').length;
      if (len !== 32) {
        errors.push('ENCRYPTION_KEY must be 32 bytes (or 32 characters, or base64-encoded)');
      }
    }
    if (process.env.SHOPIFY_API_KEY && !apps.apps.some((a) => a.clientId === process.env.SHOPIFY_API_KEY)) {
      warnings.push('The app Shopify CLI is running is not in .dev.vars — its session tokens will fail verification.');
    }
  }
}

const wrangler = readFileSync('wrangler.toml', 'utf8');
// Top level = production; named environments start at the first real [env.*] header.
const envStart = wrangler.search(/^\[env\./m);
const prodSection = envStart >= 0 ? wrangler.slice(0, envStart) : wrangler;
const envSections = envStart >= 0 ? wrangler.slice(envStart) : '';

const prodPlaceholders = prodSection.match(/REPLACE_WITH_[A-Z0-9_]+/g) ?? [];
if (prodPlaceholders.length) {
  (prod ? errors : warnings).push(`wrangler.toml production placeholders: ${[...new Set(prodPlaceholders)].join(', ')}`);
}
if (/REPLACE_WITH_/.test(envSections)) {
  warnings.push('wrangler.toml [env.development] IDs are placeholders (fine for local dev, required for --remote).');
}

// Shopify app configs: at least one must be linked to a real app.
const appConfigs = readdirSync('.').filter((f) => /^shopify\.app(\.[\w-]+)?\.toml$/.test(f));
const linked = appConfigs.filter((f) => {
  const id = /^client_id\s*=\s*"([^"]*)"/m.exec(readFileSync(f, 'utf8'))?.[1] ?? '';
  return id !== '' && !id.startsWith('REPLACE_WITH');
});
if (linked.length === 0) {
  (prod ? errors : warnings).push('No shopify.app*.toml is linked to an app (run `npm run shopify:link`).');
}
for (const f of appConfigs.filter((f) => !linked.includes(f))) {
  warnings.push(`${f} still has placeholders and is skipped by \`npm run shopify:deploy\`.`);
}

for (const w of warnings) console.warn(`⚠  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖  ${e}`);
  process.exit(1);
}
console.log(`✔  Environment looks good${prod ? ' for production' : ''}.`);
