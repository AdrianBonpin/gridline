# Gridline Roadmap

Status legend: ✅ Shipped · 🏗️ In development · 🎯 Next up · 📋 In the queue · 🔮 Planned

This file is the **source of truth** for what Gridline is building. [AGENTS.md](./AGENTS.md) and [README.md](./README.md) link here — keep this current as priorities shift.

---

## ✅ Shipped (0.8.0)

- **Schema diff / compare** — same-engine structural diff (PG↔PG, MySQL-family↔MySQL-family, SQLite↔SQLite) with per-object sync SQL; non-destructive items stage through the changes queue, destructive items are copy-only. Target = current connection; source = any saved same-family connection.
- **Query Workbench: multiple result sets** — stacked result panels per statement with DML/DDL affected-count notices and stop-at-first-error *(deferred from 0.7.0)*
- **Query Workbench: result streaming to file** — full-result CSV/JSONL/JSON export with progress + cancel, constant memory (PG cursor fetch, MySQL/SQLite native streams)
- **MariaDB support** — first-class `db_type` reusing the MySQL driver path; provider card, filter, URI schemes, backup via the already-bundled mariadb tools
- **TimescaleDB support** — runtime extension detection; hypertables in the Objects view (dimensions, compression, chunks, size), read-only
- **PlanetScale preset** — managed MySQL (Vitess) provider card + setup guide + `.psdb.cloud` host detection; persists as `db_type: mysql`
- **Version bump** 0.7.15 → **0.8.0**.

## 📋 In the queue

### Full Redis Support

Connection + test only today — browsing stays gated behind a clean "unsupported" state. Goal: first-class Redis like the PG/SQLite/MySQL viewers.

- Key browser (pattern search, filter by type, TTL display, key count)
- Value editors per type: string, list, hash, set, zset, stream, JSON
- Inline add / edit / delete keys, TTL management, flush
- Key expiry tracking and live refresh

### Additional Database Types

