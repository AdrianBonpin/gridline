# Gridline Roadmap

Status legend: ✅ Shipped · 🏗️ In development · 🎯 Next up · 📋 In the queue · 🔮 Planned

This file is the **source of truth** for what Gridline is building. [AGENTS.md](./AGENTS.md) and [README.md](./README.md) link here — keep this current as priorities shift.

---

## ✅ Shipped (0.7.7)

### Admin follow-up

- **PostgreSQL users/roles + grants management** — create roles and set privileges from a UI (DB Pro has this at 0% on their roadmap — a differentiator to hold)
- **Maintenance actions** — right-click table → VACUUM / ANALYZE / REINDEX

### Table & relationship management

- **Create table** — a "Create Table…" tab in the workspace using the same Visual ⇄ SQL flow as object create/edit: a columns grid (name / type / nullable / default / PK per row, add/remove rows) with a live SQL preview
- **Edit table (robust column diff)** — open an existing table's columns in the same grid; on Stage, diff old vs new columns and emit the right statements, one per queue item: `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET|DROP DEFAULT`, `SET|DROP NOT NULL`
- **Relationships between tables & schemas** — FK create/edit/drop from a table editor (including cross-schema FKs) and schema-level relationship maintenance
- **Related niceties** — column reordering (PG requires a table rebuild — decide semantics), table options (tablespace, row-level security), multi-column PRIMARY KEY on create

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

**Not in 0.7.0** (deferred, tracked below): Redis key browsing, MySQL Objects/ERD views, backup/restore/sync for MySQL + SQLite, multiple result sets, SSH key-file management, settings import/export, onboarding tour.

## 📋 In the queue

### Full Redis Support

Connection + test work today; **key browsing is explicitly not part of 0.7.0** — it stays gated behind an "unsupported" state. Goal: first-class Redis like the PG/SQLite/MySQL viewers.

- Key browser (pattern search, filter by type, TTL display, key count)
- Value editors per type: string, list, hash, set, zset, stream, JSON
- Inline add / edit / delete keys, TTL management, flush
- Key expiry tracking and live refresh

### Additional Database Types

- **MariaDB** (wire-compatible with MySQL — should largely fall out of the 0.7.0 MySQL work)
- **TimescaleDB** (PostgreSQL extension — largely free once PG browsing is solid; surface hypertables/compression in the object tree)
- Candidates after that: CockroachDB, DuckDB, SQL Server, MongoDB (drivers are heavier lifts — revisit with demand)

### Managed Database Support (beyond Supabase / Neon)

Supabase and NeonDB presets shipped in v0.7.0. Remaining candidates:

- **PlanetScale** (Vitess/MySQL)
- **Turso** (libSQL)
- Provider detection guidance: paste a provider URL → Gridline auto-fills host/port/SSL mode; provider "connect" docs linked from the connection form

### Query Workbench Upgrades

- **Multiple result sets** — one query, multiple result tabs (stacked/scrollable) instead of only the last result *(deferred from 0.7.0)*
- **Cancel long-running queries** — per-connection cancel button (`pg_cancel_backend` and equivalents) instead of waiting or killing the app
- **Result streaming to file** — export 500k+ rows without loading them all into memory
- **Visual query builder** — drag-and-drop tables/joins/filters that generate SQL (TablePlus has one; DB Pro plans one)

### Schema & Data Tooling

- **SQLite `.dump` support** — match the pg_dump UX for SQLite
- **Schema diff / compare** — two-database structure diff that pairs naturally with DB-to-DB sync
- **MySQL Objects view + schema visualizer** — functions/triggers/sequences/enums/extensions browsing and ER diagram for MySQL *(deferred from 0.7.0 and out of scope for the object-management release — PostgreSQL-only for now)*
- **Backup/Restore/Sync for MySQL & SQLite** — pg_dump tooling is PostgreSQL-only today *(deferred from 0.7.0)*
- **More export formats** — Excel (.xlsx), JSONL, Parquet alongside CSV/JSON/SQL/Markdown

## 🔮 Planned

### AI Integration (BYOK)

Bring-your-own-key — no bundled model, no paywall, key stored in the OS keychain like DB passwords.

- Natural-language → SQL generation (schema-aware)
- Chat with your database (explain query results, error messages)
- Query explanations and schema summaries
- AI-generated charts from result sets
- Privacy-first: only the SQL/text you choose is sent to your provider; write-queries blocked by default, destructive actions confirmed before execution

### Website & Docs

- Landing page with screenshots, feature tour, and download links
- User documentation (connection setup, SSH/TLS, backup/sync, changes queue)
- Blog / changelog feed

### UI/UX Improvements (rolling)

Continuous polish, tracked as issues rather than one-off milestones:

- Empty states, error surfacing, and microcopy
- Keyboard shortcut audit + more configurable actions
- Performance passes on the grid, object tree, and large schemas
- Accessibility (contrast, focus states, screen-reader labels)
- Session restore — reopen tabs and query state from the last session
- Light-theme parity pass — dark is first-class; polish the light theme to match

Deferred from 0.7.0, slated for this bucket:

- **Onboarding tour** — first-run walkthrough built around the Gridline Demo database; contextual tooltips per screen
- **Settings export/import** — share theme, accent, editor options, page sizes, and defaults across machines (JSON file)
- **SSH key management** — read/generate key pairs and paste private keys directly in the SSH tab (today: path inputs only)
- **In-app changelog** — "What's new" panel fed from bundled release notes

---

## ✅ Shipped

- Full PostgreSQL object management — create/edit/drop staged through the changes queue (v0.7.6)
- Enable Keychain toggle — opt-out password persistence (v0.7.6)
- Objects view tabbed workspace (v0.7.6)
- Bundled PG client tools — `pg_dump`/`pg_restore`/`psql` shipped with the app, system-first with bundled fallback (v0.7.5)
- Schema CRUD — create/rename/drop schemas with CASCADE + dependency warning (v0.7.5)
- Global object search — Cmd+K across all object types in the current schema (v0.7.5)
- Copy as DDL for any object (v0.7.5)
- Object dependencies — `pg_depend` view before destructive drops (v0.7.5)
- Tauri 2.0 + React 19 + TypeScript 5.8 project shell
- PostgreSQL and SQLite browse/query support
- Full MySQL DB viewer — connect, browse, query, edit + changes queue (v0.7.0)
- New Connection screen revamp — provider grid + Supabase/NeonDB managed-pg presets (v0.7.0)
- DB viewer capability gating + Redis unsupported state (v0.7.0)
- Connection management with URI parser, SSH tunnels, TLS, OS keychain
- Workspace tree, folders, tags, favorites, recents
- Multi-tab DB viewer with virtualized grid, server-side filtering/sorting
- FK preview, JSON popover, inline cell editing, changes queue
- Query editor with Monaco, autocomplete, destructive-query guard
- Query history, saved queries, and Queries view
- Full PostgreSQL object explorer + schema visualizer
- Backup, restore, and DB-to-DB sync tools
- Settings redesign with theme, accent color, editor options
- Built-in **Gridline Demo (SQLite)** database