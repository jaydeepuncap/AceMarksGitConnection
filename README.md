# Ace Marks Git Connection

A Shopify embedded app that connects a store to a GitHub repository. You can browse commits, inspect changed files, and sync the contents of **one exact commit** to a Shopify theme. Every sync goes through a preview and an explicit confirmation first.

- **Runtime:** Cloudflare Workers + Hono, D1 (SQLite via Drizzle ORM), KV, Queues, static assets binding
- **Admin UI:** React 19 + TypeScript + Vite, [Polaris web components](https://shopify.dev/docs/api/app-home/polaris-web-components), App Bridge v4, React Router
- **APIs:** Shopify Admin GraphQL `2026-07`, GitHub REST `2022-11-28`

---

## Contents

1. [Architecture](#architecture)
2. [Authentication: three separate mechanisms](#authentication-three-separate-mechanisms)
3. [Shopify scopes and theme write access](#shopify-scopes-and-theme-write-access)
4. [Data model and migrations](#data-model-and-migrations)
5. [Sync workflow](#sync-workflow)
6. [Setup](#setup)
   - [Multiple stores (one custom app per store)](#multiple-stores-one-custom-app-per-store)
7. [Local development](#local-development)
8. [Testing](#testing)
9. [Deploy to production](#deploy-to-production)
10. [Configuration reference](#configuration-reference)
11. [API reference](#api-reference)
12. [Limits and known constraints](#limits-and-known-constraints)
13. [Troubleshooting](#troubleshooting)

---

## Architecture

```
Shopify Admin (iframe)
  └─ React app (Polaris web components + App Bridge v4)
       │  Authorization: Bearer <session token from shopify.idToken()>
       ▼
Cloudflare Worker (Hono) ── one origin serves API + static assets
  ├─ /api/*            session-token auth → routes (settings, github, themes, commits, sync)
  ├─ /auth, /auth/callback   authorization-code OAuth (fallback)
  ├─ /webhooks/*       HMAC-verified Shopify webhooks
  ├─ everything else   dist/client via ASSETS (+ frame-ancestors CSP, API key injection)
  ├─ queue()           Cloudflare Queues consumer: runs sync jobs in chunks
  └─ scheduled()       daily cleanup of expired previews / old sessions
       │                       │                         │
       ▼                       ▼                         ▼
     D1 (Drizzle)        KV (cache, OAuth state)   Shopify Admin GraphQL / GitHub REST
```

```
ace-marks-git-connection/
├── app/                     React admin UI (Vite root)
│   ├── components/          AppLayout, LoadingState, ErrorBanner, ConfirmSyncModal
│   ├── routes/              Dashboard, Settings, Repositories, Themes, Commits, SyncHistory
│   ├── lib/                 app-bridge.ts, api-client.ts, types.ts, validation.ts, hooks.ts, format.ts
│   ├── App.tsx  main.tsx  index.html  vite-env.d.ts
├── shared/                  API contract + theme-path rules imported by BOTH app and worker
│   ├── api-types.ts
│   └── theme-paths.ts
├── worker/
│   ├── index.ts             Hono app, route mounting, document serving, queue + cron handlers
│   ├── env.ts               Bindings (Env) and request context types
│   ├── middleware/          shopify-session-token.ts, shopify-oauth.ts, error-handler.ts
│   ├── routes/              health, oauth, settings, github, themes, commits, sync, webhooks
│   ├── lib/                 shopify-graphql, github-client, database, sessions, crypto,
│   │                        validators, response, logger, http, cache, clients
│   └── sync/                planner.ts (preview), executor.ts (chunked writes), dispatch.ts
├── drizzle/schema.ts        Drizzle schema (source of truth for migrations)
├── migrations/              Generated SQL migrations (the ONLY migrations directory)
├── extensions/              Reserved for future Shopify app extensions
├── scripts/                 check-env.ts, deploy.sh
├── test/                    worker/, app/, helpers/ (Vitest)
├── public/                  Static files copied into dist/client
├── wrangler.toml  shopify.app.toml  shopify.web.toml
├── vite.config.ts  vitest.config.ts  drizzle.config.ts  eslint.config.js
└── tsconfig*.json           app (DOM), worker (Workers types), node (tooling), test
```

**How the modules connect**

- `shared/api-types.ts` is the single API contract. Routes return these shapes through `worker/lib/response.ts`, and `app/lib/api-client.ts` consumes the same types.
- `worker/middleware/shopify-session-token.ts` resolves the shop and puts `c.var.auth` on the request. Every route reads the shop from there, and every query in `worker/lib/database.ts` filters by that `shopId`.
- `worker/lib/clients.ts` builds authenticated Shopify and GitHub clients for a shop. HTTP routes and the queue consumer share it.
- `worker/sync/planner.ts` writes the previewed plan to D1. `worker/sync/executor.ts` executes exactly that stored plan. `worker/sync/dispatch.ts` decides whether the work runs on Queues or inline.

**Why Polaris web components.** `@shopify/polaris` (React) is deprecated, and Shopify now ships Polaris as web components loaded from `https://cdn.shopify.com/shopifycloud/polaris.js`. `@shopify/polaris-types` provides the JSX types. These types assume React 19 semantics: props are set as DOM properties, and `onChange`/`onInput` attach native listeners. React 18 does neither for custom elements, so the app uses React 19.

---

## Authentication: three separate mechanisms

These mechanisms are **not interchangeable**. Each one is accepted only on its own routes.

| Context | Credential | Verified by | Code |
|---|---|---|---|
| Embedded API calls (`/api/*`) | App Bridge **session token** (JWT, HS256, 1 min TTL) in `Authorization: Bearer` | Signature with the client secret; `exp`/`nbf` (10 s tolerance); `aud` = client ID; `dest` = `https://{shop}`; `iss` = `https://{shop}/admin`, same shop; `*.myshopify.com` | `worker/middleware/shopify-session-token.ts` |
| OAuth callback (`/auth/callback`) | **Query-string HMAC** (hex HMAC-SHA256 over sorted params) + `state` | HMAC; `timestamp` within 10 min; `state` param == HttpOnly cookie == single-use KV entry for the same shop | `worker/middleware/shopify-oauth.ts`, `worker/routes/oauth.ts` |
| Webhooks (`/webhooks/*`) | **Body HMAC** (`X-Shopify-Hmac-Sha256`, base64) | HMAC over the **raw bytes** before JSON parsing; de-duplicated by `X-Shopify-Webhook-Id` | `worker/routes/webhooks.ts` |

**Shop identity.** The shop always comes from a verified credential. The app ignores any `shop` sent in a query, header or body for `/api/*` calls (a test covers this).

**Admin API access.** The app uses **expiring offline access tokens**, which Shopify requires for new public apps. It sends them as `X-Shopify-Access-Token` to the Admin GraphQL API and never sends a session token there.

1. **Token exchange (primary).** Installation is Shopify-managed (`use_legacy_install_flow = false`). On the first API request from a shop with no usable token, the middleware exchanges the request's session token for an offline token (`expiring=1`). Reinstalls and expired refresh tokens recover the same way, with no redirect.
2. **Refresh.** Tokens are refreshed 5 minutes before expiry. Refresh tokens rotate, so the app de-duplicates refreshes per isolate and writes the new tokens with a compare-and-set on `shops.token_version`. If another isolate wins the race, its token is used.
3. **Authorization-code OAuth (fallback).** `/auth?shop=…` → Shopify → `/auth/callback`. Use it for non-embedded installs or manual re-authorization.

**Cookies.** The only cookie is `__Host-ace_oauth_state`: HttpOnly, Secure, SameSite=Lax, 10 minutes, OAuth only. The embedded app keeps session tokens in memory only, never in cookies or Web Storage.

**Other controls**

- CORS on `/api/*` allows only the app's own origin.
- HTML documents get `Content-Security-Policy: frame-ancestors https://{shop} https://admin.shopify.com`.
- Rate limits are per shop: 120 requests/min for the API and 10/min for sync endpoints, using the Workers Rate Limiting binding. `/auth` is limited per IP.
- JSON bodies are size-capped and validated with zod.
- Logs are redacted: sensitive keys and token-shaped strings (`shpat_`, `ghp_`, `github_pat_`, JWTs, `Bearer …`) are masked before logging.

---

## Shopify scopes and theme write access

`shopify.app.toml` requests `read_themes,write_themes`:

| Scope | Used for |
|---|---|
| `read_themes` | `themes` / `theme(id)` queries, `OnlineStoreTheme.files` (preview, existence checks) |
| `write_themes` | `themeFilesUpsert`, `themeFilesDelete` (sync) |

If you only need browsing and previews, you can drop `write_themes`. The Dashboard then shows *Missing write_themes*.

> **Important: the theme-file exemption.** Shopify gates writes to theme files. `write_themes` alone is **not enough**: your app also needs Shopify to approve its *theme modification* exemption. Request it from Shopify through the Partner Dashboard, using the request link in the [`themeFilesUpsert` documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert). Approvals are tied to one app, so re-apply for each new app. Until Shopify approves it, the mutations return `ACCESS_DENIED`. The app reports this as `THEME_WRITE_NOT_PERMITTED`, marks the run failed, and shows an explanation in the UI. Listing, previews and history keep working.

The app uses only the supported GraphQL theme APIs (`themes`, `theme`, `OnlineStoreTheme.files`, `themeFilesUpsert`, `themeFilesDelete`, `job`). It does not use the REST Asset API, and it never publishes a theme.

---

## Data model and migrations

The schema lives in `drizzle/schema.ts`:

| Table | Purpose |
|---|---|
| `shops` | One row per store: status, granted scopes, **encrypted** offline + refresh tokens, `token_version` |
| `sessions` | Shopify admin sessions seen via session tokens (`sid`, user ID), used for audit only. Tokens are never stored. |
| `github_connections` | Per-shop GitHub credential (**encrypted** PAT), account, verified repository |
| `app_settings` | Default repository, branch, theme, sync preferences (JSON) |
| `sync_history` | One row per preview/sync: repo, exact commit SHA, theme, status, counters, error details, timestamps |
| `sync_operations` | Durable per-file job state (`pending`/`succeeded`/`failed`/`skipped`, attempts, error) |

Every tenant table has a `shop_id` foreign key with `ON DELETE CASCADE`, plus indexes for the access paths (`shop_id, initiated_at`, `shop_id, status`, `sync_id, path` unique, …).

**Encryption.** Credentials are encrypted with AES-256-GCM using a random IV, with `ENCRYPTION_KEY` (32 bytes, base64) as the key. The additional authenticated data names the shop and purpose, so a ciphertext copied into another shop's row fails to decrypt. The format is `v1.<keyId>.<iv>.<ciphertext>`.

**Key rotation**

1. Set the old key as `ENCRYPTION_KEY_PREVIOUS` and a new `ENCRYPTION_KEY`.
2. Deploy. Values are decrypted with whichever key matches the `keyId`, and each token is re-encrypted with the new key the next time it is written.
3. Remove `ENCRYPTION_KEY_PREVIOUS` once all rows have been rewritten.

If you lose `ENCRYPTION_KEY`, merchants must reconnect GitHub. Shopify tokens are re-obtained automatically through token exchange.

**Migration convention: one canonical directory, `./migrations`.** Drizzle Kit writes `NNNN_name.sql` there (`drizzle.config.ts → out`). Wrangler applies the same files (`wrangler.toml → migrations_dir`) and tracks progress in D1's `d1_migrations` table. `migrations/meta/` is Drizzle's snapshot journal: Drizzle uses it to diff the next change, and Wrangler ignores it. Commit both.

```bash
# after editing drizzle/schema.ts
npm run db:generate          # → migrations/0001_<name>.sql
npm run db:migrate:local     # local D1 under .wrangler/state
npm run db:migrate:remote    # production D1 (--env production)
```

---

## Sync workflow

1. Pick a **theme** (Themes page or Settings).
2. Pick a **commit** (Commits page). The full 40-character SHA is the source of truth from here on.
3. The app shows the commit's changed files with added/modified/renamed/removed status and the theme path each one maps to, or why it can't be synced.
4. **Preview** (`POST /api/sync/preview`). The backend:
   - verifies the theme exists *in this shop* and is writable (not `LOCKED`, `DEMO`, `ARCHIVED` or processing);
   - loads the commit's files: the diff for `commit_changes`, or the full tree for `full_snapshot`;
   - validates every path, rejecting traversal (`..`), absolute paths, backslashes, control characters and anything outside `assets/ blocks/ config/ layout/ locales/ sections/ snippets/ templates/`;
   - applies the theme root and ignore patterns (`config/settings_data.json` is ignored by default to protect theme-editor customizations);
   - checks which target files already exist (create vs update) without downloading content;
   - stores the plan as a `previewed` run, valid for 30 minutes. **The theme is not touched.**
5. **Confirm** in the modal (`POST /api/sync` with `confirm: true`). For the **live theme** you must also tick a checkbox and type the theme name exactly. The server re-reads the theme at confirmation time, so a theme that was published after the preview still requires this. Only one active sync per theme is allowed, and the `previewed → queued` transition is atomic, so a double-submit cannot start two runs.
6. **Execute** in the background, in chunks of up to 50 operations, the per-mutation limit for `themeFilesUpsert`/`themeFilesDelete`. Each upsert batch is also capped at about 4 MB of payload:
   - Each file is fetched from GitHub with `GET /repos/{o}/{r}/contents/{path}?ref=<commit SHA>`. The Git blob SHA of the downloaded bytes is recomputed and must equal the blob SHA GitHub reported for that file in the selected commit. Any mismatch fails that file.
     *Example: a file changed in commits B and D, and you selected B → the bytes from B are uploaded, never the bytes from D or HEAD.*
   - UTF-8 files are sent as `TEXT`, binary files (images, fonts) as `BASE64`. Files over 10 MB are rejected.
   - Asynchronous Shopify jobs are polled until done.
   - Per-file `userErrors` mark only that file as failed. Throttling, 5xx and timeouts are retried up to 3 attempts. A missing permission or authorization stops the whole run.
7. **Record.** Status ends as `succeeded`, `partially_failed` or `failed`, with per-file errors. **Retry** (`POST /api/sync/history/:id/retry`) resets only failed files. It's safe because every write is idempotent: the same blob from the same SHA, and deleting an already-missing file counts as success.

**Deletions** are off by default. When you enable them, the app deletes only files the commit removed or renamed away, and only if they exist in the theme. It never deletes `layout/theme.liquid`, `config/settings_schema.json` or `config/settings_data.json`. `full_snapshot` never deletes anything.

**Background jobs.** The primary path is **Cloudflare Queues**. The consumer processes chunks and re-enqueues itself, with backoff on rate limits. Job state lives in D1, so redelivery is harmless. Without a queue binding (for example on the Workers Free plan), the app runs chunks in `ctx.waitUntil()` for about 25 seconds. If work remains, the next poll from the Sync History page resumes it.

---

## Setup

### Prerequisites

- Node.js ≥ 22.13 (the tests use `node:sqlite`), npm ≥ 10
- A Cloudflare account. Queues need the Workers Paid plan; without it the app uses the inline fallback.
- A [Shopify Partner](https://partners.shopify.com) account and a development store
- Shopify CLI: `npm i -g @shopify/cli` (or use `npx @shopify/cli`)

### 1. Install

```bash
npm ci
cp .dev.vars.example .dev.vars
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → ENCRYPTION_KEY
```

### 2. Shopify Partner Dashboard / app configuration

1. Create the app: `shopify app config link` (choose *Create new app*). This fills `client_id` in `shopify.app.toml`.
2. Copy the client ID and secret into `.dev.vars` (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`). `shopify app env show` prints them.
3. For production, set `application_url` and `[auth].redirect_urls` to your Worker URL, for example `https://ace-marks-git-connection.<subdomain>.workers.dev` and `…/auth/callback`. During `shopify app dev` the CLI points these at the dev tunnel automatically.
4. Run `shopify app deploy` to release the scopes and webhook subscriptions from `shopify.app.toml`.
5. **Request the theme-file exemption** (see [above](#shopify-scopes-and-theme-write-access)).
6. Create a **development store** in the Partner Dashboard and install the app on it (`shopify app dev` offers this).

### 3. Cloudflare resources

```bash
npx wrangler login

# Development (only needed for --remote; local dev works with placeholders)
npx wrangler d1 create ace-marks-git-connection-dev     # → database_id for top-level [[d1_databases]]
npx wrangler kv namespace create KV                      # → id for top-level [[kv_namespaces]]
npx wrangler queues create ace-marks-sync-dev
npx wrangler queues create ace-marks-sync-dlq-dev

# Production
npx wrangler d1 create ace-marks-git-connection          # → [[env.production.d1_databases]] database_id
npx wrangler kv namespace create KV --env production     # → [[env.production.kv_namespaces]] id
npx wrangler queues create ace-marks-sync
npx wrangler queues create ace-marks-sync-dlq
```

Replace every `REPLACE_WITH_*` value in `wrangler.toml` with the IDs those commands print, and set `SHOPIFY_APP_URL` under `[env.production.vars]`. `npm run check-env -- --prod` lists anything still missing.

### 4. GitHub credential (per shop, entered in the app)

The connection model is a **fine-grained personal access token** per shop, stored encrypted in D1. In GitHub, go to *Settings → Developer settings → Fine-grained tokens* and create one with:

- **Repository access:** only the theme repository
- **Repository permissions:** *Contents: Read-only* and *Metadata: Read-only*

Then paste it in **Settings → GitHub connection**. The app verifies it with `GET /user`, and with `GET /repos/{o}/{r}` plus a commits read when you enter a repository. Classic tokens (`ghp_…`, `repo` scope) also work but grant much more access. GitHub returns `404` for private repositories the token can't see, so the app checks access explicitly and never assumes it.

The GitHub client is modular (`worker/lib/github-client.ts`), so you can add a GitHub App installation token later by adding an `auth_type` and a token provider.

---

## Multiple stores (one custom app per store)

A **custom-distribution** app can only be installed on one store, or on several stores that belong to the same Shopify Plus organization ([Shopify docs](https://shopify.dev/docs/apps/distribution/select-distribution-method)). Five unrelated stores therefore need **five Shopify apps**, each with its own client ID and client secret.

This project runs all of them from **one Worker, one database and one codebase**:

| Concern | How it is handled |
|---|---|
| Credentials | Worker secret `SHOPIFY_APPS`: a JSON array of `{ name, clientId, clientSecret, shops }`. The legacy `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` pair still works as one more app. |
| Which app a request belongs to | Always proven by Shopify's signature: session token `aud` + that app's secret, OAuth HMAC, or webhook HMAC. A token signed with app A's secret can never pass as app B. |
| Access tokens | Each store's offline token is exchanged and refreshed with **its own app's** credentials. `shops.shopify_client_id` records which app the store installed. |
| HTML shell | Every app uses the same URL. The page receives the right client ID from the `id_token` Shopify adds to the URL, or from the shop's app. |
| Webhooks | A webhook from an app the store no longer uses cannot uninstall or erase the store's current install. |
| Code updates | `npm run deploy` deploys the Worker once and every store gets the new code immediately. |
| App config updates (scopes, URLs, webhooks) | `npm run apps:deploy` runs `shopify app deploy` for every `shopify.app.*.toml`. |

### Add a store

1. In the [Partner Dashboard](https://partners.shopify.com), go to **Apps → Create app → Create app manually**, then choose **Custom distribution** and enter the store's domain. Copy the **Client ID** and **Client secret**.
2. Create the store's config from the shared template, then release it:
   ```bash
   npm run apps:new -- store-b <client-id>   # writes shopify.app.store-b.toml (commit it)
   npm run apps:deploy                        # releases scopes, URLs and webhooks to every app
   ```
3. Add the app to `shopify-apps.secret.json`. This file is gitignored; start from `config/shopify-apps.example.json`. Then upload it:
   ```bash
   npm run apps:check         # validates every entry and cross-checks the .toml files (never prints secrets)
   npm run apps:push-secret   # uploads it as the SHOPIFY_APPS Worker secret
   ```
4. Generate the install link in the Partner Dashboard (**Distribution → Generate link**) and install the app on the store.
5. Request the **theme-modification exemption for this app** (see [Shopify scopes and theme write access](#shopify-scopes-and-theme-write-access)). Shopify approves it per app.

### Release a change to all stores

```bash
npm run deploy        # code: one Worker deploy updates every store
npm run apps:deploy   # only when shopify.app.*.toml / the template changed
npm run deploy:all    # both
```

To change scopes or webhooks for every store, edit `config/shopify.app.template.toml` and the generated `shopify.app.*.toml` files the same way, then run `npm run apps:deploy`.

**Encryption.** `ENCRYPTION_KEY` is shared by all apps. Every stored token is still bound to its own store (AES-GCM associated data), so one store's ciphertext cannot be decrypted as another's.

## Local development

```bash
npm run db:migrate:local     # once, and after every new migration
shopify app dev              # recommended: tunnel + install on the dev store
```

`shopify app dev` reads `shopify.web.toml` and runs `npm run dev`, which runs:

- `vite build --watch` → `dist/client`
- `wrangler dev --port $PORT`, which serves the API **and** the built assets from one origin behind the CLI tunnel. That keeps App Bridge, session tokens and CSP identical to production. The CLI's `APP_URL` is passed as `SHOPIFY_APP_URL`.

Then open the app from the development store's admin.

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev:worker` / `npm run dev:web` | Run either half alone |
| `npm run dev:frontend` | Vite dev server with `/api` proxied to `:8787`, for isolated UI work. Outside Shopify Admin the app shows an *Open this app from Shopify Admin* screen because App Bridge is unavailable. |
| `npm run preview` | Production build served by `wrangler dev` |
| `npm run check-env` | Validates `.dev.vars` and config placeholders |

Local D1/KV/Queues are simulated under `.wrangler/state` (git-ignored).

---

## Testing

```bash
npm test            # all Vitest projects
npm run typecheck   # tsc -b over app, worker, tooling and tests
npm run lint
```

| Project | Environment | What's real vs mocked |
|---|---|---|
| `worker` | Node 22 (same Web APIs as Workers: fetch, Web Crypto, Request/Response) | **Real** Hono app, middleware, Drizzle queries and **the real `migrations/*.sql`** on `node:sqlite`. KV, Queue, rate limiter and `waitUntil` are in-memory fakes. Shopify and GitHub are mocked at `fetch`. |
| `app` | jsdom | Real components and API client. The App Bridge `shopify` global and the API module are stubbed. |

Coverage map:

| Requirement | Test file |
|---|---|
| Session-token validation (signature, aud, exp, nbf, iss/dest, non-Shopify dest) | `test/worker/session-token.test.ts` |
| Token exchange, encrypted storage, refresh rotation | `test/worker/session-token.test.ts` |
| OAuth HMAC, state cookie/KV, replay, stale timestamp | `test/worker/oauth-webhooks.test.ts` |
| Webhook HMAC over raw body, uninstall, scopes update, `shop/redact`, de-dup | `test/worker/oauth-webhooks.test.ts` |
| Shop-level data isolation, shop taken only from the token, rate limiting | `test/worker/isolation.test.ts` |
| GitHub access (404/403/Contents), rate limits, pagination, 3000-file cap | `test/worker/github-client.test.ts` |
| **Commit-specific retrieval** (B vs D vs HEAD), SHA-only reads, blob SHA | `test/worker/github-client.test.ts` |
| File path validation, theme root, globs | `test/worker/theme-paths.test.ts` |
| Preview generation (no writes), snapshot strategy, deletions, protected files | `test/worker/sync.test.ts` |
| Live-theme confirmation, expiry, double-confirm, concurrent-sync guard | `test/worker/sync.test.ts` |
| Failure handling (integrity, userErrors, ACCESS_DENIED) and **idempotent retry** | `test/worker/sync.test.ts` |
| Migrations, constraints, CAS token writes, cascade deletes | `test/worker/database.test.ts` |
| Crypto (AES-GCM, AAD binding, rotation, git blob SHA) | `test/worker/crypto.test.ts` |
| Frontend loading / empty / error states, API client retries | `test/app/*.test.tsx` |

For an end-to-end check against a real store, use `shopify app dev` with a development store and a test repository. Preview first, and sync to an **unpublished** theme.

---

## Deploy to production

One-time:

```bash
npx wrangler secret put SHOPIFY_API_KEY    --env production
npx wrangler secret put SHOPIFY_API_SECRET --env production
npx wrangler secret put ENCRYPTION_KEY     --env production
```

Each release:

```bash
npm run deploy     # = scripts/deploy.sh
```

`scripts/deploy.sh` runs these steps in order:

1. `check-env --prod` (fails on placeholders)
2. lint, typecheck and tests
3. `vite build`
4. `wrangler d1 migrations apply DB --remote --env production`
5. `wrangler deploy --env production`
6. `shopify app deploy`

Flags: `--skip-shopify`, `--skip-tests`.

Verify with `curl https://<app-url>/api/health`, then open the app in the store's admin. Watch logs with `npx wrangler tail --env production`; they are structured JSON with `requestId`, `shop` and `syncId` fields.

For CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus `SHOPIFY_CLI_PARTNERS_TOKEN` for `shopify app deploy`.

---

## Configuration reference

| Value | Where it lives | Notes |
|---|---|---|
| `client_id`, app name, URLs, scopes, webhooks | `shopify.app.toml` (Shopify CLI) | Released with `shopify app deploy` |
| `SHOPIFY_APPS` | `.dev.vars` (single-line JSON in single quotes); Worker secret via `npm run apps:push-secret` | Every app's `{ name, clientId, clientSecret, shops }`. See [Multiple stores](#multiple-stores-one-custom-app-per-store). |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | `.dev.vars`; Worker secrets | Legacy single-app credentials. Still supported, and treated as one more app. |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_PREVIOUS` | `.dev.vars`; Worker secrets | 32-byte base64 AES key / rotation key |
| `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES`, `SHOPIFY_APP_URL`, `GITHUB_API_BASE_URL`, `LOG_LEVEL`, `APP_ENV` | `wrangler.toml [vars]` / `[env.production.vars]` | Non-secret. `.dev.vars` can override them locally. |
| `DB` | `wrangler.toml [[d1_databases]]` | D1 binding. No connection strings or env vars. |
| `KV` | `wrangler.toml [[kv_namespaces]]` | Cache, OAuth state, webhook de-dup, session-seen markers |
| `SYNC_QUEUE` | `wrangler.toml [[queues.*]]` | Optional; enables background jobs |
| `API_RATE_LIMITER`, `SYNC_RATE_LIMITER` | `wrangler.toml [[ratelimits]]` | Optional; a per-isolate fallback is used if absent |
| `ASSETS` | `wrangler.toml [assets]` | `dist/client`, `run_worker_first = true`, SPA fallback |
| GitHub PAT | Entered in the app UI → D1 (encrypted) | Never in env vars; never returned to the browser |

`wrangler.toml` targets Wrangler v4 (installed as a dev dependency). Bindings and vars are **not inherited** by `[env.production]`, which is why it redeclares all of them.

---

## API reference

All `/api/*` endpoints except `/api/health` require `Authorization: Bearer <session token>`.

Responses always use one of these envelopes:

```json
{ "success": true, "data": { }, "message": "Operation completed successfully" }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "The request contains invalid parameters", "details": [ { "path": "commitSha", "message": "…" } ], "requestId": "…" } }
```

Status codes: `400` validation, `401` session (with `X-Shopify-Retry-Invalid-Session-Request: 1`) or re-auth, `403` permission, `404` not found or another shop's resource, `409` conflict/state, `410` preview expired, `422` live-theme confirmation required, `429` rate limited (with `Retry-After`), `502`/`504` upstream.

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/health` | – | `{ status: "ok", time }` |
| `GET /api/settings` | – | `{ shop, settings }` |
| `PUT /api/settings` | `{ defaultRepository?, defaultBranch?, defaultThemeId?, syncPreferences?: { strategy?, allowDeletes?, themeRoot?, ignorePatterns? } }` | `{ shop, settings }`. The repository/branch are verified on GitHub and the theme in this shop. |
| `GET /api/github/connection` | – | `{ connected, connection }` (never the token) |
| `POST /api/github/connection` | `{ token, repository? }` | `201 { connected: true, connection }` |
| `DELETE /api/github/connection` | – | `{ connected: false }` |
| `GET /api/github/repositories` | `?page&perPage&q` | `Paginated<GithubRepository>` |
| `GET /api/github/branches` | `?repository=owner/name&page&perPage` | `Paginated<GithubBranch>` |
| `GET /api/themes` | `?refresh=1` | `ShopifyTheme[]` (`id`, `name`, `role`, `processing`, `isLive`, `writable`) |
| `GET /api/commits` | `?repository&branch&path&page&perPage` | `Paginated<CommitSummary>` |
| `GET /api/commits/:sha` | `?repository` | `CommitDetail` (`filesCount`, `filesTruncated`) |
| `GET /api/commits/:sha/files` | `?repository&page&perPage` (≤300) | `Paginated<CommitFile>` with `themePath`/`themePathError` |
| `POST /api/sync/preview` | `{ commitSha, themeId, repository?, branch?, strategy?, allowDeletes?, includePaths? }` | `201 SyncPreview` |
| `POST /api/sync` | `{ syncId, confirm: true, confirmLiveTheme?, confirmThemeName? }` | `202 SyncRun` |
| `GET /api/sync/history` | `?page&perPage&status&includePreviews` | `Paginated<SyncRun>` |
| `GET /api/sync/history/:id` | – | `SyncRunDetail` (run + operations) |
| `POST /api/sync/history/:id/retry` | `{ confirmLiveTheme?, confirmThemeName? }` | `202 SyncRun` |

Example: preview.

```http
POST /api/sync/preview
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9…
Content-Type: application/json

{ "commitSha": "4f2c9e0d8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d", "themeId": "gid://shopify/OnlineStoreTheme/123456789" }
```

```json
{
  "success": true,
  "message": "Preview generated. No changes were made to the theme.",
  "data": {
    "syncId": "6a0d2c4e-…",
    "expiresAt": "2026-10-12T10:30:00.000Z",
    "repository": "acme/storefront-theme",
    "commit": { "sha": "4f2c9e0d…", "message": "Update header" },
    "theme": { "id": "gid://shopify/OnlineStoreTheme/123456789", "name": "Dev copy", "role": "UNPUBLISHED", "isLive": false, "writable": true },
    "strategy": "commit_changes",
    "summary": { "creates": 1, "updates": 2, "deletes": 0, "skipped": 1, "total": 4 },
    "operations": [
      { "path": "sections/header.liquid", "action": "upsert", "changeType": "modified", "existsInTheme": true, "blobSha": "9b1c…", "skipReason": null },
      { "path": "config/settings_data.json", "action": "skip", "changeType": "modified", "skipReason": "Matches ignore pattern \"config/settings_data.json\"" }
    ],
    "warnings": [],
    "requiresLiveConfirmation": false
  }
}
```

Example: confirm a sync to the live theme.

```json
POST /api/sync
{ "syncId": "6a0d2c4e-…", "confirm": true, "confirmLiveTheme": true, "confirmThemeName": "Dawn" }

→ 202 { "success": true, "message": "Sync started", "data": { "id": "6a0d2c4e-…", "status": "queued", "filesChanged": 3, "canRetry": false } }
```

---

## Limits and known constraints

- **Theme writes need Shopify's exemption** in addition to `write_themes` (see above).
- **GitHub lists at most 3000 changed files per commit.** The app flags this (`filesTruncated`) and recommends `full_snapshot`, which reads the recursive tree. If GitHub truncates the tree too (more than 100k entries or 7 MB), set a theme root folder.
- **Merge commits** list changes against the first parent. The preview warns about this.
- **The Contents API** raw media type supports files up to 100 MB. The app caps synced files at 10 MB.
- **D1** allows 100 bound parameters per statement, so inserts are chunked. Very large plans (5000+ files) are rejected with guidance to narrow them.
- **Worker limits.** One request never processes an unbounded sync: work runs in chunks via Queues, or via the `waitUntil` fallback with resume-on-poll.
- **KV is eventually consistent.** It only caches immutable data (commit files by SHA) or data that may be briefly stale (theme list, 60 s). Writes always re-read the theme from Shopify.
- **No automatic publishing**, and no writes outside the previewed plan.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI says *Open this app from Shopify Admin* | Open it through the store admin. App Bridge only works embedded. |
| `401` loops on every request | `SHOPIFY_API_KEY`/`SECRET` in `.dev.vars` or the Worker secrets don't match the app's client credentials |
| `THEME_WRITE_NOT_PERMITTED` | The theme-file exemption isn't approved yet, or `write_themes` hasn't been granted |
| `SHOPIFY_REAUTH_REQUIRED` on a background sync | Open the app once (token exchange re-authorizes), then press **Retry** |
| `GITHUB_NOT_FOUND` for a repo you can see in the browser | The token isn't granted that repository. Fine-grained tokens must list it explicitly. |
| `GITHUB_RATE_LIMITED` | Wait for `retryAfter`. Background syncs back off and resume automatically. |
| Sync stuck in *Queued* without Queues | Keep the Sync History detail page open. Polling resumes stalled runs. |
| `wrangler dev` requests hang behind a corporate proxy | Start it with `HTTPS_PROXY`/`HTTP_PROXY` unset for the local server |
