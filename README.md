<p align="center">
  <img src="./screenshots/data-grid.png" alt="Gridline data grid with FK preview" width="92%" style="border-radius: 14px;" />
</p>

<h1>Gridline</h1>

<p>
  <i>A lightweight, open-source database GUI for PostgreSQL and SQLite.</i><br />
  Unlimited connections, tabs, and saved queries — with first-class <code>pg_dump</code>, <code>pg_restore</code>, and DB-to-DB sync.
</p>

<p>
  <sub><b>Data Grid & FK Preview</b> — browse 50+ real demo orders and inspect related rows in one click.</sub>
</p>

<p>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB" alt="React" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-D22128.svg?style=for-the-badge" alt="Apache 2.0 License" /></a>
  <a href="https://github.com/adrianbonpin/gridline/stargazers"><img src="https://img.shields.io/github/stars/adrianbonpin/gridline?style=for-the-badge&logo=github&label=Stars" alt="GitHub stars" /></a>
</p>

<p>
  <a href="https://github.com/adrianbonpin/gridline/releases"><img src="https://img.shields.io/badge/Download_Latest_Release-2ea44f?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest" /></a>
  <a href="https://github.com/adrianbonpin/gridline/issues/new"><img src="https://img.shields.io/badge/Open_an_Issue-%23E4405F.svg?style=for-the-badge&logo=github&logoColor=white" alt="Open an Issue" /></a>
</p>

---

## What is Gridline?

