# Theme Sync (Ace Marks Git Connection)

**Staging first. Live when you say so.** Theme Sync is the custom Shopify app that keeps every store of the Ace Marks Collection on the same theme code. Developers save work in the master GitHub repository; a merchant picks an update, sees every file each commit changes, applies it to the store's **Staging** theme, tests it, and then publishes the same update to the **Live** theme. Nothing changes in any store until someone reviews and confirms it.

- **Runtime:** Cloudflare Workers + Hono, D1 (SQLite via Drizzle ORM), KV, Queues, static assets binding
- **Admin UI:** React 19 + TypeScript + Vite, [Polaris web components](https://shopify.dev/docs/api/app-home/polaris-web-components), App Bridge v4, React Router
- **APIs:** Shopify Admin GraphQL `2026-07`, GitHub REST `2022-11-28`

---

## Contents

1. [Architecture](#architecture)
2. [Authentication: three separate mechanisms](#authentication-three-separate-mechanisms)
3. [Shopify scopes and theme write access](#shopify-scopes-and-theme-write-access)
4. [Data model and migrations](#data-model-and-migrations)
5. [Theme Sync workflow](#theme-sync-workflow)
6. [Setup](#setup)
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
│   ├── components/          AppLayout, LoadingState, ErrorBanner, FileList, CommitFiles, StoreHeader, ThemeBadges
│   ├── routes/              Dashboard (overview), Themes, Updates (+ go back), UpdateRun (checks, review,
│   │                        progress, result), Publish, Rollout, History, Settings
│   ├── lib/                 app-bridge.ts, api-client.ts, types.ts, validation.ts, hooks.ts, format.ts
│   ├── App.tsx  main.tsx  index.html  vite-env.d.ts
├── shared/                  API contract + theme-path rules imported by BOTH app and worker
│   ├── api-types.ts
│   └── theme-paths.ts
├── worker/
│   ├── index.ts             Hono app, route mounting, document serving, queue + cron handlers
│   ├── env.ts               Bindings (Env) and request context types
│   ├── middleware/          shopify-session-token.ts, shopify-oauth.ts, error-handler.ts
│   ├── routes/              health, oauth, overview, settings, github, themes, commits, updates (+ history),
│   │                        rollout, webhooks
│   ├── lib/                 shopify-graphql, github-client, database, sessions, crypto, md5, store-group,
│   │                        validators, response, logger, http, cache, clients
│   └── sync/                plan.ts (tree diff, checks, review), code-check.ts, executor.ts (backup → apply →
│                            theme-sync.json), runs.ts (confirm/retry), runtime.ts, dispatch.ts
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
| `app_settings` | Master repository and branch, the **Staging** and **Live** theme of the store, preferences (theme folder, protected files, ignored files) |
| `theme_states` | The **last synced update** of each theme — saved only when every file of an update succeeded |
| `theme_file_checksums` | Shopify's checksum of every file the app wrote, used to detect files edited directly in Shopify |
| `sync_history` | One row per run (update, publish, go back, restore, recorded baseline): base and target commit, included commits (JSON), check results (JSON), status, counters, timestamps. A partial unique index allows only one queued/running run per theme. |
| `sync_operations` | Durable per-file job state: action, content source, backup state/KV key, status, attempts, error kind |

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

## Theme Sync workflow

The screens follow the client guide (*Theme Sync Client Guide v1.1*):

| Screen | Route | What it does |
|---|---|---|
| Themes (home) | `/`, `/themes` | **Every theme** of the store with its published status, last synced update (from `assets/theme-sync.json`) and last run; setup checklist |
| Theme page | `/themes/:id` | One theme: last synced update, **branch** picker, that branch's commits (**New** / **Current** / **Added** / **Tested**, files per commit) with *Update to this →*, *Go back to this →*, *Already running this*; on the published theme *Publish to Live →* for tested commits; the theme's full update history with branch |
| Checks + Review | `/updates/:id` | Code check, direct edit detection, every included update with its files, totals, confirm |
| Progress + result | `/updates/:id` | Backup, file-by-file progress, preview link, *Publish to Live →*; for incomplete runs *Retry failed files*, *Run full update again*, *Restore backup* |
| Roll out | `/rollout` | One update to the Staging themes of several stores (needs `STORE_GROUP` and a Staging theme per store) |
| Update history | `/history` | Every run: date, theme, what, updated to, branch, status |
| Settings | `/settings` | GitHub, master repository/branch, protected files, ignored files, *Test connection* |

**Test before Live.** The published theme is the Live theme. It never receives a commit directly: apply the commit to any unpublished theme first; once that update fully completes the commit is **Tested** and can be published to Live from the published theme's page or from the update result.

**Protected vs. ignored files.** *Protected* files are files the store edits in Shopify (brand settings, theme-editor content): if the file already exists in a theme it is never replaced or removed, so those edits are kept; if it does not exist yet (a new template) it is created once. *Ignored* files are repository files that must never go to Shopify: they are skipped completely — never created, changed or removed.

### One-time setup (per store)

1. **Connect GitHub** — a fine-grained token per store, or one shared `GITHUB_TOKEN` Worker secret for all stores; choose the master repository (or set `MASTER_REPOSITORY`).
2. **Themes.** The published theme is Live automatically; any unpublished theme can be used to test updates.
3. **Confirm protected files.** Defaults: `config/settings_data.json` (brand colors, type, theme settings), `templates/**/*.json` and `sections/*-group.json` (content edited in the theme editor). A protected file that already exists in a theme is **never replaced or removed**; a new one (for example a new template) is created.
4. **Record where each theme starts.** A theme with no last synced update can either be marked *Already running this* (records the update without changing files) or receive a first update, which writes the complete theme from that update and removes nothing. Themes that carry `assets/theme-sync.json` (for example a duplicate) are picked up automatically.
5. **Test connection** checks GitHub, Shopify and whether Shopify lets the app change theme files (theme-modification exemption) — without changing anything.

### Updating a theme

1. **Choose an update.** Updates are listed from the branch, newest first. **Selecting the newest applies every update before it, in order**, so no developer work is left out.
2. **Plan** (`POST /api/updates/plan`) — nothing changes in the theme. The backend:
   - compares the repository **trees** of the theme's last synced update (base) and the selected update (target). That gives the exact files to add, change and remove, independent of commit sizes, merges and files changed back in between;
   - lists the included updates (base → target) with the files each one changed, and which update last touched each file;
   - applies the theme folder, ignored files, protected files and the never-removed required files (`layout/theme.liquid`, `config/settings_*.json`); `assets/theme-sync.json` is reserved;
   - **code check:** every `.liquid` / `.json` file is downloaded at the exact commit, its Git blob SHA verified, and checked: JSON must parse (Shopify's comment headers are allowed); Liquid tags/output must be closed, block tags (`if`/`for`/`case`/`capture`/`form`/…) balanced, raw blocks ended and `{% schema %}` valid JSON. Errors **block** the update;
   - **direct edit detection:** each file the update replaces or removes is compared with what was last synced — Shopify's checksum recorded after the last write, or the MD5 of the file at the base commit. Edited files are listed with the date Shopify reports, and the update needs *Replace and continue*;
   - stores the plan as a `previewed` run (valid 30 minutes).
3. **Confirm.** Every rule is checked again: the plan has not expired, the code check passed, direct edits were accepted, the Staging theme is still unpublished, the theme is still on the plan's base update, and no other run is active on the theme (enforced by the database).
4. **Backup, then apply** (Queues, or `waitUntil` with resume-on-poll). First the current version of every affected file is saved to KV for 30 days (or recorded as "did not exist"). Then files are written in batches of up to 50 — content pinned to the commit SHA and blob-verified, code-checked again, UTF-8 as `TEXT`, binaries as `BASE64` — and removed files deleted.
5. **Honest status.** Only when **every** file succeeded is `assets/theme-sync.json` written (last) and the theme's last synced update saved. Otherwise the theme keeps its previous last synced update, an incomplete Staging update cannot be published, and each failed file says whether it *can be retried* or *needs a developer fix*.

### Publishing to Live

*Publish to Live* is started from the Overview banner, the Staging result (*Publish to Live →*) or the Live theme's page (*Publish from Staging →*), and only for the update Staging fully completed (**Staging-verified**). The publish uses the same plan, checks (including "Live matches its last synced update"), backup and honest status, and is recorded in the history. Theme Sync **never changes which theme is published** in Shopify; it only updates the files of the theme you choose.

### Recovery

- **Retry failed files** — only the failed files are tried again (writes are idempotent).
- **Run full update again** — a fresh plan with fresh checks.
- **Restore backup** — puts back exactly the files the run changed, from its backup (files it created are removed), and restores the theme's previous last synced update. Allowed for the most recent run on a theme, within 30 days.
- **Go back** — return Staging or Live to any earlier update; every change after it is undone with the same review, checks and backup. Live can only go back to updates that were verified on Staging or ran on that theme before.

### Rolling out across stores

Set `STORE_GROUP` to the stores' `*.myshopify.com` domains and install the app on each. From any store in the group, *Roll out* shows where each store stands (Staging up to date / updating / incomplete; Live published / ready to publish), checks the selected stores (each with its own settings, tokens and Staging theme) and updates their **Staging** themes. Live is always published from each store's own Theme Sync, one store at a time.

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

Then paste it in **Settings → Master repository**. Alternatively set one `GITHUB_TOKEN` Worker secret with read access to the master repository; stores without their own token use it. The app verifies it with `GET /user`, and with `GET /repos/{o}/{r}` plus a commits read when you enter a repository. Classic tokens (`ghp_…`, `repo` scope) also work but grant much more access. GitHub returns `404` for private repositories the token can't see, so the app checks access explicitly and never assumes it.

The GitHub client is modular (`worker/lib/github-client.ts`), so you can add a GitHub App installation token later by adding an `auth_type` and a token provider.

---

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
| `SHOPIFY_API_KEY` (client ID) | `.dev.vars` locally; Worker secret in prod | Public value, but kept out of `[vars]` to avoid a var/secret name clash. Injected into `index.html` at serve time. |
| `SHOPIFY_API_SECRET` | `.dev.vars`; Worker secret | Verifies session tokens and HMACs, used in token requests |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_PREVIOUS` | `.dev.vars`; Worker secrets | 32-byte base64 AES key / rotation key |
| `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES`, `SHOPIFY_APP_URL`, `GITHUB_API_BASE_URL`, `LOG_LEVEL`, `APP_ENV` | `wrangler.toml [vars]` | Non-secret. `.dev.vars` can override them locally. |
| `MASTER_REPOSITORY`, `MASTER_BRANCH` | `wrangler.toml [vars]` (optional) | Default master repository/branch for stores that have not chosen one |
| `STORE_GROUP` | `wrangler.toml [vars]` (optional) | Comma-separated store domains of the collection; enables the store selector and roll-out. Staff of any listed store can see the others and update their **Staging** themes. |
| `GITHUB_TOKEN` | Worker secret (optional) | Shared read-only GitHub token for stores without their own |
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

Status codes: `400` validation, `401` session (with `X-Shopify-Retry-Invalid-Session-Request: 1`) or re-auth, `403` permission, `404` not found or another shop's resource, `409` conflict/state, `410` review expired or backup unavailable, `422` blocked by checks (`CODE_ERRORS`, `DIRECT_EDITS_FOUND`, `NOT_VERIFIED_ON_STAGING`), `429` rate limited (with `Retry-After`), `502`/`504` upstream.

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/health` | – | `{ status: "ok", time }` |
| `GET /api/overview` | `?refresh=1` | Store, repository, Staging/Live state (last synced update, waiting, active/last run), publishable update |
| `GET /api/stores` | – | Stores of the group (or just this one) with Admin URLs |
| `GET /api/settings` | – | `{ shop, settings, masterRepository }` |
| `PUT /api/settings` | `{ repository?, branch?, stagingThemeId?, liveThemeId?, preferences?: { themeRoot?, protectedPatterns?, ignorePatterns? } }` | `{ shop, settings }` (repository/branch verified on GitHub, themes in this store) |
| `POST /api/settings/test` | – | `{ github, shopify, themeWrites }` — changes nothing |
| `GET/POST/DELETE /api/github/connection` | `{ token }` | `{ connected, connection, usingSharedToken }` (never the token) |
| `GET /api/github/branches` | `?repository&page&perPage` | `Paginated<GithubBranch>` |
| `GET /api/themes` | `?refresh=1` | `ShopifyTheme[]` |
| `GET /api/themes/overview` | `?refresh=1` | Every theme with its line and last synced update |
| `GET /api/themes/:id` | – | One theme (numeric ID or GID) with its last synced update and runs |
| `GET /api/commits/:sha/files` | `?page&perPage` | Files of one commit with their theme paths |
| `GET /api/updates` | `?line=staging\|live&themeId&branch&ref=branch\|current&page&perPage` | Updates with `new`/`current`/`older`, counts, waiting |
| `POST /api/updates/plan` | `{ kind: "update"\|"publish"\|"rollback", targetSha, themeId?, line?, branch? }` | `201 UpdateRun` (checks + review) |
| `POST /api/updates/baseline` | `{ line, sha }` | `201 UpdateRun` — records the update a theme already runs |
| `GET /api/updates/publish-options` | – | Staging-verified update and Live theme choices |
| `GET /api/updates/:id` | – | `UpdateRunDetail` (run + files); resumes stalled runs without Queues |
| `POST /api/updates/:id/confirm` | `{ acceptDirectEdits? }` | `202 UpdateRun` |
| `POST /api/updates/:id/retry` · `/rerun` · `/restore` · `/cancel` | – | Retry failed files · new plan · restore plan · cancel a plan |
| `GET /api/history` | `?page&perPage&line&themeId&status` | `Paginated<UpdateRun>` (confirmed runs) |
| `GET /api/rollout` | `?sha` | Group stores' Staging/Live state for an update |
| `POST /api/rollout/preview` | `{ sha, shops }` | Per-store plans (nothing changes) |
| `POST /api/rollout/confirm` | `{ runs: [{ shopDomain, runId, acceptDirectEdits? }] }` | Per-store result |

## Limits and known constraints

- **Theme writes need Shopify's exemption** in addition to `write_themes` (see above).
- **What changes is computed from repository trees**, so per-commit file limits (3000 files) and merge commits do not affect what is applied. If GitHub truncates a tree (more than 100k entries or 7 MB), set the theme folder. Per-commit file lists in the review show at most 40 included updates.
- **Code check** covers up to 150 files while planning; the rest are checked as they are applied (a failing file stops there and is marked *needs developer fix*).
- **Backups** are kept in KV for 30 days.
- **The Contents API** raw media type supports files up to 100 MB. The app caps synced files at 10 MB.
- **D1** allows 100 bound parameters per statement, so inserts are chunked. Very large plans (5000+ files) are rejected with guidance to narrow them.
- **Worker limits.** One request never processes an unbounded sync: work runs in chunks via Queues, or via the `waitUntil` fallback with resume-on-poll.
- **KV is eventually consistent.** It only caches immutable data (commit files by SHA) or data that may be briefly stale (theme list, 60 s). Writes always re-read the theme from Shopify.
- **No automatic publishing**, no theme switching, and no writes outside the reviewed plan.
- **Who approved an update is not tracked**; the history shows date, store, theme, update and status.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI says *Open this app from Shopify Admin* | Open it through the store admin. App Bridge only works embedded. |
| `401` loops on every request | `SHOPIFY_API_KEY`/`SECRET` in `.dev.vars` or the Worker secrets don't match the app's client credentials |
| `THEME_WRITE_NOT_PERMITTED` | The theme-file exemption isn't approved yet, or `write_themes` hasn't been granted |
| `SHOPIFY_REAUTH_REQUIRED` on a background update | Open the app once (token exchange re-authorizes), then press **Retry failed files** |
| `GITHUB_NOT_FOUND` for a repo you can see in the browser | The token isn't granted that repository. Fine-grained tokens must list it explicitly. |
| `GITHUB_RATE_LIMITED` | Wait for `retryAfter`. Background syncs back off and resume automatically. |
| Update stuck in *Queued* without Queues | Keep the update page open. Polling resumes stalled runs. |
| *Test connection* says theme updates are not allowed | Shopify has not approved the theme-modification exemption for this app yet |
| `DIRECT_EDITS_FOUND` | Files were edited in Shopify since the last sync: choose *Replace and continue*, or ask the developer to bring the change into the repository |
| `NOT_VERIFIED_ON_STAGING` | Update Staging to that update first; only fully completed Staging updates can be published |
| `wrangler dev` requests hang behind a corporate proxy | Start it with `HTTPS_PROXY`/`HTTP_PROXY` unset for the local server |
