# AGENTS.md

Guidance for AI coding agents working on **Gridline**.

---

## Project Identity

Gridline is an **open-source, cross-platform database GUI client** for PostgreSQL (with MySQL, SQLite, and Redis to follow). It is built as a **Tauri 2.0 desktop app** — a lightweight native shell (~40MB baseline) around a React web frontend, with a Rust backend handling all database operations, CLI tool orchestration, and local persistence.

**Core differentiators from commercial alternatives (DB Pro, TablePlus, Beekeeper Studio):**
- **Everything free, nothing paywalled** — where DB Pro caps free users at 2 connections / 3 tabs / 5 saved queries, TablePlus caps at 2 open tabs + 2 windows, and Beekeeper reserves backup/restore, file import, multi-table export, ERD, and several DB connectors (Oracle, MongoDB, ClickHouse…) for paid tiers, Gridline ships the full feature set with no limits on tabs, connections, or saved queries
- **DB-to-DB sync** — pipe-based `pg_dump` → `pg_restore` between two live connections; none of the alternatives (DB Pro, TablePlus, Beekeeper) offer direct DB-to-DB sync — they only back up to / restore from files
- **Deeper PostgreSQL object explorer** — full detail views for Functions, Triggers, Sequences, Enums, and Extensions; Beekeeper and TablePlus show tables/views/routines/triggers but no sequences, enums, or extensions (Beekeeper can't even display routine definitions — issue #329 open since 2020), while DB Pro's tree stops at tables, views, indexes, and enums

**Competitor reality check (verified 2026-05, from vendor docs/pricing/repos — keep this accurate):**
- **DB Pro** (dbpro.app): **Electron app** (founder-confirmed on HN; launched Nov 2025) — not native despite "native macOS, Windows, Linux apps" marketing copy. Free plan = 2 connections / 5 saved queries / 3 open tabs / 2 dashboards / 2 table tags; data imports + SSH tunneling are paid-only per the pricing table/FAQ, while CSV/JSON export **does work on the free tier** (paid plans advertise "unlimited exports"; FAQ inconsistently claims "unlimited local connections"). Has query folders, dashboard folders, and table tags (roadmap 100%). No backup/restore (no pg_dump/pg_restore anywhere) and no DB-to-DB sync — the "Deeper Database Management" roadmap (indexes, users, constraints, VACUUM/ANALYZE) is still 0%. Schema tree: tables, views, indexes, relationships, and enums (since v1.6.0); MSSQL also lists stored procedures — no functions, triggers, sequences, or extensions on PG. Timeline: v1.0 Nov 2025 → v1.4 MSSQL/SSH/Keychain/Neon (Jan 2026) → v1.6 Redis/enums (Feb 2026) → self-hosted Studio (Mar 2026). Marketing overclaims ("native", Neon listed before it shipped) and known bugs (strict TLS verification blocks some Supabase pooler connections).
- **Beekeeper Studio**: free Community edition = unlimited connections, no tab limits, saved queries, local folders (5.7+), staged Apply/Discard edits, basic query-result export. Paid-only: pg_dump/pg_restore backup/restore, file import, multi-table export, ERD, AI shell, JSON sidebar, cloud workspaces, and premium DB connectors (Oracle, MongoDB, ClickHouse, DuckDB…). Sidebar shows tables/views/matviews/routines/triggers — no sequences, enums, or extensions.
- **TablePlus**: free = 2 open tabs / 2 windows / 2 advanced filters, but every other feature is included (incl. pg_dump/mysqldump backup GUI). No DB-to-DB sync, no ERD, no folder hierarchy. Sidebar: tables, views, functions, procedures.

**Target audience:** Developers managing multiple database environments across projects (Personal, Work, Client). The workspace/folder hierarchy is a first-class concept.

---

## Tech Stack

| Layer | Technology | Notes |
| :--- | :--- | :--- |
| Desktop shell | Tauri 2.0 | Native webview wrapper, Rust backend |
| Frontend | React 19 + TypeScript 5.8 | Vite 7 for bundling/HMR |
| Styling | Tailwind CSS | Dark-first, glassmorphic aesthetic |
| State | Zustand or Jotai | Pick one and stay consistent per feature |
| Editor | Monaco Editor | SQL mode with custom autocomplete providers |
| Data grid | Glide Data Grid or TanStack Virtual | Virtualized, canvas-rendered |
| Backend | Rust (tokio async runtime) | Connection pools, IPC commands, shell execution |
| DB drivers | sqlx + tokio-postgres | Async, pure-Rust PostgreSQL driver |
| Local storage | SQLite via rusqlite | User settings, workspace state, query history |
| Credentials | OS keychain | macOS Keychain, Linux Secret Service, Windows Credential Manager |

---

## Project Structure

```
gridline/
├── package.json                  # Workspace root: bun workspaces ["desktop", "www"], orchestration scripts
├── desktop/                      # Tauri desktop app (React frontend + Rust backend)
│   ├── package.json              # Frontend deps + scripts (name: gridline-desktop)
│   ├── index.html
│   ├── vite.config.ts            # Vite + Tailwind v4 + Tauri dev server (port 1420)
│   ├── vitest.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── bunfig.toml               # bun test preload
│   ├── src/                      # React frontend (TypeScript)
│   │   ├── components/           # Reusable UI components
│   │   │   ├── layout/           # App shell, sidebar, tabs
│   │   │   ├── editor/           # Monaco wrapper, autocomplete
│   │   │   ├── grid/             # Data grid, filters, export
│   │   │   ├── tree/             # Workspace/object explorer tree
│   │   │   └── ui/               # Primitives (buttons, modals, inputs)
│   │   ├── stores/               # Zustand/Jotai stores
│   │   ├── hooks/                # Custom hooks (useConnection, useQuery, etc.)
│   │   ├── lib/                  # Utilities, types, Tauri bindings
│   │   │   ├── commands.ts       # Typed wrappers around Tauri invoke()
│   │   │   ├── types.ts          # Shared TypeScript interfaces
│   │   │   └── utils.ts          # Formatting, validation helpers
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css             # Tailwind directives + custom theme tokens
│   └── src-tauri/                # Rust backend
│       ├── src/
│       │   ├── main.rs           # Binary entry point
│       │   ├── lib.rs            # Tauri builder, command registration
│       │   ├── db/               # Connection pooling, query execution
│       │   │   ├── mod.rs
│       │   │   ├── pool.rs       # Connection pool manager
│       │   │   └── introspection.rs  # Schema/system catalog queries
│       │   ├── commands/         # Tauri #[tauri::command] handlers
│       │   │   ├── mod.rs
│       │   │   ├── connections.rs    # CRUD for saved connections
│       │   │   ├── query.rs      # SQL execution
│       │   │   ├── schema.rs     # Object tree introspection
│       │   │   ├── schema_graph.rs   # ER diagram / relationship graph
│       │   │   ├── backup.rs     # pg_dump / pg_restore wrappers
│       │   │   └── workspace.rs  # Workspace/folder persistence
│       │   ├── models/           # Serde structs shared across commands
│       │   │   ├── mod.rs
│       │   │   ├── connection.rs
│       │   │   ├── query.rs
│       │   │   ├── db_viewer.rs  # DB viewer types (SchemaGraph, TableNode, etc.)
│       │   │   └── workspace.rs
│       │   └── store/            # SQLite local persistence layer
│       │       ├── mod.rs
│       │       └── migrations.rs
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       └── capabilities/         # Tauri capability permissions
├── www/                          # Website: marketing site + docs (Astro + Tailwind)
│   ├── package.json              # name: gridline-www
│   ├── astro.config.mjs
│   ├── tsconfig.json
│   └── src/                      # Astro pages/components/styles
├── .github/workflows/            # release.yml (monorepo paths) + auto-assign.yml
├── docs/                         # Project docs
├── screenshots/                  # README marketing images
├── scripts/                      # Release tooling (render-cask.sh, release-mac.sh) + Gitea mirror (mirror-gitea.sh, hooks/, install-git-hooks.sh)
└── AGENTS.md                     # This file
```

---

## Conventions

### TypeScript / React
- **Components:** PascalCase files, default exports for page-level, named exports for reusable primitives
- **Hooks:** `use` prefix, one hook per file unless tightly coupled
- **Stores:** One Zustand store per domain (`connectionStore`, `queryStore`, `workspaceStore`)
- **Types:** Define interfaces in `src/lib/types.ts`; use `type` for unions/aliases
- **No `any`:** Always type Tauri `invoke()` calls with explicit generics
- **CSS:** Tailwind utility classes only; no CSS modules unless unavoidable (Monaco configuration is the exception)

### Rust
- **Modules:** One module file per concern; re-export through `mod.rs`
- **Errors:** Use `anyhow` for application errors, `thiserror` for library-style enums
- **Commands:** Keep `#[tauri::command]` functions thin — delegate to `db/` or `store/` modules
- **State:** Use Tauri managed state (`app.manage()`) for connection pool handles
- **Naming:** `snake_case` for functions/modules, `CamelCase` for types/structs

### General
- **IPC flow:** Frontend calls typed wrapper → wrapper calls `invoke()` → Rust command → Rust logic → returns `Result<T, String>`
- **Error handling:** Rust commands return `Result<T, String>` (map errors to user-readable strings before crossing IPC boundary)
- **No secrets in logs:** Never log connection strings, passwords, or query parameters
- **Dark mode first:** All UI components must look correct in dark theme; light theme is secondary

---

## Key Design Decisions

1. **Tauri over Electron** — ~40MB RAM vs 250MB+. Native file dialogs, OS keychain access, and `std::process::Command` for `pg_dump`/`pg_restore` without Node.js overhead.

2. **Rust-native DB drivers** — `sqlx`/`tokio-postgres` connect directly to PostgreSQL from the Rust backend. No Node.js `pg` library, no sidecar Node process. The frontend never touches database connections directly.

3. **System CLI tools for backup/restore** — Rather than implementing `pg_dump` format parsers in Rust (enormous scope), we shell out to the user's installed `pg_dump`/`pg_restore` binaries. The app will detect missing tools and guide installation.

4. **SQLite for local state** — Workspace tree, saved queries, connection metadata (NOT passwords), and query history go into a local SQLite database in the Tauri app data directory. This enables fast full-text search and relational queries without loading everything into memory.

5. **Virtualized grid from day one** — Query results can be 100k+ rows. We must render with canvas/DOM virtualization (Glide Data Grid or TanStack Virtual), never with naive DOM row rendering.

---

## Development Workflow

### Commands

```bash
bun install                                        # Install all workspace deps (repo root)
bun run dev:desktop                                # Vite dev server only (no Tauri)
bun run tauri:dev                                  # Full Tauri app with hot-reload
bun run --filter gridline-desktop build            # Desktop production build
bun run dev:www                                    # Website dev server (Astro)
bun run build:www                                  # Website static build (www/dist/)
bun run test                                       # Desktop frontend tests (vitest)
cargo build                                        # Rust backend only (from desktop/src-tauri/)
cargo test                                         # Rust tests (from desktop/src-tauri/)
```

### Branch & PR workflow

**GitHub is the only remote that matters.** The canonical repo is `github` → [AdrianBonpin/gridline](https://github.com/AdrianBonpin/gridline) (default branch `prod`, issues, PRs, Actions, releases). The `origin` remote (`git.ranio.xyz/adrianbonpin/gridline`) is a **just-in-case mirror** — do not push branches, open PRs, or publish releases/tags there. If you must mirror something manually, push to `github` first.

**Never commit or push directly to `prod`** — `prod` is protected (branch rules require a pull request). Always:

1. Branch out first — `git checkout -b feat/<short-name>` (or `fix/…`, `docs/…`) from `prod`
2. Commit and push the feature branch to `github` (`git push -u github <branch>`)
3. Open a PR into `prod` on GitHub (`gh pr create --repo AdrianBonpin/gridline --base prod`) and merge it there

Direct pushes to `prod` will be bypassed only in emergencies; prefer the PR path so changes land through the PR gate.

**The Gitea fallback keeps itself current — run `scripts/install-git-hooks.sh` once per clone.** It sets `core.hooksPath=scripts/hooks`, so:

- `pre-push` mirrors `prod` + all tags to `origin` (Gitea) whenever you push to the `github` remote,
- `post-merge` mirrors again after a `git pull`/merge while on `prod` (a PR squash-merged on GitHub only reaches the mirror when the local `prod` pulls it).

`scripts/mirror-gitea.sh` does the same by hand (`--branches` also pushes feature branches); it refuses to push to a GitHub remote and exits non-zero if the mirror could not be updated. The hooks downgrade that to a warning — **a Gitea outage never blocks a push to GitHub**.

### Releases

**Releases are GitHub-only.** Tag `prod` and push the tag to the `github` remote — `git tag vN.M.N && git push github vN.M.N`. GitHub Actions (`release.yml`) builds installers for macOS (Apple Silicon + Intel), Windows, and Linux and opens a **draft** release (review + publish on GitHub). The Gitea tag arrives automatically via the `pre-push` hook (or `scripts/mirror-gitea.sh`) — never `git push origin vN.M.N` expecting a build, and never publish a release on Gitea.

**Before tagging**, keep everything in sync:
- Version number across `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, and `www/src/pages/index.astro` (the landing page version string)
- `desktop/src/lib/version.test.ts` and `desktop/src/lib/docs-coverage.test.ts` if they assert the version
- **README download links are static (versioned)** — both download tables (top **Download** section + **Which file should I download?**) link directly to the release-tag assets (`releases/download/v0.7.9/<file>`). tauri-action uses default versioned asset names (`Gridline_<ver>_aarch64.dmg`, `Gridline-<ver>-1.x86_64.rpm`, etc.) — update BOTH tables to the new names on every release (see the MAINTENANCE comment in README.md).
- **Bundled pg tools:** `tauri.conf.json` `bundle.resources` lists `resources/pg_tools/*`; the `release.yml` matrix builds/downloads + checksum-verifies the static binaries before the Tauri build step.
- **macOS is Developer-ID signed + notarized** via `scripts/release-mac.sh` (built manually on Adrian's machine; not in CI). The script auto-detects the Developer ID identity from the login keychain, reads notarization credentials from `~/.config/gridline/notarize.env` (App Store Connect API key), and verifies codesign + stapled notarization before uploading. If the cert or credentials are missing it fails with setup instructions (see the README's "macOS signing & notarization" section).

### Adding a Tauri Command

1. Define the command function in the appropriate `desktop/src-tauri/src/commands/` module
2. Register it in `desktop/src-tauri/src/lib.rs` via `.invoke_handler(tauri::generate_handler![...])`
3. Create a typed wrapper function in `desktop/src/lib/commands.ts`
4. Call the wrapper from your React component/store

### Adding a New Dependency

- **Frontend:** `bun add <package>` (runtime) or `bun add -d <package>` (dev)
- **Rust:** Add to `desktop/src-tauri/Cargo.toml` under `[dependencies]`

**Website (`www/`) deps — keep the standalone lockfile in sync:** `www/` is a bun workspace member, so `bun add` updates the **root** `bun.lock`, but Railpack (Dokploy, build path `/www`) uses the **standalone `www/bun.lock`**. After adding/removing a dep in `www/`, regenerate `www/bun.lock` so the deployed build stays deterministic:

```bash
TMP=$(mktemp -d) && cp www/package.json "$TMP/package.json" && cd "$TMP" && bun install --lockfile-only && cp bun.lock ../../www/bun.lock && cd - && rm -rf "$TMP"
```

(Adjust the `../../` relative path to point back at `www/` from the temp dir.) Commit both `bun.lock` and `www/bun.lock` together.

### Testing Strategy

- **Rust:** Unit tests for database logic, connection pool management, and command handlers. Use `sqlx::test` with a test PostgreSQL instance for integration tests.
- **Frontend:** Vitest + React Testing Library for component tests. Focus on store logic, command wrappers, and critical UI flows (connection form, query execution).
- **E2E:** (Future) Tauri WebDriver or Playwright for critical paths.

---

## Constraints & Guardrails

- **Do NOT** implement `pg_dump` file format parsing — always shell out to (bundled or system) binaries
- **Do NOT** store passwords in SQLite or local files — use OS keychain APIs exclusively
- **Do NOT** render large query results in raw DOM — always use the virtualized grid component
- **Do NOT** log credentials, connection strings, or query data
- **Do NOT** introduce Electron, Node.js server processes, or Docker dependencies
- **Do NOT** execute data-modifying SQL (INSERT, UPDATE, DELETE, DROP, ALTER) or any destructive CRUD operation (deleting connections, folders, tags) directly without explicit user confirmation. For database data, always push to the changes queue first and require "Commit All". For app entities (connections, folders, tags), show a confirmation dialog before executing.
- **DO** keep Tauri commands thin — business logic lives in `db/` and `store/` modules
- **DO** type all IPC boundaries explicitly
- **DO** validate and sanitize all user-provided SQL and connection parameters before execution

---

## Implementation Status

✅ = Complete &nbsp; 🟡 = Partial/Stub &nbsp; ❌ = Not Started

Planned work is prioritized in the [Project Roadmap](./ROADMAP.md) (source of truth for what's next); this table reflects the current codebase and may lag planned work. See also the [architectural spec for the in-flight v0.7.0 work](./docs/superpowers/specs/2026-08-04-architectural-spec.md).

### Connection Management
| Feature | Status | Details |
| :--- | :---: | :--- |
| Connections CRUD (PostgreSQL, MySQL, SQLite, Redis, MariaDB) | ✅ | Full create/read/update/delete with form validation |
| MariaDB connections | ✅ | First-class db_type on the MySQL driver path (v0.8.0) |
| New Connection screen (revamped) | ✅ | Two-stage entry → configured flow: Connection URI + 6-card provider grid (PostgreSQL / MySQL / SQLite / Redis / Supabase / NeonDB) with an OR divider → expands into label + tags/env/folder + General|SSH·SSL tabs. **Pasting a URI fills every setting it can** — type, host, port, user, password, database, `?sslmode=`/`ssl-mode=` (Neon/Supabase → Require, MySQL `VERIFY_IDENTITY` → verify-full) — and offers a URL-derived label (database name, else host) as a placeholder that Save/Test uses when the field is left blank; Supabase & NeonDB are managed-PostgreSQL presets (persist as `postgresql`) with in-app setup guides + SSL hints, PlanetScale is a managed-MySQL (Vitess) preset (persists as `mysql`) with a setup guide + `.psdb.cloud` host detection (v0.8.0); presets pre-select their TLS mode (Supabase/Neon Require, PlanetScale Verify Full); SQLite swaps the URI field for a file-path + Browse input (v0.7.0)
| Connection testing (all DB types) | ✅ | PostgreSQL, MySQL, SQLite, Redis all testable |
| DB Viewer: PostgreSQL browse + query | ✅ | Schemas, tables, paginated data, FK preview, JSON viewer |
| DB Viewer: SQLite browse + query | ✅ | Full support via rusqlite |
| DB Viewer: MySQL browse + query + edit | ✅ | Full viewer: connect (SSL + SSH tunnel), databases/tables/columns/FKs, query + pagination, inline cell editing + changes queue, DDL copy (`SHOW CREATE TABLE`), CSV/JSON import — added in v0.7.0. PK-only editing (no ctid equivalent); VARBINARY `information_schema` columns decoded correctly |
| DB Viewer: Redis browse | ❌ | Connection + test only; browsing gated off with a clean "not supported" state (v0.7.0) |
| Password storage in OS keychain | ✅ | macOS Keychain, Linux Secret Service, Windows Credential Manager. macOS items get an explicit `SecAccess` ACL pinning them to the app's code-signature requirement on every save (`keychain_acl.rs`) — items survive re-signs/upgrades without keychain permission prompts. **Self-healing ACLs**: the ACL is also (silently) verified *before* reads and repaired when this app isn't in it, so items pinned to an older binary path (pre-monorepo `src-tauri/`, a reinstalled app, an ad-hoc dev build) cost one authorization instead of asking for the keychain password on every access, per secret |
| Enable keychain toggle | ✅ | Default ON (opt-out); OFF = don't persist the DB password (session-only, re-prompt on connect) + purge existing keychain entry; SSH secrets stay keychain-only (v0.7.6) |
| SSH tunnel config UI | ✅ | Host, port, user, auth method, key path, passphrase fields |
| SSH tunnel runtime | ✅ | Real ssh2 tunnel (password + key auth), binds 127.0.0.1 only, secrets in OS keychain (`ssh_password:<id>` / `ssh_passphrase:<id>`), closed on pool eviction / app exit; TLS downgraded to `require` through the tunnel |
| SSL/TLS config UI | ✅ | Mode (disable/require/verify-ca/verify-full), cert paths. Selections (mode + CA/client cert/key) are persisted on create **and** edit — the form data type carries the `ssl_*` fields and the submit handlers pass them through (previously the SSH/SSL tab's values were dropped, so connections saved with TLS off and managed providers rejected them) |
| SSL/TLS runtime | ✅ | PostgreSQL all modes via rustls (disable/require/verify-ca/verify-full; **v1: `verify-ca` behaves as `verify-full`** — documented refinement), client certs PKCS#1/PKCS#8/EC, encrypted client keys rejected; MySQL test path maps modes (verify-full → VerifyIdentity). Managed hosts (`*.neon.tech` / `*.supabase.co` / `*.psdb.cloud`) default to `require` when the connection has no `ssl_mode` (`db::tls::resolve_ssl_mode`), so pre-fix saved connections still connect; an explicit mode always wins |
| Roles & grants (PG) | ✅ | Create/edit/drop PostgreSQL roles and GRANT/REVOKE privileges per object class from a UI (v0.7.7) |

### Home Screen & Organization
| Feature | Status | Details |
| :--- | :---: | :--- |
| Connection cards grid (by folder) | ✅ | Grouped display, single-click to open DB viewer |
| Folders CRUD | ✅ | Nested folders, reparent on delete, breadcrumb nav |
| Tags CRUD | ✅ | Colors, drag reorder, filter connections by tag |
| Tag overflow scroll on cards | ✅ | Connection cards show up to 3 tags, then the row scrolls horizontally (v0.7.0) |
| Tag filter dropdown | ✅ | ActionRow Tags button → dropdown with checkboxes, active-count badge, Manage tags → Settings. **OR semantics** — a connection shows if it has ANY selected tag (not all) |
| Folder tag matching | ✅ | When any filter is active, folder cards show only if the folder matches a selected tag OR contains matching connections (directly or in subfolders) |
| DB type filter (Postgres/MySQL/SQLite/Redis) | ✅ | Dropdown with checkboxes + Clear all; folder cards hidden when their contents don't match the DB type |
| Environment filter | ✅ | Select in Filters dropdown: All / Production / Staging / Development / None (unassigned); counts toward active badge |
| Global search (Cmd+K) | ✅ | Connection URL detection auto-fills new-connection form; shows results from ALL folders as if at root (folder scope bypassed while searching); breadcrumb shows "Showing Search Results" with Clear button; **Esc while the search is focused clears the query, exits search mode and blurs** |
| Connection name editing | ✅ | Name field in GeneralTab edit form |
| Import/Export connections (JSON) | ✅ | Bulk import with validation, skipped-record reporting |
| Bulk select + delete connections/folders | ✅ | Checkbox selection with confirmation dialog |
| Drag-and-drop connections to folders | ✅ | Optimistic update with atomic snapshot rollback (race-condition hardened) |
| Inline tag creation | ✅ | "Create first tag" inline form (name + color) in SearchableTagPicker empty state |
| Move-to-folder bulk action | ✅ | Selection toolbar → Move to Folder dialog (folder picker, move confirmed via dialog) |
| Favorites / Recent connections | ✅ | Star toggle in the connection card ⋮ menu (persisted `favorite` flag); Recent connections row (top 8 via `getRecentConnections`) |
| Connection status indicator on cards | ✅ | Kebab menu → Test connection with inline idle/checking/online/offline result, on-demand via keychain + `testConnection`. **Reports real `server_version` + `latency_ms`** (PG/MySQL/SQLite queries + connect timing in the Rust backend); shows `Online · 16.4 · 42ms` or the error, re-check debounced 2s |
| Connection card actions menu (⋮) | ✅ | Kebab dropdown: Favorite toggle, Test connection (inline status), **Copy connection URL** (with password) / **Copy connection URL (no password)** (builds a `postgresql://`/`mysql://`/`sqlite://`/`redis://` string from the saved connection, percent-encoded, sslmode appended for PG; password fetched from keychain on demand), Manage submenu (Edit… / Duplicate / Delete…) |

### Database Viewer
| Feature | Status | Details |
| :--- | :---: | :--- |
| Multi-tab table browser | ✅ | Open tables in tabs, close with Cmd/Ctrl+W |
| DB viewer capability gating | ✅ | `dbCapabilities.ts` matrix per `db_type` (PG full; SQLite explorer/queries/visualizer/editing/import; MySQL explorer/queries/editing/import; Redis none); unsupported views show a clean "not supported" state. Redis browsing gated off (v0.7.0) |
| Schema/database selector | ✅ | Ghost-style dropdowns, single-row layout; schema dropdown + tables tree show a loading state while the schema tree is still fetching, instead of an empty "no tables" state (v0.7.0) |
| Table toolbar during load | ✅ | Toolbar renders immediately when a tab opens while data is still fetching, so the loading state is visible (v0.7.0) |
| Refresh database (spin + success/error feedback) | ✅ | Re-fetches databases, schemas, and tables |
| Search tables filter | ✅ | Animated input, real-time filter by name, auto-hide on blur |
| Column metadata (PK, FK, type, nullable, default) | ✅ | Expand table row to see columns with icons. ENUM/custom types resolved via udt_name, cast ::text for data retrieval. |
| FK detection | ✅ | `information_schema.constraint_column_usage` + `PRAGMA foreign_key_list` |
| FK preview popover | ✅ | Click FK cell → popover with referenced row → "Open" button creates filtered tab |
| JSON/JSONB cell popover | ✅ | Formatted/Raw tabs with copy button |
| Smart default sort | ✅ | 12-tier priority: updated_at → created_at → *_at → *_id → seq/rank/version |
| Data grid pagination | ✅ | Page nav, page size selector persisted in settings |
| Column filtering (server-side) | ✅ | eq, neq, contains, starts, ends, gt, lt, null, notnull pushed to SQL WHERE |
| Visual filter builder | ✅ | Column Filters popover with a "+ Add filter" row editor (column / operator / value selects, per-rule remove, AND semantics, persists in tab `filterRules`). Free-text values are debounced (400ms) so a query only fires after the user stops typing; column/operator changes apply immediately. The filter button is a plain toggle (open when closed, close when open) |
| Column sorting (server-side) | ✅ | Multi-column asc/desc pushed to SQL ORDER BY |
| Column show/hide | ✅ | Toggle visibility per column |
| Column resize (drag handle) | ✅ | Double-click to auto-fit |
| Row selection (checkboxes + select all) | ✅ | Bulk copy (JSON/CSV/SQL) and delete |
| Export toolbar (JSON, CSV, SQL, Markdown, Excel (.xlsx)) | ✅ | Client-side Blob download of visible rows; Excel (.xlsx) via client-side workbook generation (v0.7.8); plus Rust-side **Export all rows to file…** (full-result CSV/JSONL/JSON streaming with progress + cancel) (v0.8.0) |
| Excel (.xlsx) export | ✅ | Client-side .xlsx export of visible rows alongside JSON/CSV/SQL/Markdown (v0.7.8) |
| Auto-refresh timer | ✅ | Configurable interval in settings |
| Changes queue (INSERT, UPDATE, DELETE, bulk_insert, empty_table, drop_table) | ✅ | Stage → **Commit All**. Tab bar **Changes** button (amber border + count badge when pending) toggles a **popover** anchored to it: header with **Visual/SQL** toggle (cards showing op badge + table + description + per-change **Revert**, or a generated-SQL preview via `buildChangeSql`), footer **Clear All** + **Commit All (N)** with **⌘S/Ctrl+S** shortcut. Committed cards show a green ✓ (failed ✗); committing `drop_table` auto-closes open tabs of that table. **Insert Row** adds an editable pending row at the top of the grid (accent outline); committing inserts only the filled columns so serial/identity/generated defaults apply |
| Auto schema-tree refresh | ✅ | Tree auto-refreshes after a successful schema-modifying query run (`CREATE`/`DROP`/`ALTER`/`TRUNCATE` via `isSchemaModifyingQuery`) and after committing schema-modifying queue changes — `drop_table`, schema-modifying `ddl` (e.g. `CREATE TABLE`), and `rebuild_table` — no manual refresh needed |
| Data import (CSV/JSON) | ✅ | Table overflow menu → ImportDialog: file pick, parse, preview (first 100 rows), header→column mapping, caps 100k rows / 100 MB; stages a bulk_insert change through the queue → Commit All |
| Table menu actions | ✅ | Copy table schema (DDL via pg_dump / sqlite_master), Empty Table (DELETE) / Delete Table (DROP) through the queue with confirm, export stubs wired (JSON/CSV/SQL/Markdown) |
| Edit connection modal (from DB viewer) | ✅ | AnimatedModal with keychain password fetch on test |
| Connection drop banner | ✅ | Auto-detects broken connections with reconnect prompt |
| Inline cell editing | ✅ | Double-click/Enter edits a cell; commit stages an `update` change in the queue → Commit All. No-PK tables use ctid/rowid locator; PK/generated/identity columns and views/matviews are read-only. Stale-write protection via affected-row-count check. **Optimistic UI**: the changes queue is the single source of truth — `deriveStagedValues` feeds staged values + a pending amber dot back into the grid (dot clears on commit, values survive until refetch); re-editing the same cell replaces the queue entry (original `oldData` kept); Clear All removes dots instantly; queue cards show an old → new value diff. **Smart editors**: PG enum columns render a `<select>` of enum labels; FK columns render a searchable dropdown of referenced rows (one row per option showing the first 4 referenced columns, FK-popover styling, 360px fixed, portal to body); `date`/`time`/`timestamp` columns use native date/time/datetime pickers, `boolean` a true/false select, and numeric types a number input; `text`/`json`/`jsonb` use a single-line scrolling textarea. |
| Virtualized data grid | ✅ | Row-level virtualization via @tanstack/react-virtual `useVirtualizer`; handles 100k+ rows |
| Row detail / expandable row view | ✅ | RowDetailDrawer: right-drawer per row, opened via the cell context menu **View Row** |
| Keyboard cell navigation (arrow keys, Tab) | ✅ | Arrow keys + Tab/Shift+Tab wrap (`keyboardNav`); Enter opens the editor; **Esc cancels editing even after the editor lost focus** (document-level listener) and closes the context menu |
| Cell-level copy (right-click or Ctrl+C) | ✅ | CellContextMenu: Copy / Copy JSON (jsonb) / Edit / Set NULL / Open FK reference + **View Row** and **Select Row** items; right-click or Ctrl/Cmd+C on the focused cell; menu closes on outside click/Esc |
| FK reference | ✅ | Small ↗ icon at the start of FK cells opens the FK preview popover (also via context menu Open FK reference); plain click on the cell selects/edits and does not open it |
| Maintenance actions (VACUUM/ANALYZE/REINDEX) | ✅ | Right-click table → VACUUM / ANALYZE / REINDEX (v0.7.7) |

### Table Editor & Roles (v0.7.7)
| Feature | Status | Details |
| :--- | :---: | :--- |
| Create Table (visual editor) | ✅ | "Create Table…" workspace tab: columns grid (name / type dropdown / default / PK per row, drag-to-reorder, add/remove), single + composite PK (first column auto-PK), shorthand PG types (`int`/`int8`/`int2`/`float8`/`bool`), auto-increment gating, live Monaco SQL preview, transparent selects + form-row focus `amber-400/20` |
| Edit Table (column diff) | ✅ | Same grid on existing tables; Stage diffs old vs new columns → one queue item per statement: `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN`, `ALTER COLUMN … TYPE`, `SET|DROP DEFAULT`, `SET|DROP NOT NULL`; stale-write guard (re-fetches live columns, refuses if changed) |
| Column reorder (atomic rebuild) | ✅ | Drag-to-reorder triggers a table rebuild: single transaction, preserves constraints/indexes/FKs/grants/sequences (copied DDL), fail-closed when triggers/RLS policies/inheritance/partitioning/generated columns are present (`get_table_rebuild_readiness`) |
| FK management | ✅ | Multi-column FK composer (local col → ref col pairs, referenced PKs first, type-match preview `localType → refType`, auto-named constraints, ref-table picker with `name (type)` options); cross-schema references; ON DELETE / ON UPDATE actions; create mode inlines FKs into the single CREATE TABLE change, edit mode stages ALTERs; FK rows in the form with Edit/Remove (queued changes revert, DB FKs stage DROP CONSTRAINT) |
| Table options | ✅ | Tablespace picker (non-system, from `pg_tablespace`) + row-level security toggle in the Options section |
| Roles & grants management | ✅ | Objects → Roles: list non-system roles (attributes incl. connection limit — `rolconnlimit::int8` cast fix), role detail with attribute grid + memberships + privilege explorer; create/edit/drop roles staged through the queue |
| Role privilege explorer | ✅ | Per-role privileges grouped by object class (tables/sequences/routines/schemas/databases) with collapsible sections — collapsed shows first 5 + fade, expand shows all, chevron hidden when ≤5; GRANT/REVOKE composer (object class + schema + name, WITH GRANT OPTION); aclexplode-based queries (`role_sequence_grants` removed in PG 15, `schema_privileges` never existed) |
| SQLite table editor (Create/Edit Table) | ✅ | Visual Create Table / Edit Table extended to SQLite: SQLite-aware type mapping (`INTEGER PRIMARY KEY AUTOINCREMENT` instead of `serial`, `TEXT`/`REAL`/`BLOB`) and ALTER TABLE limits respected (v0.7.8) |

### Object Explorer (non-table objects)
| Feature | Status | Details |
| :--- | :---: | :--- |
| Unified Objects view | ✅ | Functions/Triggers/Sequences/Enums/Extensions merged into a single **Objects** nav item; sidebar header leads with an object-type dropdown (title position) + refresh/search icons, animated search, db/schema switchers; switching type resets selection and refetches |
| Functions | ✅ | Full detail view: signature, arguments with mode/type, syntax-highlighted line-numbered source. Overloads disambiguated by argument signature. Schema-filtered via pg_proc query. |
| Triggers | ✅ | Full detail view: table, event, timing, orientation, status (color-coded), definition. tgtype bitmask corrected. Schema-filtered. |
| Sequences | ✅ | Full detail view: current value, increment, start, min/max, cycle flag. Schema-filtered via information_schema.sequences. |
| Enums | ✅ | Full detail view: numbered bordered list matching Arguments style. Schema-filtered via pg_type WHERE typtype='e'. |
| Extensions | ✅ | Full detail view: version, schema, comment. Queried from pg_extension (no schema filter — extensions are DB-scoped). |
| Indexes (per table) | ✅ | Per-table index list with columns, method, unique/partial flags (via pg_indexes) |
| Constraints (CHECK, UNIQUE beyond PK/FK) | ✅ | CHECK/UNIQUE constraints beyond PK/FK, introspected via information_schema |
| Materialized views | ✅ | Distinct icon in table tree, browsable, read-only (via pg_matviews) |
| Stored procedures | ✅ | Procedures object type filters prokind='p'; Functions now filters kind='f' |
| Schema CRUD | ✅ | Create / rename / drop schemas from the object tree; CASCADE drop with typed-name confirm + dependency warning (v0.7.5) |
| Global object search | ✅ | Cmd+K palette in the DB viewer, current-schema scope, all object types; results open a table tab or jump to the Objects view (v0.7.5) |
| Copy as DDL for any object | ✅ | `CREATE` DDL for every browsable type (tables via pg_dump; pg_get_*def passthrough; sequences/enums/extensions/views synthesized) (v0.7.5) |
| Object dependencies | ✅ | `pg_depend` "what depends on this?" view, shown before destructive drops (table drop, schema drop) (v0.7.5) |
| Object management CRUD | ✅ | Right-click / ⋮ create/edit/drop for every PG object type; create/edit open as **workspace tabs** with a Visual ⇄ SQL toggle, staged through the changes queue with generated-SQL preview (v0.7.6). Enum value removal unsupported (PG has no DROP VALUE) |
| Objects view tabbed workspace | ✅ | Objects view uses the shared tabbed workspace: object details open as tabs (per-type icons), inline manual query tab, and the changes queue reachable from the tab bar (v0.7.6) |
| Schema visualizer (ER diagram) | ✅ | Full React Flow ER diagram with dagre auto-layout, crow's foot notation, schema selector, legend with cardinality colors, collapsible columns (PK/FK/unique-only), cross-schema FK support. PostgreSQL (single round-trip LATERAL query) + SQLite (PRAGMA). Uses @xyflow/react + dagre. |
| Create/Edit table + column-diff + rebuild | ✅ | Create Table + Edit Table column-diff editor (ADD/DROP/RENAME/ALTER TYPE/SET|DROP DEFAULT/SET|DROP NOT NULL, staged one-per-queue-item); atomic column-reorder table rebuild in a single transaction, preserving constraints/indexes/FKs/grants/sequences (v0.7.7) |
| Relationships (FK CRUD, cross-schema, ON DELETE/UPDATE) | ✅ | FK create/edit/drop with cross-schema references and ON DELETE/UPDATE actions (v0.7.7) |
| TimescaleDB hypertables | ✅ | Objects view type on PG connections with the extension; runtime availability gating (v0.8.0) |

### Query Editor
| Feature | Status | Details |
| :--- | :---: | :--- |
| SQL text editor (Monaco) | ✅ | Lazy-loaded Monaco SQL editor with Cmd/Ctrl+Enter to run (`src/components/editor/QueryEditor.tsx`) |
| Custom query execution (arbitrary SQL) | ✅ | `execute_query` Rust command: subquery-wrapped pagination + raw fallback; PostgreSQL + SQLite; results in virtualized grid |
| Destructive query guard | ✅ | Confirmation dialog for INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/REPLACE (`isDestructiveQuery` + `DestructiveQueryDialog`) |
| Query history / recent queries | ✅ | v5 `query_history` table + v6 `favorite` column; consecutive-identical dedup + retention pruning (500/connection); `get_query_history`/`clear_query_history`/`set_history_favorite` commands; **QueryHistoryDropdown** in the query toolbar (load / run / favorite / clear, lazy fetch, loading + error states) |
| SQL autocomplete (keywords, tables, columns) | ✅ | Completion provider in `src/lib/monacoSetup.ts` backed by `src/lib/sqlCompletion.ts` (pure, unit-tested): keywords (~60) + table names from the active schema; typing `table.` or `schema.table.` suggests that table's columns (introspected via `get_schema_graph`, cached per schema in memory, `incomplete: true` warm-up on first use) |
| Multiple result sets | ✅ | Stacked panels per statement via execute_query_multi; DML/DDL notices; stop-at-first-error (v0.8.0) |
| Cancel long-running queries | ✅ | Per-connection cancel from the query toolbar (`pg_cancel_backend` / MySQL `KILL` / SQLite interruption) instead of waiting or killing the app (v0.7.8) |
| Saved queries (named, organized) | ✅ | v6 `queries` table (nullable `connection_id` for global queries, `folder` field, `ON DELETE CASCADE`); `save_query`/`get_saved_queries`/`update_saved_query`/`delete_saved_query` commands with validation (name ≤200, folder ≤100, text ≤1MB); **SaveQueryDialog** (name + folder, empty-name guard); managed in the Queries view Saved tab |
| Query favorites / pinning | ✅ | Star toggle per history entry via `set_history_favorite`; favorites-only filter in the Queries view History tab |
| Queries view | ✅ | Two-pane layout following Explorer: left sidebar (Explorer-styled header — Queries title, History/Saved dropdown, favorites/clear/search icons, animated search) scoped to the **current connection**, right side reuses the shared tabbed query workspace (TabBar + toolbar + editor + results); clicking a history/saved row loads it into the editor |
| Editor settings (font, tab size, word wrap, minimap) | ✅ | Font size (8–24), font family (allowlist), word wrap, minimap, tab size (2–8) — applied live via Monaco `updateOptions`, no remount |

### Backup & Restore
| Feature | Status | Details |
| :--- | :---: | :--- |
| pg_dump wrapper | ✅ | Rust command spawns pg_dump with real-time progress events (backup-progress). Core logic extracted into headless-testable `run_pg_dump` (takes `PgConnParams` + options directly); Tauri command is a thin wrapper (store lookup → keychain → run → emit). Live integration tests in `backup.test.rs` (`#[ignore]`d, driven by `GRIDLINE_TEST_SRC_*`/`GRIDLINE_TEST_TGT_*` env vars) |
| pg_restore wrapper | ✅ | Rust command spawns pg_restore with progress events. **Plain-format dumps are executed via `psql -f`** (pg_restore can't read plain SQL text); custom/tar/directory use pg_restore. Core logic in headless-testable `run_pg_restore` |
| Backup UI | ✅ | In-page view: format selector, file browse (Tauri dialog), schema dropdown, no-owner toggle, progress bar with event-driven status |
| Restore UI | ✅ | In-page view: file browse, format, clean toggle, destructive confirmation checkbox, progress bar. **Clean toggle is disabled for plain format** (psql can't DROP-before-CREATE) with a hint to use Custom Archive |
| DB-to-DB sync | ✅ | In-page view: source/target connection pickers, schema dropdown, pipe-based pg_dump → pg_restore. **pg_restore side passes `--clean --if-exists`**, so sync works into a non-empty target (UI already requires destructive-overwrite confirmation). Core logic in headless-testable `run_db_sync` |
| Unified Tools view | ✅ | Backup / Restore / DB Sync merged into a single **Tools** nav item; operation-switcher dropdown in the view toolbar, existing forms rendered below |
| Bundled PostgreSQL client tools | ✅ | Static pg_dump/pg_restore/psql shipped as Tauri resources; system-first, bundled-fallback resolution via resource_dir (v0.7.5) |
| SQLite .dump (backup/restore) | ✅ | Backup a SQLite database to a portable SQL dump and restore it back, matching the pg_dump UX (v0.7.8) |
| Backup / Restore / Sync for MySQL & SQLite | ✅ | MySQL backup/restore via mysqldump (system-first); DB-to-DB sync extended beyond PostgreSQL (v0.7.8) |
| Schema diff / compare | ✅ | Tools → Schema Diff; same-engine snapshot diff; safe items stage into the changes queue (v0.8.0) |
| Table structure export (DDL) | ❌ | |

### Settings
| Feature | Status | Details |
| :--- | :---: | :--- |
| Settings screen (redesigned) | ✅ | DB-viewer-styled shell: icon+text sidebar (Back on top, accent background), header shows the active tab, border-sharp sections with gap-spaced rows (no cards), Back returns to the view it was opened from (push/pop in `uiStore`) |
| Theme (dark/light/system) | ✅ | Applied live via a `.light` class on the document root (dark-first base palette); "system" follows the OS via `matchMedia` and live-updates; native window chrome synced through Tauri `setTheme`/`setBackgroundColor` with a macOS **Overlay** titlebar (in-flow drag strip) |
| Windows/Linux title bar fix | ✅ | macOS-only overlay drag strip (`h-7` in `App.tsx`) gated to macOS; Windows/Linux use the native title bar for dragging (v0.7.8) |
| Font size | ✅ | rem scale via `data-font-size` on the root (`small`/`medium`/`large`) |
| Accent color | ✅ | 10-preset circle palette in General → Appearance; applied via `--color-accent` on the root; hover/muted shades derive from it via `color-mix` |
| Default folder for new connections | ✅ | Honored on startup — Home opens into `default_folder_id` unless the user has already navigated |
| Table page size default | ✅ | |
| Auto-refresh rate | ✅ | |
| Tags management | ✅ | Full CRUD with color picker, **drag-and-drop reorder** (`@dnd-kit/sortable`, GripVertical handle; chevron fallback), plain no-card layout |
| Shortcuts (2 configurable) | ✅ | Open command palette, Close tab |
| Confirm-before-delete toggle | ✅ | When off, folder/bulk deletes execute without a confirmation dialog |
| Default ports per DB type | ✅ | New-connection forms prefill the port from `default_ports` per DB type (custom ports in pasted URLs still win) |
| More keyboard shortcuts | ❌ | Only 2 configurable actions |
| Editor settings | ✅ | Five options wired to the settings store + live Monaco `updateOptions` |
| SSH key management | ❌ | Only path inputs, no key file reading |
| Settings export/import | ✅ | Export/import settings (theme, accent, editor options, page sizes, defaults) as a JSON file (v0.7.8) |

### Demo & Onboarding
| Feature | Status | Details |
| :--- | :---: | :--- |
| Demo SQLite database (auto-seeded) | ✅ | Feature-rich e-commerce demo (SQLite) exercising every SQLite-available feature: users/products/categories (self-FK)/addresses/orders/order_items (composite PK)/audit_log (500 rows, pagination + virtualization + JSON `details`)/files (BLOB)/page_views (no PK → rowid editing)/app_settings (TEXT PK)/marketing_campaigns (empty → Empty Table change)/order_summary VIEW. JSON columns declared lowercase `json` (popover works), CHECK/UNIQUE/defaults/indexes surface in copied DDL, smart-sort tiers covered (updated_at/created_at/last_login_at/*_id/quantity), nullable FKs + long text for the smart editors. Version-stamped via `PRAGMA user_version`; stale demo files auto-recreate on launch |
| Re-add demo DB button | ✅ | Settings → General → Demo; re-creates the connection (same app-data-dir file as startup) |
| Regenerate demo DB button | ✅ | Settings → General → Demo; confirm dialog, drops the live pool handle, wipes + re-seeds the demo file (clears any edits made against the demo) |
| Getting started / onboarding flow | ❌ | |
| Welcome tooltips / tour | ❌ | |

### AI Integration (Future Planning)
| Feature | Status | Details |
| :--- | :---: | :--- |
| AI assistant (BYOK) | 🔮 | **Planned for future.** Bring-Your-Own-Key model (user supplies their own API key — no paywall, no bundling). Intended use cases: natural-language → SQL generation, query explanations, schema summaries, error message suggestions. No design decided yet — deliberate before implementation (privacy: SQL/text only sent to user's chosen provider, key stored in OS keychain like DB passwords). |

---

## Related Documents

- [Project Roadmap](./ROADMAP.md) — source of truth for planned work (in-development, next-up, queue, shipped)
- [Architectural Spec: v0.7.0 connection-screen revamp](./docs/superpowers/specs/2026-08-04-architectural-spec.md) — current in-flight work
- [Tauri 2.0 Documentation](https://tauri.app/develop/)
- [sqlx Documentation](https://docs.rs/sqlx)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/)
- [Project README](./README.md)
- [Feature Specification](./README.md#features)

---

*This file is read by AI coding agents (Claude, Cursor, Copilot, etc.) to understand project conventions and architecture before making changes. Keep it current as the project evolves.*