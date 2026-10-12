#!/usr/bin/env bash
# Production deployment: checks → tests → build → D1 migrations → Worker → Shopify app config.
#
# Prerequisites (one time, see README "Deploy to production"):
#   - wrangler login (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in CI)
#   - production D1/KV/Queue created and IDs filled into wrangler.toml [env.production]
#   - secrets: wrangler secret put SHOPIFY_API_KEY|SHOPIFY_API_SECRET|ENCRYPTION_KEY --env production
#   - shopify app config link (fills client_id in shopify.app.toml)
#
# Flags: --skip-shopify   do not run `shopify app deploy`
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

step "Applying D1 migrations to production"
npx wrangler d1 migrations apply DB --remote --env production

step "Deploying the Worker"
npx wrangler deploy --env production

if [ "$SKIP_SHOPIFY" = false ]; then
  step "Releasing Shopify app configuration (scopes, URLs, webhooks)"
  if command -v shopify >/dev/null 2>&1; then
    shopify app deploy
  else
    npx --yes @shopify/cli@latest app deploy
  fi
fi

step "Done"
echo "Health check: curl -fsS \"\$(grep -m1 '^application_url' shopify.app.toml | cut -d'\"' -f2)/api/health\""
