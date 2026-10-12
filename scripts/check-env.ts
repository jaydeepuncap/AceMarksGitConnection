/**
 * Validates local configuration before `npm run dev`:
 *   - .dev.vars exists and defines the required secrets (values are never printed)
 *   - ENCRYPTION_KEY decodes to 32 bytes
 *   - wrangler.toml / shopify.app.toml placeholders are reported
 *
 * Usage: npm run check-env            (local)
 *        npm run check-env -- --prod  (also fail on production placeholders)
 */
import { existsSync, readFileSync } from 'node:fs';

const prod = process.argv.includes('--prod');
const errors: string[] = [];
const warnings: string[] = [];

function parseDevVars(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (match && !line.trim().startsWith('#')) out[match[1]!] = match[2]!;
  }
  return out;
}

if (!prod) {
  if (!existsSync('.dev.vars')) {
    errors.push('.dev.vars is missing. Copy .dev.vars.example to .dev.vars and fill it in.');
  } else {
    const vars = parseDevVars('.dev.vars');
    for (const name of ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'ENCRYPTION_KEY']) {
      const value = vars[name] ?? process.env[name];
      if (!value || value.startsWith('replace-with')) errors.push(`${name} is not set in .dev.vars`);
    }
    const key = vars.ENCRYPTION_KEY;
    if (key && !key.startsWith('replace-with') && Buffer.from(key, 'base64').length !== 32) {
      errors.push('ENCRYPTION_KEY must be 32 random bytes encoded as base64');
    }
    if (process.env.SHOPIFY_API_KEY && vars.SHOPIFY_API_KEY && process.env.SHOPIFY_API_KEY !== vars.SHOPIFY_API_KEY) {
      warnings.push('SHOPIFY_API_KEY from Shopify CLI differs from .dev.vars — session tokens will fail verification.');
    }
  }
}

const wrangler = readFileSync('wrangler.toml', 'utf8');
const shopifyToml = readFileSync('shopify.app.toml', 'utf8');
// Match the real table header, not mentions of it in comments.
const prodStart = wrangler.search(/^\[env\.production\]/m);
const prodSection = prodStart >= 0 ? wrangler.slice(prodStart) : '';
const devSection = prodStart >= 0 ? wrangler.slice(0, prodStart) : wrangler;

if (/REPLACE_WITH_DEV_/.test(devSection)) {
  warnings.push('wrangler.toml dev D1/KV IDs are placeholders (fine for local `wrangler dev`, required for --remote).');
}
const prodPlaceholders = prodSection.match(/REPLACE_WITH_[A-Z0-9_]+/g) ?? [];
if (prodPlaceholders.length) {
  (prod ? errors : warnings).push(`wrangler.toml production placeholders: ${[...new Set(prodPlaceholders)].join(', ')}`);
}
const tomlPlaceholders = shopifyToml.match(/REPLACE_WITH_[A-Z0-9_]+/g) ?? [];
if (tomlPlaceholders.length) {
  (prod ? errors : warnings).push(
    `shopify.app.toml placeholders: ${[...new Set(tomlPlaceholders)].join(', ')} (run \`shopify app config link\`)`,
  );
}

for (const w of warnings) console.warn(`⚠  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖  ${e}`);
  process.exit(1);
}
console.log(`✔  Environment looks good${prod ? ' for production' : ''}.`);
