<p align="center">
  <img src="./screenshots/data-grid.png" alt="Gridline data grid with FK preview" width="92%" style="border-radius: 14px;" />
</p>
<p>
  <sub><b>Data Grid & FK Preview</b> — browse 50+ real demo orders and inspect related rows in one click.</sub>
</p>

<h1>Gridline</h1>

<p>
  <i>A lightweight, open-source database GUI for PostgreSQL, MySQL, SQLite, and Redis.</i><br />
  Unlimited connections, tabs, and saved queries — with first-class backup, restore, and DB-to-DB sync for PostgreSQL, MySQL, and SQLite.
</p>

<p>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB" alt="React" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-D22128.svg?style=for-the-badge" alt="Apache 2.0 License" /></a>
  <a href="https://github.com/AdrianBonpin/gridline"><img src="https://img.shields.io/badge/Open_Source-Gitea-4183C4.svg?style=for-the-badge" alt="Open source on GitHub" /></a>
</p>

<p>
  <a href="https://github.com/AdrianBonpin/gridline/releases"><img src="https://img.shields.io/badge/Download_Latest_Release-2ea44f?style=for-the-badge" alt="Download Latest" /></a>
  <a href="https://github.com/AdrianBonpin/gridline/issues/new"><img src="https://img.shields.io/badge/Open_an_Issue-%23E4405F.svg?style=for-the-badge" alt="Open an Issue" /></a>
</p>

---

## Download

