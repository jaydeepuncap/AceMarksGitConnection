#!/usr/bin/env bash
# Production deployment: checks → tests → build → D1 migrations → Worker → Shopify app config.
#
# Prerequisites (one time, see README "Deploy to production"):
#   - wrangler login (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in CI)
#   - production D1/KV/Queue IDs filled into the top level of wrangler.toml
#   - secrets: npm run apps:push-secret (SHOPIFY_APPS) and wrangler secret put ENCRYPTION_KEY
#   - one linked shopify.app.<store>.toml per store app (npm run apps:new / npm run shopify:link)
#
# Flags: --skip-shopify   do not release Shopify app configuration (npm run shopify:deploy:ci)
#        --skip-tests     skip lint/typecheck/tests (not recommended)
set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_SHOPIFY=false
SKIP_TESTS=false
for arg in "$@"; do
  case "$arg" in
    --skip-shopify) SKIP_SHOPIFY=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

step "Validating configuration"
npx tsx scripts/check-env.ts --prod

if [ "$SKIP_TESTS" = false ]; then
  step "Lint, typecheck and tests"
  npm run lint
  npm run typecheck
  npm test
fi

step "Building the React app (dist/client)"
npm run build:web

# Production is the top-level environment in wrangler.toml (--env="" targets it explicitly).
step "Applying D1 migrations to production"
npx wrangler d1 migrations apply DB --remote --env=""

step "Deploying the Worker (one deploy updates every store's app)"
npx wrangler deploy --env=""

if [ "$SKIP_SHOPIFY" = false ]; then
  step "Releasing Shopify app configuration to every store app (scopes, URLs, webhooks)"
  npx tsx scripts/shopify-apps.ts deploy --ci
fi

step "Done"
echo "Health check: curl -fsS \"\$(grep -m1 '^SHOPIFY_APP_URL' wrangler.toml | cut -d'\"' -f2)/api/health\""