MariaDB and TimescaleDB moved to [0.8.0](#-next-up-080). Remaining candidates: CockroachDB, DuckDB, SQL Server, MongoDB (drivers are heavier lifts — revisit with demand).

### Managed Database Support (beyond Supabase / Neon)

Supabase and NeonDB presets shipped in v0.7.0; PlanetScale moved to [0.8.0](#-next-up-080). Remaining:

- **Turso** (libSQL — not SQLite over the wire; needs a `libsql` driver path in the Rust backend, not just a connection preset)
- Provider detection guidance: paste a provider URL → Gridline auto-fills host/port/SSL mode; provider "connect" docs linked from the connection form

### Query Workbench Upgrades

Multiple result sets and result streaming to file moved to [0.8.0](#-next-up-080). Remaining:

- **Visual query builder** — drag-and-drop tables/joins/filters that generate SQL (TablePlus has one; DB Pro plans one)

### Schema & Data Tooling

Schema diff / compare moved to [0.8.0](#-next-up-080). Remaining:

- **MySQL Objects view + schema visualizer** — functions/triggers/sequences/enums/extensions browsing and ER diagram for MySQL *(PostgreSQL-only today)*
- **More export formats** — JSONL, Parquet alongside CSV/JSON/SQL/Markdown/Excel

## 🔮 Planned

### AI Integration (BYOK)

Bring-your-own-key — no bundled model, no paywall, key stored in the OS keychain like DB passwords.

- Natural-language → SQL generation (schema-aware)
- Chat with your database (explain query results, error messages)
- Query explanations and schema summaries
- AI-generated charts from result sets
- Privacy-first: only the SQL/text you choose is sent to your provider; write-queries blocked by default, destructive actions confirmed before execution

### Website & Docs

The marketing site (`www/`, Astro) is live: landing page with screenshots, FAQ, and a changelog feed. Remaining:

- User documentation (connection setup, SSH/TLS, backup/sync, changes queue)

### UI/UX Improvements (rolling)

Continuous polish, tracked as issues rather than one-off milestones:

- Empty states, error surfacing, and microcopy
- Keyboard shortcut audit + more configurable actions
- Performance passes on the grid, object tree, and large schemas
- Accessibility (contrast, focus states, screen-reader labels)
- Session restore — reopen tabs and query state from the last session
- Light-theme parity pass — dark is first-class; polish the light theme to match

Still deferred from 0.7.0, slated for this bucket:

- **Onboarding tour** — first-run walkthrough built around the Gridline Demo database; contextual tooltips per screen
- **SSH key management** — read/generate key pairs and paste private keys directly in the SSH tab (today: path inputs only)
- **In-app changelog** — "What's new" panel fed from bundled release notes

---

## ✅ Shipped (0.7.10)

- **Copy connection URL** — from a connection card's ⋮ menu, copy the connection string for use in env vars / other tools: **Copy connection URL** (includes the password, fetched from the OS keychain on demand) and **Copy connection URL (no password)** (safe to share). Builds `postgresql://` / `mysql://` / `sqlite://` / `redis://` strings with percent-encoded credentials and the PG `sslmode` appended.
- **Version bump** 0.7.9 → **0.7.10**.

## ✅ Shipped (0.7.15)

- **Insert Row** — adds an editable pending row at the top of the data grid (visible accent outline); committing inserts only the filled columns so serial/identity/generated defaults apply
- **Smart cell editors** — date/time/datetime pickers, a boolean select, and number inputs for the matching column types (enums and FKs already had dropdowns), applied to both new rows and inline editing
- **Landing page support channel** — coffee via Ko-fi (ko-fi.com/adrianbonpin), always optional, never gates a feature
- **Landing page copy refresh** — em dashes dropped, OSS section simplified, FAQ added for how the project is funded
- **Version bump** 0.7.14 → **0.7.15**.

## ✅ Shipped (0.7.14)

- **No more repeated macOS keychain prompts** — saved connection passwords and SSH secrets are ACL-pinned to the app's code signature when stored, so app upgrades never re-trigger the macOS keychain access dialog (users upgrading from older builds see one final prompt — choose Always Allow)
- **Install via Homebrew** — add the Gitea tap (`brew tap AdrianBonpin/gridline https://git.ranio.xyz/adrianbonpin/homebrew-gridline.git`) and run `brew install --cask gridline`
- **Version bump** 0.7.13 → **0.7.14**.

## ✅ Shipped (0.7.13)

- **Developer-ID signed + notarized macOS** — the app is properly code-signed with a Developer ID Application certificate and notarized by Apple, so macOS opens it without the Gatekeeper "Open Anyway" prompt or the `xattr` quarantine workaround
- **Version bump** 0.7.12 → **0.7.13**.

## ✅ Shipped (0.7.12) *(includes 0.7.11: release-pipeline/docs refresh — README download links moved from GitHub to the self-hosted Gitea `git.ranio.xyz`)*

- **Reliable cell editing for non-text columns** — editing a PostgreSQL cell whose type isn't text (integers, booleans, UUIDs, json/jsonb, timestamps, enums, numerics) now works; edited values are sent to PostgreSQL in text wire format so the server parses them into the column's own type
- **Recent connections fix** — the Recent strip no longer renders empty on first launch when the connections list hadn't loaded yet
- **Full CI release pipeline for Windows** — the self-hosted Windows runner now builds the .exe/.msi installers (bundled pg_dump/pg_restore/psql + MariaDB clients) and uploads them to the release alongside Linux
- **Version bump** 0.7.11 → **0.7.12**.

## ✅ Shipped (0.7.9)

- **macOS Finder launch fix** — the local store opens under the OS app-data directory instead of a cwd-relative `gridline.db` (Finder/LaunchServices launches run with cwd `/`, so the old path made the app silently exit with a Rust panic before the UI started).
- **macOS ad-hoc code signing** — bundles are signed at build time (`bundle.macOS.signingIdentity "-"`, hardened runtime off), replacing the Xcode linker-only signature that macOS treated as unsigned ("damaged and can't be opened", silent Finder refusal). Users still get a one-time Gatekeeper prompt; README documents the `sudo xattr -dr com.apple.quarantine` workaround.
- **Vendored OpenSSL for `ssh2`** — the release binary no longer links an absolute Homebrew `/opt/homebrew/.../libssl.3.dylib` path (dyld aborted on machines without it).
- **Version bump** 0.7.8 → **0.7.9**.

## ✅ Shipped (0.7.8)

- **SQLite `.dump` support** — backup a SQLite database to a portable SQL dump and restore it back, matching the pg_dump UX
- **Backup / Restore / Sync for MySQL & SQLite** — the pg-only tooling extended: MySQL backup/restore via `mysqldump` (system-first) and DB-to-DB sync beyond PostgreSQL
- **Excel (.xlsx) export** — alongside CSV/JSON/SQL/Markdown in the grid export toolbar
- **Cancel long-running queries** — per-connection cancel button (`pg_cancel_backend` and equivalents) instead of waiting or killing the app
- **Settings export / import** — share theme, accent, editor options, page sizes, and defaults across machines (JSON file)
- **Windows/Linux title bar fix** — the macOS overlay drag strip (`h-7` in `App.tsx`) is now gated to macOS; Windows/Linux use the native title bar for dragging
- **SQLite table editor (Create/Edit Table)** — the visual Create Table / Edit Table flow extended to SQLite: SQLite-aware type mapping (`INTEGER PRIMARY KEY AUTOINCREMENT` instead of `serial`, `TEXT`/`REAL`/`BLOB`) and ALTER TABLE limits respected (`ADD COLUMN` can't add PK/UNIQUE, `DROP COLUMN` needs SQLite ≥3.35)
- **Version bump** 0.7.7 → **0.7.8**.

## ✅ Shipped (0.7.7)

### Admin follow-up

- **PostgreSQL users/roles + grants management** — create/edit/drop roles with attributes; a per-role **privilege explorer** grouped by object class (tables, sequences, routines, schemas, databases) with collapsible sections (5-entry preview + fade, expand to show all) and GRANT/REVOKE staging through the changes queue (DB Pro has this at 0% on their roadmap — a differentiator to hold)
- **Maintenance actions** — right-click table → VACUUM / ANALYZE / REINDEX

### Table & relationship management

- **Create table** — a "Create Table…" tab in the workspace using the same Visual ⇄ SQL flow as object create/edit: a columns grid (name / type / nullable / default / PK per row, type dropdowns with shorthand PG types, drag-to-reorder, add/remove rows) with a live Monaco SQL preview; multi-column PRIMARY KEY on create
- **Edit table (robust column diff)** — open an existing table's columns in the same grid; on Stage, diff old vs new columns and emit the right statements, one per queue item: `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET|DROP DEFAULT`, `SET|DROP NOT NULL`
- **FK management** — multi-column FK composer (local column → referenced column pairs, referenced PKs first, type-match preview) with cross-schema references and ON DELETE / ON UPDATE actions; inlined into CREATE TABLE in create mode, separate ALTER staging in edit mode; FK rows in the form with Edit/Remove
- **Related niceties** — column reordering via atomic table rebuild (single transaction, preserves constraints/indexes/FKs/grants/sequences, fail-closed for triggers/RLS/inheritance/partitioning), table options (tablespace, row-level security), changes queue auto-refreshes the object tree after schema-modifying commits
- **Version bump** 0.7.6 → **0.7.7**.

## ✅ Shipped (0.7.6)

- **Full Object Management (PostgreSQL)** — create/edit/drop for every PostgreSQL object type (enums, functions, procedures, triggers, sequences, extensions, views, materialized views, indexes, constraints), staged through the changes queue with generated-SQL previews.
- **Enable Keychain toggle** — wired end-to-end (default ON, opt-out): OFF = don't persist the DB password (session-only, re-prompt on connect) + purge the existing keychain entry; SSH secrets stay keychain-only.
- **Objects view tabbed workspace** — object details open as tabs in the shared tabbed workspace (per-type icons), with an inline manual query tab and the changes queue reachable from the tab bar.
- **⌘K object-search fixes** — clicking a result now switches to the Objects view / opens the table tab; arrow-key navigation + Enter to pick.
- **Version bump** 0.7.5 → **0.7.6**.

## ✅ Shipped (0.7.5)

- **Bundled PG client tools** — static `pg_dump`/`pg_restore`/`psql` ship with the app (system-first, bundled fallback) so backup/restore/sync work with no separate install.
- **Schema CRUD** — create/rename/drop schemas from the object tree; CASCADE drop with typed-name confirm + dependency warning.
- **Global object search** — Cmd+K palette in the DB viewer, current-schema scope, all object types; results open a table tab or jump to the Objects view.
- **Copy as DDL for any object** — `CREATE` DDL for every browsable type (tables via pg_dump; pg_get_*def passthrough; sequences/enums/extensions/views synthesized).
- **Object dependencies** — `pg_depend` "what depends on this?" view, shown before destructive drops (table drop, schema drop).
- **Version bump** 0.7.0 → **0.7.5**.

## ✅ Shipped (0.7.0)

- **New Connection screen revamp** — a single progressive flow: connection-string input + 2-column provider tab grid → expands into the full configuration form (label, tags/env/folder, General + SSH·SSL tabs). Removes the simple/detailed toggle.
- **Full MySQL DB viewer support** — connect (incl. SSL + SSH), browse databases/tables/columns/FKs, run queries, paginate, inline cell editing + changes queue (insert/update/delete/bulk/empty/drop), DDL copy (`SHOW CREATE TABLE`), CSV/JSON import.
- **DB viewer capability gating** — pure `dbCapabilities.ts` matrix per DB type; unsupported views show a clean "not supported" state instead of broken UI. Redis browsing explicitly gated off.
- **Supabase & NeonDB managed-PG presets** — provider cards with in-app setup instructions; persist as `postgresql` with an SSL hint.
- **SQLite file-path mode** — URI field becomes a file-path input with `Browse…`.
- **Tag overflow scroll** — connection cards show ≤3 tags, then scroll horizontally.
- **Input styling sweep** — `rounded-full` → `rounded-lg` on all form controls.
- **Version bump** 0.6.0 → **0.7.0**.

**Deferred from 0.7.0**: Redis key browsing and MySQL Objects/ERD views (still in the queue); SSH key management and onboarding tour (planned). Since shipped elsewhere: backup/restore/sync for MySQL & SQLite and settings import/export (0.7.8); multiple result sets (slated for 0.8.0).

## ✅ Shipped — earlier releases (pre-0.7.0)

- Tauri 2.0 + React 19 + TypeScript 5.8 project shell
- Connection management with URI parser, SSH tunnels, TLS, OS keychain
- PostgreSQL and SQLite browse/query support
- Workspace tree, folders, tags, favorites, recents
- Multi-tab DB viewer with virtualized grid, server-side filtering/sorting
- FK preview, JSON popover, inline cell editing, changes queue
- Query editor with Monaco, autocomplete, destructive-query guard
- Query history, saved queries, and Queries view
- Full PostgreSQL object explorer + schema visualizer
- Backup, restore, and DB-to-DB sync tools
- Settings redesign with theme, accent color, editor options
- Built-in **Gridline Demo (SQLite)** database
