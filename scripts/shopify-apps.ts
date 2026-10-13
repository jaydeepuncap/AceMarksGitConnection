/**
 * Manage the per-store Shopify apps served by this one Worker.
 *
 *   npm run apps:new -- <store-name> <client-id>   create shopify.app.<store-name>.toml from the template
 *   npm run apps:check                             validate shopify-apps.secret.json against the .toml files
 *   npm run apps:push-secret                       upload shopify-apps.secret.json as the SHOPIFY_APPS secret
 *   npm run apps:deploy                            `shopify app deploy` for every store app (config, scopes, webhooks)
 *
 * shopify-apps.secret.json holds every app's client ID + secret. It is gitignored:
 * never commit it. Secrets are never printed by this script.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SECRET_FILE = 'shopify-apps.secret.json';
const TEMPLATE = 'config/shopify.app.template.toml';
const APP_URL = process.env.APP_URL ?? 'https://ace-marks-git-connection.uncap.workers.dev';
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;

interface AppEntry {
  name: string;
  clientId: string;
  clientSecret: string;
  shops?: string[];
}

function fail(message: string): never {
  console.error(`✖  ${message}`);
  process.exit(1);
}

/** shopify.app*.toml files that point at a real app (placeholder client IDs are skipped). */
function storeConfigs(): { file: string; clientId: string; name: string }[] {
  return readdirSync('.')
    .filter((f) => /^shopify\.app(\.[\w-]+)?\.toml$/.test(f))
    .map((file) => {
      const text = readFileSync(file, 'utf8');
      const clientId = /^client_id\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? '';
      const name = /^name\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? file;
      return { file, clientId, name };
    })
    .filter((c) => CLIENT_ID.test(c.clientId) && !c.clientId.startsWith('REPLACE_WITH'));
}

function readSecretFile(): AppEntry[] {
  if (!existsSync(SECRET_FILE)) {
    fail(`${SECRET_FILE} not found. Copy config/shopify-apps.example.json to ${SECRET_FILE} and fill it in.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
  } catch {
    fail(`${SECRET_FILE} is not valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) fail(`${SECRET_FILE} must be a non-empty JSON array`);
  return parsed as AppEntry[];
}

function check(): AppEntry[] {
  const apps = readSecretFile();
  const errors: string[] = [];
  const ids = new Set<string>();
  const shops = new Map<string, string>();
  apps.forEach((a, i) => {
    const label = a.name || `entry ${i + 1}`;
    if (!a.name) errors.push(`${label}: "name" is required`);
    if (!CLIENT_ID.test(a.clientId ?? '')) errors.push(`${label}: "clientId" is missing or invalid`);
    if (!a.clientSecret) errors.push(`${label}: "clientSecret" is missing`);
    if (ids.has(a.clientId)) errors.push(`${label}: duplicate clientId`);
    ids.add(a.clientId);
    for (const s of a.shops ?? []) {
      if (!SHOP.test(s)) errors.push(`${label}: "${s}" is not a *.myshopify.com domain`);
      if (shops.has(s)) errors.push(`${s} is listed under both "${shops.get(s)}" and "${label}"`);
      shops.set(s, label);
    }
    if (!a.shops?.length) errors.push(`${label}: list the store domain in "shops" so OAuth and the app shell can find it`);
  });

  const configs = storeConfigs();
  for (const cfg of configs) {
    if (!ids.has(cfg.clientId)) errors.push(`${cfg.file} (client ${cfg.clientId}) has no entry in ${SECRET_FILE}`);
  }
  for (const a of apps) {
    if (!configs.some((c) => c.clientId === a.clientId)) {
      console.warn(`⚠  "${a.name}" has no shopify.app.*.toml (run: npm run apps:new -- <store-name> ${a.clientId})`);
    }
  }

  console.log('Apps:');
  for (const a of apps) {
    const cfg = configs.find((c) => c.clientId === a.clientId);
    console.log(`  • ${a.name.padEnd(24)} ${a.clientId}  shops=${(a.shops ?? []).join(',') || '—'}  config=${cfg?.file ?? '—'}`);
  }
  if (errors.length) {
    for (const e of errors) console.error(`✖  ${e}`);
    process.exit(1);
  }
  console.log(`✔  ${apps.length} app(s) valid.`);
  return apps;
}

function newApp(storeName: string | undefined, clientId: string | undefined) {
  if (!storeName || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(storeName)) {
    fail('Usage: npm run apps:new -- <store-name: lowercase letters, digits, dashes> <client-id>');
  }
  if (!clientId || !CLIENT_ID.test(clientId)) fail('A valid client ID (from the Partner Dashboard) is required');
  const file = `shopify.app.${storeName}.toml`;
  if (existsSync(file)) fail(`${file} already exists`);
  const toml = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('{{CLIENT_ID}}', clientId)
    .replaceAll('{{NAME}}', `Ace Marks Git Connection (${storeName})`)
    .replaceAll('{{HANDLE}}', `ace-marks-git-connection-${storeName}`)
    .replaceAll('{{APP_URL}}', APP_URL.replace(/\/+$/, ''));
  writeFileSync(file, toml);
  console.log(`✔  Created ${file}. Next: add the app to ${SECRET_FILE}, then npm run apps:push-secret && npm run apps:deploy`);
}

function pushSecret() {
  check();
  const env = process.argv.includes('--env') ? ['--env', process.argv[process.argv.indexOf('--env') + 1]!] : [];
  // Compact JSON on stdin: the secret never appears in argv or the terminal.
  const value = JSON.stringify(readSecretFile());
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', 'SHOPIFY_APPS', ...env], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) fail('wrangler secret put failed');
}

function deployAll() {
  const configs = storeConfigs();
  if (configs.length === 0) fail('No shopify.app.*.toml with a real client_id found');
  const force = process.argv.includes('--force') ? ['--force'] : [];
  for (const cfg of configs) {
    console.log(`\n▶ shopify app deploy --config ${cfg.file}  (${cfg.name})`);
    execFileSync('npx', ['--yes', '@shopify/cli@latest', 'app', 'deploy', '--config', cfg.file, ...force], {
      stdio: 'inherit',
    });
  }
  console.log(`\n✔  Released configuration to ${configs.length} app(s).`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'new':
    newApp(args[0], args[1]);
    break;
  case 'check':
    check();
    break;
  case 'push-secret':
    pushSecret();
    break;
  case 'deploy':
    deployAll();
    break;
  default:
    fail('Commands: new <store-name> <client-id> | check | push-secret [--env <name>] | deploy [--force]');
}
