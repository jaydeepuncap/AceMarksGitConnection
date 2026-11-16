# Ace Marks Git Connection — QA Test Cases

Manual test cases for the embedded Shopify app. Each case has an ID, what to do, and the expected result.
Mark each case **Pass / Fail / Blocked** and note the build or commit tested.

## 0. Setup before testing

| Item | What you need |
|---|---|
| Store | A development store with the app installed from the Partner dashboard. |
| Themes | At least 4 themes: 1 **Live**, 3 unpublished (e.g. `Dawn`, `Copy of Dawn`, `Horizon`). |
| GitHub account A | Owns a theme repository (e.g. `A/theme-repo`) with branches `main`, `staging`, `dev`, at least 6 commits on `main`, including a commit that deletes a file and one with `config/settings_data.json`. |
| GitHub account B | A second account with its own repository (used for account-switch tests). |
| Tokens | A fine-grained token for A (Contents + Metadata read-only on the repo), a classic token for A, an expired or revoked token, a token for B. |
| Database | Migrations applied: `npm run db:migrate:remote` (includes `0003`, `0004`, `0005`). |
| Browsers | Chrome (desktop), Safari, and a mobile-width window (≈ 390 px). |

Navigation in the app: **Dashboard · Theme mapping · Themes · Sync history · Settings**.

---

## 1. Install, authentication and navigation

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| NAV-01 | Open inside Admin | Open the app from Shopify Admin → Apps. | Dashboard loads inside Admin; left nav shows the 5 pages. |
| NAV-02 | Open outside Admin | Open the app URL directly in a new tab. | "Open this app from Shopify Admin" warning; no data shown. |
| NAV-03 | Nav links | Click each nav item. | Each page opens without a full reload; the active item is highlighted. |
| NAV-04 | Old links | Visit `/commits`, `/commits?branch=main`, `/repositories`, `/repositories/x/y`. | `/commits…` opens the matching mapping (or Theme mapping); `/repositories…` opens Settings. |
| NAV-05 | Unknown route | Visit `/does-not-exist`. | Dashboard is shown. |
| NAV-06 | Back/breadcrumb | Open a mapping, click the back arrow / "Theme mapping" breadcrumb. | Returns to Theme mapping. |
| NAV-07 | Footer | Scroll to the bottom of any page. | "If you need any help, please Contact us" footer is shown. |
| NAV-08 | Session expiry | Leave the app open > 1 hour, then click Refresh. | Request re-authenticates silently, or a clear "reload the app" message; no raw error. |