Gridline is a modern, open-source database GUI client built with [Tauri 2.0](https://tauri.app), Rust, and React. It is lightweight by design (~40 MB baseline), powerful by default, and free from the paywalls that limit commercial alternatives.

- **No caps** on connections, tabs, or saved queries.
- **Deep PostgreSQL tooling** — visual `pg_dump`, `pg_restore`, and DB-to-DB sync.
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

- **2026-08-04:** Revamped the built-in SQLite demo database with realistic e-commerce data (20 users, 24 products, 50 orders, 100 page views, 500 audit rows) and renamed it to **Gridline Demo (SQLite)**.
- **2026-07-XX:** Added inline cell editing with a stage-first changes queue, row-detail drawer, keyboard navigation, and cell-level copy.
- **2026-07-XX:** Added visual filter builder with drag-and-drop column palette and type-aware operators.
- **2026-07-XX:** Added schema visualizer with React Flow + dagre, crow's-foot notation, and cross-schema FK support.
- **2026-07-XX:** Added query history dropdown, saved queries, and a two-pane Queries view.
- **2026-06-XX:** Added settings redesign with live theme, accent color, font size, editor options, and tag reorder.
- **2026-06-XX:** Added SSH tunneling (password + key auth) and full PostgreSQL TLS runtime for production connections.

> See the full history in the [roadmap](#roadmap) below or the [git log](./commits).

---

## Key Features

### Connections & Workspace

- **URI auto-fill** — paste `postgres://`, `mysql://`, `sqlite://`, or `redis://` strings and have all fields populate automatically.
- **Workspace tree** — multi-level folders, color-coded tags, favorites, and recent connections.
- **OS keychain storage** — passwords and SSH secrets live in macOS Keychain / Linux Secret Service / Windows Credential Manager, never in plaintext.
- **SSH tunneling** — real `ssh2` tunnels with password or key authentication.
- **TLS / SSL** — full PostgreSQL/MySQL TLS modes plus client-certificate support.
- **Connection status** — on-demand per-card test with real server version and latency.

### Schema Explorer

- **Tables, views, and materialized views** — column metadata, PK/FK, defaults, nullable flags.
- **Functions & procedures** — syntax-highlighted source, argument signatures, overload disambiguation.
- **Triggers, sequences, enums, extensions** — unified **Objects** view with type switcher.
- **Indexes & constraints** — per-table index details plus CHECK/UNIQUE constraints beyond PK/FK.
- **Schema visualizer** — interactive ER diagram with auto-layout, cardinality legend, and collapsible columns.

### Data Grid

- **Virtualized rows** — handles 100k+ rows via `@tanstack/react-virtual`.
- **Server-side filtering & sorting** — pushed to SQL `WHERE`/`ORDER BY`.
- **FK preview** — click the ↗ icon on a foreign-key cell to inspect the referenced row or open a filtered tab.
- **JSON/JSONB viewer** — formatted and raw tabs with copy.
- **Inline cell editing** — double-click or press Enter; changes stage through the queue before commit.
- **Smart editors** — enum dropdowns for PG enum columns, searchable FK dropdowns for related rows.
- **Visual filter builder** — drag-and-drop columns with type-aware operators.
- **Export** — JSON, CSV, SQL, and Markdown downloads of visible rows.
- **Auto-refresh** — configurable interval timer.

### Query Workbench

- **Monaco SQL editor** — lazy-loaded, with keywords + table/column autocomplete.
- **Custom query execution** — arbitrary SQL with destructive-query confirmation.
- **Query tabs** — unlimited tabs, close with `Cmd/Ctrl+W`.
- **Query history** — per-connection, with favorites and pruning.
- **Saved queries** — name, folder, and manage them in the Queries view.
- **Changes queue** — stage edits, review generated SQL, revert per change, then commit all.

### PostgreSQL Admin Tools

- **Visual Backup** — `pg_dump` wrapper with format selector, schema filter, no-owner toggle, real-time progress.
- **Visual Restore** — `pg_restore` wrapper with clean toggle and destructive confirmation.
- **DB-to-DB Sync** — pipe `pg_dump` → `pg_restore` between two connections.

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

| Capability                     | DB Pro (Free)  |  Beekeeper (Free)  |                       Gridline                        |
| :----------------------------- | :------------: | :----------------: | :---------------------------------------------------: |
| Open tabs                      |       3        |     Unlimited      |                     **Unlimited**                     |
| Saved connections              |       2        |     Unlimited      |                     **Unlimited**                     |
| Saved queries                  |       5        |     Unlimited      |                     **Unlimited**                     |
| Data export (CSV, JSON, SQL)   |  ❌ paid only  |     Basic only     |             **JSON, CSV, SQL, Markdown**              |
| `pg_dump` / `pg_restore` GUI   |       ❌       |    ❌ paid only    |                  **First-class UI**                   |
| DB-to-DB sync                  |       ❌       |         ❌         |                **Built-in pipe sync**                 |
| Object explorer depth          | Tables, views  |   Tables, views    | **Functions, Triggers, Enums, Sequences, Extensions** |
| ER diagram / schema visualizer |       ❌       |    ❌ paid only    |               **✅ React Flow + dagre**               |
| SSH tunneling                  | 🔒 likely paid |         ✅         |         **✅ Password + key auth, keychain**          |
| OS credential vault            |       ✅       |         ✅         |  **Keychain / Secret Service / Credential Manager**   |
| Workspace / folder hierarchy   |       ❌       |         ❌         |              **Multi-level tree + tags**              |
| Changes queue (stage → commit) |       ❌       |         ❌         |               **✅ Queue → Commit All**               |
| Desktop shell size             |     Native     | Electron (~250 MB) |                **Tauri 2.0 (~40 MB)**                 |
| Open source                    |       ❌       |      ✅ GPLv3      |                   **✅ Apache 2.0**                   |

---

## Tech Stack

| Layer               | Technology                                                                                                | Role                                             |
| :------------------ | :-------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| **Desktop shell**   | [Tauri 2.0](https://tauri.app)                                                                            | Native webview container (~40 MB baseline)       |
| **Backend**         | Rust + [tokio](https://tokio.rs)                                                                          | Async runtime, connection pooling, CLI execution |
| **DB drivers**      | [sqlx](https://github.com/launchbadge/sqlx) / [tokio-postgres](https://github.com/sfackler/rust-postgres) | Pure-Rust PostgreSQL (SQLite via rusqlite)       |
| **CLI integration** | `std::process::Command`                                                                                   | Wraps system `pg_dump` / `pg_restore`            |
| **Frontend**        | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org)                              | Component-based UI                               |
| **Styling**         | [Tailwind CSS](https://tailwindcss.com)                                                                   | Utility-first, dark mode, glassmorphic design    |
| **State**           | [Zustand](https://zustand.docs.pmnd.rs) / Jotai                                                           | Domain stores                                    |
| **Editor**          | [Monaco Editor](https://microsoft.github.io/monaco-editor/)                                               | IDE-grade SQL editing                            |
| **Data grid**       | [TanStack Virtual](https://tanstack.com/virtual)                                                          | 100k+ row virtualization                         |
| **Local store**     | SQLite via [rusqlite](https://github.com/rusqlite/rusqlite)                                               | Settings, saved queries, workspace state         |

---

## Getting Started

### Download a release

Pre-built installers for macOS, Windows, and Linux are published on the [Releases](https://github.com/adrianbonpin/gridline/releases) page.

> ⚠️ Gridline is under active development. Expect rough edges and please [open issues](https://github.com/adrianbonpin/gridline/issues/new) when you hit them.

### Build from source

```bash
# 1. Clone the repository
git clone https://github.com/adrianbonpin/gridline.git
cd gridline

# 2. Install frontend dependencies
bun install

# 3. Run in development mode with hot-reload
bun run tauri dev

# 4. Build for production
bun run tauri build
```

### System requirements

- **macOS:** 13 (Ventura) or newer
- **Windows:** 10 or newer
- **Linux:** Ubuntu 22.04+ or equivalent modern distribution
- **RAM:** 8 GB recommended
- **PostgreSQL client tools:** `pg_dump` and `pg_restore` are required for admin features

---

## Development

```bash
# Frontend only (Vite dev server)
bun run dev

# Full Tauri app with hot-reload
bun run tauri dev

# Production build
bun run tauri build

# Rust backend only
cd src-tauri
cargo build

# Run tests
cargo test
```

### Project structure

```
gridline/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components
│   ├── stores/             # Zustand/Jotai state stores
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities, types, Tauri bindings
│   ├── App.tsx             # Root component
│   └── main.tsx            # Entry point
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri command registration
│   │   ├── db/             # Database connection & pooling
│   │   ├── commands/       # Tauri IPC command handlers
│   │   └── models/         # Data structures & serde types
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                 # Static assets
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Roadmap

### ✅ Completed

- Tauri 2.0 + React 19 + TypeScript 5.8 project shell
- PostgreSQL and SQLite browse/query support
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

### 🔮 Future

- **Multi-DB parity** — MySQL browsing, Redis key browser
- **Query workbench** — multiple result sets, visual query builder
- **Deeper PostgreSQL** — user/role management, replication views
- **Notebook reports** — SQL-backed markdown reports with embedded results
- **AI assistant (BYOK)** — bring-your-own-key natural-language → SQL, query explanations, and schema summaries

---

## Table of Contents

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

- Open a [GitHub Issue](https://github.com/adrianbonpin/gridline/issues/new) for bugs or ideas.
- Submit a pull request. Keep Tauri commands thin, type IPC boundaries explicitly, and follow the existing Rust/React conventions.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