Grab the installer for your OS from the [latest release](https://github.com/AdrianBonpin/gridline/releases/latest) — the links below point at the current release (**v0.8.0**):

| OS                           | Architecture                 | Download                                                                                                                             |
| :--------------------------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **macOS**                    | Apple Silicon (M1/M2/M3/M4…) | [Gridline_0.8.0_aarch64.dmg](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_aarch64.dmg)         |
| **macOS**                    | Intel                        | [Gridline_0.8.0_x64.dmg](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_x64.dmg)                 |
| **Windows**                  | x64                          | [Gridline_0.8.0_x64-setup.exe](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_x64-setup.exe)     |
| **Debian / Ubuntu**          | amd64                        | [Gridline_0.8.0_amd64.deb](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_amd64.deb)             |
| **Fedora / RHEL / openSUSE** | x86_64                       | [Gridline-0.8.0-1.x86_64.rpm](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline-0.8.0-1.x86_64.rpm)       |
| **Other Linux**              | amd64                        | [Gridline_0.8.0_amd64.AppImage](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_amd64.AppImage)   |

**macOS via Homebrew** (recommended for Mac users):

```bash
# one-time setup (the tap is hosted on Gitea, not GitHub):
brew tap AdrianBonpin/gridline https://github.com/AdrianBonpin/homebrew-gridline.git
brew trust adrianbonpin/gridline

# install / upgrade:
brew install --cask gridline
```

The cask installs the app directly. The DMGs are Developer-ID signed and notarized, so macOS trusts them on first launch — no `xattr` or "Open Anyway" step needed.

> **macOS first launch:** Gridline is Developer-ID signed and notarized, so macOS opens it without a Gatekeeper prompt. Not sure if your Mac is Intel or Apple Silicon? See [Which file should I download?](#which-file-should-i-download) below.

<!--
  MAINTENANCE: These links are STATIC (versioned) — they point at the v0.8.0
  release assets, not at a moving "latest" target. On every new release,
  update BOTH tables here (Download + Which file should I download?) to the
  new version's asset names, which are tauri-action's default naming:
    Gridline_<version>_aarch64.dmg / _x64.dmg / _x64-setup.exe /
    _amd64.deb / _amd64.AppImage  and  Gridline-<version>-1.x86_64.rpm
  The .msi (Gridline_<version>_x64_en-US.msi) is not linked below.
-->

---

## What is Gridline?

Gridline is a modern, open-source database GUI client built with [Tauri 2.0](https://tauri.app), Rust, and React. It is lightweight by design (~40 MB baseline), powerful by default, and free from the paywalls that limit commercial alternatives.

- **No caps** on connections, tabs, or saved queries.
- **Deep PostgreSQL tooling** — visual `pg_dump`, `pg_restore`, and DB-to-DB sync.
- **Backup, restore & sync for every database** — PostgreSQL, MySQL (`mysqldump` / bundled MariaDB clients), and SQLite (`.dump`), with direct DB-to-DB sync between live connections.
- **Excel export** — CSV, JSON, SQL, Markdown, and `.xlsx` from any data grid.
- **Cancel long-running queries** — a per-connection cancel button instead of waiting it out or killing the app.
- **SQLite table editor** — the visual Create Table / Edit Table flow now works on SQLite too (`INTEGER PRIMARY KEY AUTOINCREMENT` instead of `serial`).
- **Full MySQL + SQLite browsing** — connect, browse, query, and edit MySQL and SQLite the same way you do PostgreSQL.
- **Full object explorer** — not just tables, but functions, triggers, sequences, enums, extensions, materialized views, and procedures.
- **Interactive ER diagram** — explore relationships visually with crow's-foot cardinality notation.
- **Production-safe editing** — stage INSERT/UPDATE/DELETE changes, review the generated SQL, then commit all at once.

The app ships with a built-in **Gridline Demo (SQLite)** database, so you can explore every feature immediately without setting up a server.

---

## Who is it for?

Gridline is built for developers and small teams who manage multiple database environments:

- **Full-stack developers** switching between local, staging, and production databases.
- **Platform / DBAs** who need `pg_dump`, `pg_restore`, and sync tooling in a native UI.
- **Teams that want native speed** without Electron bloat or seat licenses.

---

## Recent Changes

<details>
<summary>View the full changelog</summary>

- **v0.7.15** — **Support channel on the landing page**: optional coffee via [Ko-fi](https://ko-fi.com/adrianbonpin), never gates a feature. Landing copy refreshed (em dashes dropped, OSS section simplified, funding FAQ); version bump.

- **v0.7.14** — **No more repeated macOS keychain prompts**: saved connection passwords and SSH secrets are now ACL-pinned to the app's code signature on every save (`keychain_acl`), so app upgrades never re-trigger the macOS keychain access dialog (users upgrading from pre-signing builds see one final prompt — choose **Always Allow**). **Install via Homebrew**: `brew tap AdrianBonpin/gridline https://github.com/AdrianBonpin/homebrew-gridline.git` then `brew install --cask gridline`; version bump.

- **v0.7.13** — **macOS is now Developer-ID signed and notarized**: the app is properly code-signed with a Developer ID Application certificate and notarized by Apple, so macOS opens it without the Gatekeeper "Open Anyway" prompt or the `xattr` quarantine workaround. The release script (`scripts/release-mac.sh`) auto-detects the signing identity from the keychain, notarizes + staples both architectures, and verifies the result before uploading; version bump.

- **v0.7.12** — **Reliable cell editing for non-text columns**: editing a PostgreSQL cell whose type isn't `text` (integers, booleans, UUIDs, `json`/`jsonb`, timestamps, enums, numerics, …) previously failed with a Rust serialization error; edited values are now sent to PostgreSQL in text wire format so the server parses them into the column's own type. **Recent connections fix**: the Recent strip no longer renders empty on first launch when the connections list hadn't loaded yet. **Full CI release pipeline for Windows**: self-hosted Windows runner builds the `.exe`/`.msi` installers (bundled `pg_dump`/`pg_restore`/`psql` + MariaDB clients) and uploads them to the release alongside Linux; version bump.

- **v0.7.10** — **Copy connection URL**: from a connection card's ⋮ menu, copy the connection string for use in env vars / other tools — **Copy connection URL** (includes the password, fetched from the OS keychain on demand) and **Copy connection URL (no password)** (safe to share). Builds `postgresql://` / `mysql://` / `sqlite://` / `redis://` strings with percent-encoded credentials and the PG `sslmode` appended; version bump.

- **v0.7.9** — **macOS install/launch fixes**: the app's local store now opens under the OS app-data directory (a cwd-relative `gridline.db` made Finder-launched copies silently exit with a Rust panic before the UI started); macOS bundles are **ad-hoc signed at build time** (`signingIdentity "-"`), replacing the Xcode linker-only signature that macOS treated as unsigned ("damaged and can't be opened", silent Finder refusals) — users now get a standard one-time Gatekeeper prompt (see the [install notes](#installers-are-unsigned-for-now), incl. the `xattr` workaround); **OpenSSL is vendored** into the `ssh2` build so the release no longer depends on a Homebrew OpenSSL path; version bump.

- **v0.7.8** — **SQLite `.dump` backup/restore** plus **backup / restore / sync for MySQL & SQLite** (mysqldump-based, system-first); **Excel (.xlsx) export** in the grid toolbar alongside CSV/JSON/SQL/Markdown; **cancel long-running queries** per connection; **settings export/import** (JSON); **Windows/Linux title bar fix** (macOS-only overlay drag strip); **SQLite table editor** (Create/Edit Table with SQLite-aware type mapping); version bump.

- **v0.7.7** — PostgreSQL **roles & grants** management (create/edit/drop roles with attributes + a per-role privilege explorer across tables/sequences/routines/schemas/databases — collapsible grouped lists with GRANT/REVOKE staging) and **table maintenance** (VACUUM / ANALYZE / REINDEX from the table menu). **Create Table / Edit Table** visual editor: columns grid with type dropdowns and drag-to-reorder, single + composite primary keys, column-diff staging (ADD / DROP / RENAME COLUMN, ALTER TYPE, SET | DROP DEFAULT, SET | DROP NOT NULL — one statement per queue item), atomic column-reorder table rebuild (single transaction, preserves constraints/indexes/FKs/grants/sequences, fail-closed for triggers/RLS/inheritance/partitioning). **FK management** — multi-column composer with cross-schema references and ON DELETE/UPDATE, inlined into CREATE TABLE; **table options** (tablespace, row-level security); changes queue auto-refreshes the object tree after schema-modifying commits; version bump.

- **v0.7.6** — Full PostgreSQL object management (create/edit/drop for enums, functions, procedures, triggers, sequences, extensions, views, materialized views, indexes, constraints) staged through the changes queue with generated-SQL previews; Enable Keychain toggle wired (default ON, opt-out; OFF = session-only); Objects view upgraded to the shared tabbed workspace (object detail tabs with per-type icons, inline manual query + changes queue); ⌘K object search fixes; version bump.

- **2026-08-05:** v0.7.5 — bundled `pg_dump`/`pg_restore`/`psql` (system-first, bundled fallback) so admin features work with no separate install; schema CRUD (create/rename/drop with CASCADE + dependency warning); Cmd+K object search (current schema, all object types); copy-as-DDL for every browsable object type; `pg_depend` object-dependency view shown before destructive drops.
- **2026-08-04:** v0.7.5 — revamped the New Connection screen into a two-stage flow with a 6-provider grid (PostgreSQL, MySQL, SQLite, Redis, Supabase, NeonDB; managed presets ship with setup guides + SSL hints) and added full MySQL DB viewer support (connect, browse, query, inline cell editing + changes queue, DDL copy).
- **2026-08-04:** Revamped the built-in SQLite demo database with realistic e-commerce data (20 users, 24 products, 50 orders, 100 page views, 500 audit rows) and renamed it to **Gridline Demo (SQLite)**.
- **2026-07-XX:** Added inline cell editing with a stage-first changes queue, row-detail drawer, keyboard navigation, and cell-level copy.
- **2026-07-XX:** Added visual filter builder with drag-and-drop column palette and type-aware operators.
- **2026-07-XX:** Added schema visualizer with React Flow + dagre, crow's-foot notation, and cross-schema FK support.
- **2026-07-XX:** Added query history dropdown, saved queries, and a two-pane Queries view.
- **2026-06-XX:** Added settings redesign with live theme, accent color, font size, editor options, and tag reorder.
- **2026-06-XX:** Added SSH tunneling (password + key auth) and full PostgreSQL TLS runtime for production connections.

> See the full history in the [roadmap](#roadmap) below or the [git log](./commits).

</details>

---

## Key Features

### Connections & Workspace

<details>
<summary>Show features</summary>

- **URI auto-fill** — paste `postgres://`, `mysql://`, `sqlite://`, or `redis://` strings and have all fields populate automatically.
- **Provider grid** — pick PostgreSQL, MySQL, SQLite, Redis, Supabase, or NeonDB; managed presets surface in-app setup guides and an SSL hint.
- **Workspace tree** — multi-level folders, color-coded tags, favorites, and recent connections.
- **OS keychain storage** — passwords and SSH secrets live in macOS Keychain / Linux Secret Service / Windows Credential Manager, never in plaintext.
- **SSH tunneling** — real `ssh2` tunnels with password or key authentication.
- **TLS / SSL** — full PostgreSQL/MySQL TLS modes plus client-certificate support.
- **Connection status** — on-demand per-card test with real server version and latency.

</details>

### Schema Explorer

<details>
<summary>Show features</summary>

- **Tables, views, and materialized views** — column metadata, PK/FK, defaults, nullable flags.
- **Functions & procedures** — syntax-highlighted source, argument signatures, overload disambiguation.
- **Triggers, sequences, enums, extensions** — unified **Objects** view with type switcher.
- **Indexes & constraints** — per-table index details plus CHECK/UNIQUE constraints beyond PK/FK.
- **Schema CRUD** — create/rename/drop schemas from the object tree, with typed-name + dependency warning on CASCADE drops.
- **Global object search** — ⌘K, current schema, all object types; results open a table tab or jump to the Objects view.
- **Copy as DDL** — `CREATE` DDL for every browsable object type.
- **Object dependencies** — `pg_depend` "what depends on this?" view before destructive drops.
- **Schema visualizer** — interactive ER diagram with auto-layout, cardinality legend, and collapsible columns.
- **Table creator & editor** — build or alter tables from a visual columns grid: type dropdowns, drag-to-reorder, single/composite primary keys, defaults, nullability — with a live SQL preview and column-diff staging.
- **FK management** — create/edit/drop foreign keys with cross-schema references and ON DELETE/UPDATE actions, inlined into CREATE TABLE.
- **Table options** — tablespace and row-level security per table.

</details>

### Data Grid

<details>
<summary>Show features</summary>

- **Virtualized rows** — handles 100k+ rows via `@tanstack/react-virtual`.
- **Server-side filtering & sorting** — pushed to SQL `WHERE`/`ORDER BY`.
- **FK preview** — click the ↗ icon on a foreign-key cell to inspect the referenced row or open a filtered tab.
- **JSON/JSONB viewer** — formatted and raw tabs with copy.
- **Inline cell editing** — double-click or press Enter; changes stage through the queue before commit.
- **Smart editors** — enum dropdowns for PG enum columns, searchable FK dropdowns for related rows.
- **Visual filter builder** — drag-and-drop columns with type-aware operators.
- **Export** — JSON, CSV, SQL, and Markdown downloads of visible rows.
- **Auto-refresh** — configurable interval timer.

</details>

### Query Workbench

<details>
<summary>Show features</summary>

- **Monaco SQL editor** — lazy-loaded, with keywords + table/column autocomplete.
- **Custom query execution** — arbitrary SQL with destructive-query confirmation.
- **Query tabs** — unlimited tabs, close with `Cmd/Ctrl+W`.
- **Query history** — per-connection, with favorites and pruning.
- **Saved queries** — name, folder, and manage them in the Queries view.
- **Changes queue** — stage edits, review generated SQL, revert per change, then commit all.

</details>

### PostgreSQL Admin Tools

<details>
<summary>Show features</summary>

- **Visual Backup** — `pg_dump` (format selector, schema filter, no-owner), `mysqldump`, and SQLite `.dump` wrappers with real-time progress.
- **Visual Restore** — `pg_restore` / `mysql` / SQLite restore with clean toggle and destructive confirmation.
- **DB-to-DB Sync** — pipe dump → restore between two live connections (PostgreSQL, MySQL, and SQLite).
- **Bundled client tools** — `pg_dump`/`pg_restore`/`psql` plus `mariadb-dump`/`mariadb` ship with the app; system tools are preferred when present, bundled tools are the fallback.
- **Roles & grants** — create/edit/drop roles with attributes; a per-role privilege explorer grouped by object class (tables, sequences, routines, schemas, databases) with collapsible lists and GRANT/REVOKE staging.
- **Table maintenance** — VACUUM, ANALYZE, and REINDEX from the table menu.
- **Excel export** — hand-rolled `.xlsx` writer (inline strings, formula-injection safe) alongside CSV/JSON/SQL/Markdown in the grid toolbar and table menu.
- **Cancel long-running queries** — PG cancel request / MySQL `KILL QUERY` / SQLite interrupt, wired to the toolbar Cancel button.
- **Settings export / import** — share theme, accent, editor options, page sizes, and shortcuts across machines (JSON).

</details>

---

## Screenshots

<div align="center">

<table>
  <tr>
    <td align="center" width="50%">
      <a href="./screenshots/query-editor.png">
        <img src="./screenshots/query-editor.png" alt="Query editor" width="100%" style="border-radius: 12px;" />
      </a>
      <br />
      <sub><b>Query Editor</b></sub>
    </td>
    <td align="center" width="50%">
      <a href="./screenshots/er-diagram.png">
        <img src="./screenshots/er-diagram.png" alt="ER diagram" width="100%" style="border-radius: 12px;" />
      </a>
      <br />
      <sub><b>Schema Visualizer</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="./screenshots/json-popover.png">
        <img src="./screenshots/json-popover.png" alt="JSON popover" width="100%" style="border-radius: 12px;" />
      </a>
      <br />
      <sub><b>JSON Viewer</b></sub>
    </td>
    <td align="center" width="50%">
      <a href="./screenshots/home.png">
        <img src="./screenshots/home.png" alt="Home screen" width="100%" style="border-radius: 12px;" />
      </a>
      <br />
      <sub><b>Home Screen</b></sub>
    </td>
  </tr>
</table>

</div>

---

## Why Gridline vs the alternatives?

Capabilities below are fact-checked against each vendor's official docs and pricing (May 2026).

| Capability                     |         DB Pro (Free)         |         Beekeeper (Free)          |           TablePlus (Free)           |                              Gridline                               |
| :----------------------------- | :---------------------------: | :-------------------------------: | :----------------------------------: | :-----------------------------------------------------------------: |
| Open tabs                      |               3               |             Unlimited             |                  2                   |                            **Unlimited**                            |
| Saved connections              |               2               |             Unlimited             |              Unlimited               |                            **Unlimited**                            |
| Saved queries                  |               5               |             Unlimited             |              Unlimited               |                            **Unlimited**                            |
| Data export (CSV, JSON, SQL)   |     ✅ (unlimited = paid)     |            Basic only             |                  ✅                  |                    **JSON, CSV, SQL, Markdown**                     |
| `pg_dump` / `pg_restore` GUI   |              ❌               |           ❌ paid only            |                  ✅                  |                         **First-class UI**                          |
| DB-to-DB sync                  |              ❌               |                ❌                 |                  ❌                  |                       **Built-in pipe sync**                        |
| Object explorer depth          | Tables, views, indexes, enums | Tables, views, routines, triggers | Tables, views, functions, procedures | **Functions, Triggers, Sequences, Enums, Extensions + full detail** |
| ER diagram / schema visualizer |         ✅ view-only          |           ❌ paid only            |                  ❌                  |                      **✅ React Flow + dagre**                      |
| SSH tunneling                  |         ❌ paid only          |                ✅                 |                  ✅                  |                **✅ Password + key auth, keychain**                 |
| OS credential vault            |              ✅               |                ✅                 |                  ✅                  |         **Keychain / Secret Service / Credential Manager**          |
| Workspace / folder hierarchy   | ✅ query/dash folders + tags  |         ✅ (5.7+, local)          |                  ❌                  |                     **Multi-level tree + tags**                     |
| Changes queue (stage → commit) |              ❌               |         ✅ Apply/Discard          |             ✅ Safe mode             |                      **✅ Queue → Commit All**                      |
| Desktop shell size             |           Electron            |        Electron (~250 MB)         |                Native                |                       **Tauri 2.0 (~40 MB)**                        |
| Open source                    |              ❌               |             ✅ GPLv3              |                  ❌                  |                          **✅ Apache 2.0**                          |

_Notes: DB Pro is an Electron app (launched Nov 2025) whose marketing copy overclaims — its free plan caps connections/tabs/saved queries (FAQ inconsistently claims "unlimited local connections") and gates data imports + SSH tunneling to paid, though CSV/JSON export does work on the free tier; Beekeeper's free Community edition genuinely offers unlimited tabs/connections/queries but gates backup/restore, file import, multi-table export, ERD, AI, and premium DB connectors behind paid tiers; TablePlus's free tier includes every feature but caps you at 2 open tabs / 2 windows / 2 advanced filters._

---

## Tech Stack

| Layer               | Technology                                                                                                | Role                                                               |
| :------------------ | :-------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- |
| **Desktop shell**   | [Tauri 2.0](https://tauri.app)                                                                            | Native webview container (~40 MB baseline)                         |
| **Backend**         | Rust + [tokio](https://tokio.rs)                                                                          | Async runtime, connection pooling, CLI execution                   |
| **DB drivers**      | [sqlx](https://github.com/launchbadge/sqlx) / [tokio-postgres](https://github.com/sfackler/rust-postgres) | PostgreSQL via tokio-postgres; MySQL via sqlx; SQLite via rusqlite |
| **CLI integration** | `std::process::Command`                                                                                   | Wraps bundled or system `pg_dump` / `pg_restore`                   |
| **Frontend**        | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org)                              | Component-based UI                                                 |
| **Styling**         | [Tailwind CSS](https://tailwindcss.com)                                                                   | Utility-first, dark mode, glassmorphic design                      |
| **State**           | [Zustand](https://zustand.docs.pmnd.rs) / Jotai                                                           | Domain stores                                                      |
| **Editor**          | [Monaco Editor](https://microsoft.github.io/monaco-editor/)                                               | IDE-grade SQL editing                                              |
| **Data grid**       | [TanStack Virtual](https://tanstack.com/virtual)                                                          | 100k+ row virtualization                                           |
| **Local store**     | SQLite via [rusqlite](https://github.com/rusqlite/rusqlite)                                               | Settings, saved queries, workspace state                           |

---

## Getting Started

### Download a release

Pre-built installers for macOS, Windows, and Linux are published on the [Releases](https://github.com/AdrianBonpin/gridline/releases) page.

> ⚠️ Gridline is under active development. Expect rough edges and please [open issues](https://github.com/AdrianBonpin/gridline/issues/new) when you hit them.

#### macOS signing & notarization

Gridline's macOS builds are **Developer-ID signed and notarized by GitHub Actions**, so macOS opens them without a Gatekeeper prompt.

**One-time setup** (only the repo owner needs to do this):

1. **Create a Developer ID Application certificate** — [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → **+** → **Developer ID Application**. Generate a Certificate Signing Request from Keychain Access (Certificate Assistant → *Request a Certificate From a Certificate Authority*), upload it, download the `.cer`, and double-click to install into your login keychain. Verify with `security find-identity -v -p codesigning`.
2. **Create an App Store Connect API key** for notarization — [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Users and Access → **Integrations** → **App Store Connect API** → **+** (name it, *Developer* access). Download the `.p8` (shown once) and note the **Key ID** and **Issuer ID**.
3. **Add the signing secrets** to the repository (**Settings → Secrets and variables → Actions**):

   | Secret                       | Value                                                                                              |
   | :--------------------------- | :------------------------------------------------------------------------------------------------- |
   | `APPLE_CERTIFICATE`          | base64 of the exported Developer ID `.p12` — `base64 -i DeveloperID.p12 \| pbcopy`                  |
   | `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12`                                                     |
   | `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Your Name (TEAMID)` — from `security find-identity -v -p codesigning` |
   | `KEYCHAIN_PASSWORD`          | any throwaway password for the temporary CI keychain                                                |
   | `APPLE_API_KEY`              | App Store Connect **Key ID**                                                                        |
   | `APPLE_API_ISSUER`           | App Store Connect **Issuer ID**                                                                     |
   | `APPLE_API_KEY_CONTENT`      | contents of the downloaded `AuthKey_<KeyID>.p8`                                                     |

   When these secrets are absent the macOS jobs still build, but the DMGs are ad-hoc signed and **not** notarized (users get the “Open Anyway” prompt). The CI re-signs the bundled PostgreSQL/MariaDB client binaries with the same Developer ID identity, because Apple rejects ad-hoc-signed nested executables during notarization.

`scripts/release-mac.sh` is the **local fallback** path (used before GitHub Actions took over macOS builds, and still handy for a signed build without burning CI minutes). It auto-detects the Developer ID identity from your keychain, reads notarization credentials from `~/.config/gridline/notarize.env` (`APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`), signs both architectures, notarizes + staples them, and verifies the result before uploading. If the certificate or credentials are missing it fails with instructions (set `GRIDLINE_SKIP_NOTARIZE=1` to build signed-but-unnotarized for testing only).

**Windows** still shows a SmartScreen prompt (no Windows signing cert yet); **Linux** installs without a warning.

#### Which file should I download?

Each release contains **one file per platform** — you only need the one that matches your computer. The links below point at the current release (**v0.8.0**):

| Your system                            | Download this                                                                                                                                | Notes                                                            |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| macOS **Apple Silicon** (M1/M2/M3/M4…) | [Gridline_0.8.0_aarch64.dmg](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_aarch64.dmg)                 | `aarch64` = Apple's own chip                                     |
| macOS **Intel**                        | [Gridline_0.8.0_x64.dmg](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_x64.dmg)                         | `x64` = Intel/AMD                                                |
| **Windows** (most PCs)                 | [Gridline_0.8.0_x64-setup.exe](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_x64-setup.exe)             | The `.msi` is an alternate installer (for enterprises/IT admins) |
| **Debian / Ubuntu**                    | [Gridline_0.8.0_amd64.deb](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_amd64.deb)                     | Install: `sudo apt install ./Gridline_0.8.0_amd64.deb`           |
| **Fedora / RHEL / openSUSE**           | [Gridline-0.8.0-1.x86_64.rpm](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline-0.8.0-1.x86_64.rpm)               | Install: `sudo dnf install Gridline-0.8.0-1.x86_64.rpm`          |
| **Any other Linux**                    | [Gridline_0.8.0_amd64.AppImage](https://github.com/AdrianBonpin/gridline/releases/download/v0.8.0/Gridline_0.8.0_amd64.AppImage)           | Works on every distro: `chmod +x` the file, then double-click it |

**Not sure if your Mac is Intel or Apple Silicon?** Click the **Apple menu** → **About This Mac**. If it shows "Apple M1/M2/M3/M4…" download the `aarch64` file; if it shows an Intel chip, download `x64`. Downloading the wrong one won't run.

#### How releases are made

Cutting a release is one command — CI builds everything. **Releases are cut from `prod`, which is the production branch** — only push release tags from `prod`, never from feature branches:

```bash
git checkout prod && git pull
git tag v0.7.15
git push origin v0.7.15
```

GitHub Actions (`.github/workflows/release.yml`) builds the **macOS (Apple Silicon + Intel), Windows, and Linux** installers in parallel and opens a **draft release** on the [Releases](https://github.com/AdrianBonpin/gridline/releases) page. Review the draft and hit **Publish release** — publishing triggers a follow-up job that bumps the Homebrew cask in [`AdrianBonpin/homebrew-gridline`](https://github.com/AdrianBonpin/homebrew-gridline) (pushed via a write-enabled deploy key on the tap, `HOMEBREW_TAP_DEPLOY_KEY`; skipped when unset).

The self-hosted Gitea mirror (`.gitea/workflows/release.yml`) still builds Linux and Windows for the Gitea release, and `scripts/release-mac.sh` can build macOS locally — both are kept as a fallback if GitHub is unavailable.

Before tagging, make sure the version number is in sync across `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, and `desktop/src-tauri/tauri.conf.json`, and update the **README download tables** (Download + Which file should I download?) to the new version's asset names.

### Build from source

```bash
# 1. Clone the repository
git clone https://github.com/AdrianBonpin/gridline.git
cd gridline

# 2. Install all workspace dependencies
bun install

# 3. Run in development mode with hot-reload (from desktop/)
cd desktop
bun run tauri dev

# 4. Build for production
bun run tauri build
```

### System requirements

- **macOS:** 13 (Ventura) or newer
- **Windows:** 10 or newer
- **Linux:** Ubuntu 22.04+ or equivalent modern distribution
- **RAM:** 8 GB recommended
- **PostgreSQL client tools:** `pg_dump`/`pg_restore`/`psql` are **bundled** with Gridline — no separate install required for backup/restore/sync. (System tools, if installed, are preferred.)

---

## Development

```bash
# Install all workspace dependencies (from the repo root)
bun install

# Full Tauri app with hot-reload (from desktop/)
cd desktop
bun run tauri dev

# Production build
bun run tauri build

# Frontend only (Vite dev server)
bun run dev

# Rust backend only
cd desktop/src-tauri
cargo build

# Run tests
cargo test
```

### Project structure

```
gridline/
├── package.json            # Bun workspace root (desktop + www)
├── desktop/                # Tauri desktop app (React + Rust)
│   ├── src/                # React frontend
│   │   ├── components/     # Reusable UI components
│   │   ├── stores/         # Zustand/Jotai state stores
│   │   ├── hooks/          # Custom React hooks
│   │   ├── lib/            # Utilities, types, Tauri bindings
│   │   ├── App.tsx         # Root component
│   │   └── main.tsx        # Entry point
│   ├── src-tauri/          # Rust backend
│   │   ├── src/
│   │   │   ├── main.rs     # Entry point
│   │   │   ├── lib.rs      # Tauri command registration
│   │   │   ├── db/         # Database connection & pooling
│   │   │   ├── commands/   # Tauri IPC command handlers
│   │   │   └── models/     # Data structures & serde types
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── www/                    # Website (Astro + Tailwind)
```

---

## Roadmap

The full plan — next-up, queue, and shipped history — lives in **[ROADMAP.md](./ROADMAP.md)**.

Highlights of what's next:

- **Admin follow-up** — PostgreSQL users/roles + grants management, and table maintenance actions (VACUUM / ANALYZE / REINDEX)
- **Full Redis support** — key browser, type-aware value editors, TTL management
- **More database types** — MariaDB, TimescaleDB, and friends
- **Managed DB support** — PlanetScale, Turso (Supabase/Neon presets shipped in v0.7.0)
- **AI integration (BYOK)** — natural-language → SQL, chat, summaries, charts

✅ **[View the full roadmap →](./ROADMAP.md)**

---

## Table of Contents

- [Download](#download)
- [What is Gridline?](#what-is-gridline)
- [Who is it for?](#who-is-it-for)
- [Recent Changes](#recent-changes)
- [Key Features](#key-features)
- [Screenshots](#screenshots)
- [Why Gridline vs the alternatives?](#why-gridline-vs-the-alternatives)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Contributing

Contributions, bug reports, and feature ideas are welcome. Gridline is Apache 2.0-licensed and intentionally stays open — no paywalled tiers, no bundled proprietary services.

- Open an issue via the **[template chooser](https://github.com/AdrianBonpin/gridline/issues/new)** — pick **Bug report** (with an environment table so we can reproduce issues quickly), **Feature request**, or **Improvement** (UX polish for existing features). New issues are auto-assigned to the maintainer.
- Submit a pull request. Keep Tauri commands thin, type IPC boundaries explicitly, and follow the existing Rust/React conventions.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