## 2. GitHub connection (Settings → GitHub connection)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| GH-01 | Connect with valid fine-grained token | Paste token A, leave repository empty, click **Connect**. | Toast "GitHub connected as A"; badge **Connected**; account, "fine-grained token", verified date and expiry shown. |
| GH-02 | Connect with classic token | Use the classic token. | Connected; type shown as classic token. |
| GH-03 | Connect with repository | Paste token and `A/theme-repo`, Connect. | Connected and the repository is selected in the Repository section. |
| GH-04 | Invalid token | Enter `abc`. | Inline validation error; no request sent. |
| GH-05 | Revoked/expired token | Paste a revoked token. | Error "GitHub rejected this token…"; still not connected. |
| GH-06 | Repository the token cannot read | Token A + `B/private-repo`. | Error explaining access is denied; nothing saved. |
| GH-07 | Token never shown again | After connecting, reload Settings. | Token field is empty; the token is not visible anywhere (also check the network responses). |
| GH-08 | Replace token, same account | While connected, paste a new token for A, **Update connection**. | Still connected as A; repository and mappings unchanged; no "Started fresh" note. |
| GH-09 | Disconnect | Click **Disconnect** → confirm in the modal. | Toast "GitHub disconnected"; badge **Not connected**. Modal closes with Cancel, Esc and backdrop click too. |
| GH-10 | Connect another account | Connected as A with a repository and 2 mappings → Update connection with token B. | Toast "connected as B"; info banner "Started fresh for the new account" naming A, the repository and "2 mapping(s)"; repository is empty; Theme mapping shows no mappings. |
| GH-11 | Reconnect same account after disconnect | Disconnect A, connect A again. | Repository and mappings are kept. |
| GH-12 | Account switched before this feature | (Data set up before migration 0005, connected as B with A's repository.) Open any page. | Repository selection cleared and A's mappings removed automatically. |
| GH-13 | Repository list follows the account | Switch from A to B. | Repository dropdown lists B's repositories only. |
| GH-14 | History kept after reset | After GH-10, open Sync history. | Old syncs are still listed. |

## 3. Settings — repository and ignore files

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| SET-01 | Choose repository | Pick `A/theme-repo`, click **Save** (header). | Toast "Settings saved"; info row shows repository, Public/Private, Read & write/Read only, default branch, "View on GitHub". |
| SET-02 | No branch choice | Look at the Repository section. | Only a Repository dropdown — no Branch field, no Theme root folder field. |
| SET-03 | Not connected | Disconnect, open Settings. | Repository dropdown disabled with "Connect GitHub first." |
| SET-04 | Change repository warning | Select a different repository (do not save). | Warning: mappings of the current repository are removed when you save; history kept. |
| SET-05 | Change repository | Save the new repository. | Old repository's mappings disappear from Theme mapping; history remains. |
| SET-06 | Map again keeps progress | Switch back to the old repository, map the same branch → same theme. | Mapping page shows the theme's previous "Theme is on" commit (continues where it left off). |
| SET-07 | Add ignore pattern (file) | Add `config/settings_data.json`, Save. | Pattern listed with "Only the file config/settings_data.json". |
| SET-08 | Folder pattern | Add `locales/` and `assets` (bare folder). | Described as everything inside the folder. |
| SET-09 | Glob patterns | Add `templates/*.json` and `sections/**`. | Accepted with correct description. |
| SET-10 | Invalid pattern | Add `../x`, `/abs`, or an empty value. | Inline error; Save disabled while invalid. |
| SET-11 | Duplicate pattern | Add the same pattern twice. | Rejected or flagged as duplicate. |
| SET-12 | Remove pattern | Click **Remove** on a pattern, Save. | Pattern no longer applied. |
| SET-13 | Check matching files | Click **Check matching files**. | Lists the repository files each pattern matches (counts per pattern). |
| SET-14 | Unsaved changes | Change a pattern and leave the page. | Changes are not saved (or a save prompt appears) — confirm current behaviour is clear. |

## 4. Dashboard

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| DB-01 | Fresh install | New store, nothing set up. | "Get set up" checklist 0 of 4; header button **Connect GitHub**; only step 1's button is primary. |
| DB-02 | Checklist progress | Complete each step (connect, repository, mapping, first sync). | Steps tick to **Done**, progress bar and "N of 4 done" update; checklist disappears at 4/4. |
| DB-03 | Header action | Not connected → no repository → set up. | Button reads Connect GitHub → Choose repository → Theme mapping. |
| DB-04 | Tiles | With mappings and syncs. | Tiles with icon + heading: Theme mappings (count), Store themes (count, "N can be synced"), Last sync (status + time), Needs attention (failed in last 5). |
| DB-05 | Needs attention | Make a sync fail. | Needs attention shows 1 with a warning icon. |
| DB-06 | Your mappings | With 1–3 mappings. | Same clickable cards as Theme mapping with status; >3 shows "View all N mappings". |
| DB-07 | Connections | Check the card. | Store (Connected, read/write themes), GitHub (Connected, "Signed in as A"), Repository (Selected + Change). |
| DB-08 | Recent syncs | With syncs. | Up to 5 rows: commit + message, branch → theme, type, status, time, View. |
| DB-09 | GitHub disconnected | Disconnect. | Warning banner "GitHub is not connected"; mappings listed as **Paused** (no status, no "Not synced yet", no Start full sync, no Manage); Repository row **Paused**, no Change button; GitHub row has no extra Connect button. |
| DB-10 | Refresh | Click Refresh. | Data reloads. |

## 5. Theme mapping (list and add)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| MAP-01 | Not connected / no repository | Open Theme mapping. | "Connect a repository first" with Open settings. |
| MAP-02 | First mapping | No mappings yet. | "Map your first branch" card with Add mapping. |
| MAP-03 | Add mapping modal | Click **Add mapping** (header). | Modal "Add a mapping" with Branch and Shopify theme selects; footer buttons **Add mapping** (primary) and **Cancel**. |
| MAP-04 | Free/blocked options | Open the selects. | Mapped branches show "— mapped to <theme>" and are disabled; mapped themes "— mapped to <branch>"; non-writable themes "— cannot be synced"; counts "N of M free". |
| MAP-05 | Create | Choose `main` + `Copy of Dawn`, Add mapping. | Toast "main → Copy of Dawn added"; modal closes; card appears. |
| MAP-06 | Multiple mappings | Add `staging` → `Horizon`. | Both cards listed; "Mappings (2)". |
| MAP-07 | Cancel / close | Open modal, choose values, Cancel (also Esc, backdrop). | Modal closes; choices cleared next time. |
| MAP-08 | Everything mapped | Map every branch (or every syncable theme). | Header **Add mapping** disabled; info banner explains why ("Every branch is mapped…" / "Every theme is mapped…"). |
| MAP-09 | One theme per branch | Via API or two tabs: map `main` to a second theme. | Error "main branch is already mapped to …"; nothing created. |
| MAP-10 | One branch per theme | Map `dev` to a theme already mapped. | Error "already mapped to the main branch". |
| MAP-11 | Card click | Click anywhere on a card. | Opens the mapping page (pointer cursor on the whole card). |
| MAP-12 | Card status | Compare cards. | Badge: Up to date / N updates waiting / Not synced yet / Sync failed; footer shows next step + chevron. |
| MAP-13 | Duplicated theme card | Map a branch to a theme duplicated from a synced theme. | "Theme is on <sha>" and "Not synced from this app yet · recorded from the theme file <date>". |
| MAP-14 | Branch deleted in GitHub | Delete a mapped branch on GitHub, open Theme mapping. | Card shows an error/status that the branch can't be read; no crash. |
| MAP-15 | Theme deleted in Shopify | Delete a mapped theme, reload. | Card shows "Theme deleted" badge. |

## 6. Mapping page

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| MP-01 | Header | Open a mapping. | Title "branch → theme", repository subtitle, top actions **Change theme**, **Remove mapping** (red), **Refresh**. |
| MP-02 | Summary | Look at the summary card. | Branch → theme title with role badge and status; plain (not gray) section with **Theme is on**, **New on <branch>** ("N commits not in the theme yet"), **Last sync** (badge, type · date). |
| MP-03 | Next step — updates | New commits exist. | Primary button "Review N updates" → review modal with all commits since the last sync up to the branch head. |
| MP-04 | Next step — never synced | New mapping. | "Start with a full sync" → switches to the Full sync tab. |
| MP-05 | Next step — failed | Last sync failed. | "Open the failed sync" → Sync history detail. |
| MP-06 | Up to date | Nothing new. | "Nothing to sync" with a check icon. |
| MP-07 | Live theme note | Mapping to the live theme. | Caution text: syncs change the storefront and you confirm twice. |
| MP-08 | Change theme | **Change theme** → choose a free theme → **Sync to <theme>**. | Toast "<branch> now syncs to <theme>"; page shows the new mapping (never "Mapping not found"); old theme keeps its history. |
| MP-09 | Change theme options | Open the select. | Mapped/unwritable themes disabled with reason; "N theme(s) available". |
| MP-10 | Remove mapping | **Remove mapping** → confirm (red button in modal footer). | Toast "<branch> is no longer mapped"; returns to Theme mapping; history kept. |
| MP-11 | Re-map keeps last sync | main→abc sync; change to xyz, sync; change back to abc. | abc shows its own last synced commit (not xyz's), offers only commits after it. |
| MP-12 | Deleted mapping URL | Open the URL of a removed mapping. | "This mapping no longer exists" with Back to theme mapping. |
| MP-13 | Theme deleted | Delete the theme in Shopify, open the mapping. | Critical banner "The theme no longer exists"; sync buttons disabled. |
| MP-14 | GitHub disconnected | Disconnect, open the mapping. | Warning banner "GitHub is not connected… paused" with Connect GitHub; next-step button hidden. |
| MP-15 | Tabs | Click Commits / Full sync / History. | Each tab shows its content; History lists only syncs of this branch to this theme. |

## 7. Commit sync (Commits tab)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| CS-01 | Commit list | Open the Commits tab. | Table: checkbox, commit (message, sha link, author, date), **Changed files** button ("N files"), status badge; legend New / Last synced / Added; pagination 20 per page. |
| CS-02 | Up to date banner | Theme has every commit. | Green "All commits are in the theme" banner. |
| CS-03 | No "When you select one commit" choice | Look above the table. | Only the "Also delete files the commits removed" checkbox. |
| CS-04 | One new commit | Tick one **New** commit → **Review sync**. | Review includes that commit **and all earlier commits not yet in the theme** ("+ N earlier commits" note shown next to the button). |
| CS-05 | Re-apply an added commit | Tick an **Added** or **Last synced** commit. | Info banner "<sha> is already in the theme… only the files <sha> changed are synced again"; review lists only that commit's files; newer commits not undone. |
| CS-06 | Several commits | Tick 3 commits. | Button "Review 3 commits"; banner "3 commits will be combined" with removable chips; newest version of a file wins. |
| CS-07 | Gap warning | Tick commits with unselected commits in between. | Warning banner: N commits in between not selected; conflicts listed in the review. |
| CS-08 | Remove chip | Remove a commit via its chip ✕. | Selection count and checkbox update. |
| CS-09 | Select new / all / clear | Use the toolbar buttons. | Correct commits ticked; counts correct; Clear empties the selection. |
| CS-10 | Checkbox stays in sync | Click checkboxes quickly, on and off, across pages. | Ticked boxes always match "N selected" (no box ticked that is not counted). |
| CS-11 | Files modal | Click "N files" on any row. | Modal "Files changed in <sha>": commit details, table of change type, file, theme path (or "Not synced: reason"), lines; Close button. Selection unchanged. |
| CS-12 | Large commit | Open files of a commit with >3000 files. | "Large commit" warning suggesting a full sync. |
| CS-13 | Non-theme files | Commit touching `README.md`. | Shown as "Not synced: …" in the files modal and skipped in the review. |
| CS-14 | Delete files checkbox | Tick "Also delete files…" with a commit that removed a file. | Review lists the deletion; without the tick, the file is skipped. |
| CS-15 | Ignored files | Commit changing `config/settings_data.json` (ignored). | Review shows the file with **Ignored** badge; never written. |
| CS-16 | Pagination | Go to page 2 and back. | Commits and statuses correct; selections from page 1 kept. |

## 8. Review modal (before any sync)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| RV-01 | Layout | Open any review. | Modal "Review before updating": summary, single **Files (N)** table (action badge, theme file, details/source commit), **Show skipped files** checkbox; footer **Cancel** and **Confirm & Sync**. |
| RV-02 | Skipped files | Toggle "Show skipped files". | Skipped (unchanged/non-theme) files appear/disappear; ignored files always visible. |
| RV-03 | Cancel | Click Cancel / Esc / backdrop. | Modal closes; nothing written to the theme. |
| RV-04 | Live theme confirm | Review for the live theme. | Must tick the checkbox **and** type the exact theme name before Confirm is enabled. |
| RV-05 | Wrong name | Type a different name. | Confirm stays disabled. |
| RV-06 | Direct edits warning | Edit a file in the Shopify code editor, then review a sync touching it. | Warning that files were edited in Shopify; must accept to continue. |
| RV-07 | Code check failure | Commit with invalid Liquid/JSON. | Confirm blocked with the failing file listed. |
| RV-08 | Expired preview | Open a review, wait 30+ minutes, confirm. | "Preview expired" warning; asked to review again. |
| RV-09 | Already up to date | Preview with nothing new. | Info notice "Already up to date" (not a red error). |

## 9. Full sync

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| FS-01 | First full sync | Full sync tab → **Review full sync** → confirm. | All theme files from the branch head written; identical files skipped; ignored files untouched. |
| FS-02 | Delete option off | Theme has files not in Git, checkbox off. | Those files are kept. |
| FS-03 | Delete option on | Tick "Delete theme files that are not in the repository". | Review lists each deletion; protected and ignored files never deleted. |
| FS-04 | Second full sync | Run again without changes. | Nothing to write (all skipped as identical). |
| FS-05 | Theme root | Repository with theme in a subfolder (if root configured). | Paths map correctly. |

## 10. Sync progress, history, retry and restore

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| SH-01 | Live progress | Start a sync of ~50 files. | Progress bar and "% · N updated" update while running; text says each file is backed up first; you can leave the page. |
| SH-02 | Success | Wait to finish. | Status **Succeeded**; counts of succeeded/skipped/ignored/planned. |
| SH-03 | theme-sync.json | After success, open `assets/theme-sync.json` in the theme. | Contains last synced commit, and a per-branch entry for this branch; written last. |
| SH-04 | List | Open Sync history. | Columns: Commits, Repository · branch → theme, Type, Status, Started, Completed, Details (no Files column). |
| SH-05 | Filters | Filter by Theme, Branch, Sync type, Status; then Clear filters. | List filters correctly; no From/To date fields. |
| SH-06 | Pagination | More than one page of syncs. | Next/previous work. |
| SH-07 | Partial failure | Make some files fail (e.g. invalid file for Shopify). | Status **Partially failed**; failed files with plain reasons (temporary / code / changed / other). |
| SH-08 | Retry failed files | Click **Retry Failed Files** → confirm. | Only failed files retried. |
| SH-09 | Run full update again | Click **Run full update again**. | New review opens for the same commit/strategy. |
| SH-10 | Restore backup | Click **Restore backup** → confirm. | Theme restored exactly as before the update; banner shows restored file count and time; second restore not possible. |
| SH-11 | Live theme actions | Retry/restore on the live theme. | Must type the theme name in the confirm modal. |
| SH-12 | Concurrent sync | Start a sync while one runs for the same theme. | Blocked with a clear message. |

## 11. Themes page

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| TH-01 | List | Open Themes. | Every theme: name + ID, role badge, **Receives** (branch), **Theme is on** (commit, branch, date), action. |
| TH-02 | Open mapping | Click **Open mapping** on a mapped theme. | Mapping page opens. |
| TH-03 | Map a branch | Click **Map a branch** on a free theme. | Theme mapping opens with the Add mapping modal and that theme preselected. |
| TH-04 | Not syncable | Theme that cannot be written. | "Cannot be synced"; no action. |
| TH-05 | Disconnected | Disconnect GitHub, open Themes. | Warning banner with Connect GitHub; Receives shows "GitHub not connected"; no Open/Map actions. |
| TH-06 | No repository | Connected but no repository. | "No repository selected" banner with Choose repository. |
| TH-07 | Missing write scope | Install without `write_themes`. | Warning "Theme write access not granted". |
| TH-08 | Duplicated theme | Duplicate a synced theme in Shopify, refresh. | The copy shows the same "Theme is on" commit (from theme-sync.json). |

## 12. Errors, permissions, security and edge cases

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| ER-01 | GitHub rate limit | Exhaust the rate limit (or simulate). | Warning "GitHub is busy"; retry later. |
| ER-02 | Shopify throttling | Large sync. | Sync slows but completes; no lost files. |
| ER-03 | Network error | Go offline, click Refresh. | Error banner with **Try again**; request ID shown for real errors. |
| ER-04 | Error dismiss | Dismiss a dismissible error banner. | Banner closes. |
| ER-05 | Shop isolation | Two stores using the app. | Each sees only its own settings, mappings and history. |
| ER-06 | Token storage | Inspect API responses and logs. | GitHub token never returned or logged. |
| ER-07 | Theme write exemption | Store without theme-modification approval. | Clear message about the required exemption. |
| ER-08 | Uninstall/reinstall | Uninstall, reinstall. | App works; old data handled as designed. |
| ER-09 | Mobile width | Use each page at ≈ 390 px. | No horizontal scroll; tables switch to list layout; modals usable. |
| ER-10 | Keyboard | Tab through a page and a modal. | All controls reachable; Esc closes modals; focus visible. |

## 13. Automated tests and release checklist

| ID | Check | Command | Expected |
|---|---|---|---|
| AT-01 | Unit/integration tests | `npx vitest run` | All tests pass (171 at the time of writing). |
| AT-02 | Type check | `npx tsc --noEmit -p .` | No errors. |
| AT-03 | Lint | `npx eslint app test worker` | No errors. |
| AT-04 | Build | `npm run build` | Build succeeds. |
| AT-05 | Migrations | `npm run db:migrate:remote` | 0003, 0004 and 0005 applied before deploying. |
| AT-06 | Smoke test after deploy | Run NAV-01, GH-01, MAP-05, CS-04, SH-02 on the deployed app. | All pass. |
