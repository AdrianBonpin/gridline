# Gridline

A modern, open-source, high-performance database GUI client for PostgreSQL and beyond. Built with Tauri 2.0, Rust, and React — lightweight by design, powerful by default.

> **Inspired by DB Pro's best ideas. Freed from its paywalls.** No caps on tabs, connections, or saved queries. Deep PostgreSQL tooling (`pg_dump`, `pg_restore`, DB-to-DB sync) that commercial alternatives leave to the CLI.

---

## Why Gridline?

Most database GUI clients either lock essential productivity features behind paywalls or treat PostgreSQL administration as an afterthought. Gridline is different:

| Capability | DB Pro (Free) | Gridline |
| :--- | :---: | :---: |
| Open tabs | 3 | **Unlimited** |
| Saved connections | 2 | **Unlimited** |
| Saved queries | 5 | **Unlimited** |
| Workspace / folder hierarchy | ❌ | **Multi-level tree** |
| pg_dump / pg_restore GUI | ❌ | **First-class UI** |
| DB-to-DB sync | ❌ | **Built-in diff & migrate** |
| Functions, Triggers, Enums, Sequences | ❌ | **Full object explorer** |
| OS credential vault storage | ❌ | **Keychain / Secret Service** |
| Open source | ❌ | **MIT** |

---

## Features

### Connection & Workspace Management
- **URI Parser** — paste `postgres://`, `mysql://`, `sqlite://`, or `redis://` connection strings and have all fields auto-populated
- **Workspace Tree** — multi-level hierarchy: `Workspace → Folder → Connection`, with color-coded tags (red = Production, green = Local)
- **Credential Security** — passwords stored in the OS keychain (macOS Keychain / Linux Secret Service / Windows Credential Manager), never as plaintext
- **Production Safeguards** — read-only locks and high-visibility warnings on connections tagged `Production`

### PostgreSQL Object Explorer
Full tree-view navigation of all native PostgreSQL schema objects:
- **Tables & Views** — columns, types, defaults, nullability, primary/foreign keys with popover preview
- **Functions & Procedures** — source code with syntax highlighting and line numbers, argument signatures, return types, overload support
- **Triggers & Rules** — event bindings with inline definition inspection, color-coded enabled/disabled status
- **Sequences & Enums** — current values, increments, cycle flags; enum labels in bordered list view
- **Extensions** — installed extensions with version, schema, and comment

### SQL Editor & Query Workbench
- **Multi-Tab Workspace** — unlimited named tabs, close with Cmd/Ctrl+W, session persistence across restarts
- **Changes Queue** — queue INSERT/UPDATE/DELETE changes; preview before committing all
- **Smart Default Sort** — auto-detects `updated_at`, `created_at`, `_id` columns for logical initial sorting
- *(Monaco Editor with SQL autocomplete, query history, and saved snippets coming soon)*

### Data Grid & Schema Browser
- **Virtualized Grid** — row-level virtualization via `@tanstack/react-virtual` handles 100k+ rows
- **Column Management** — resize with drag handles (double-click to auto-fit), show/hide per column, multi-column sort
- **Server-Side Filtering & Sorting** — filters and sorts pushed to SQL WHERE/ORDER BY
- **Export** — JSON, CSV, SQL, Markdown via toolbar
- **FK Preview** — click a foreign key cell to preview the referenced row
- **JSON/JSONB Viewer** — popover with formatted/raw tabs and copy button
- **Auto-Refresh** — configurable interval timer
- *(Inline cell editing, visual filter builder, and data import coming soon)*

### PostgreSQL Administrative Tools
- **Visual Backup** — `pg_dump` wrapper with format selector (Plain SQL, Custom, Tar, Directory), file browser, schema filter, no-owner toggle, real-time progress bar
- **Visual Restore** — `pg_restore` wrapper with file browser, format, clean toggle, destructive confirmation checkbox
- **DB-to-DB Sync** — pipe `pg_dump` → `pg_restore` between two connections with source/target pickers, schema filter, flow indicator

### App Portability
- **Export** — save all workspaces, folders, saved queries, tags, and non-sensitive metadata to a single JSON archive
- **Import** — restore your exact workspace setup on any machine instantly

---

## Tech Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **Desktop Shell** | [Tauri 2.0](https://tauri.app) | Native desktop container (~40MB RAM baseline) |
| **Backend** | Rust + [tokio](https://tokio.rs) | Async runtime, connection pooling, CLI tool execution |
| **Database Drivers** | [sqlx](https://github.com/launchbadge/sqlx) / [tokio-postgres](https://github.com/sfackler/rust-postgres) | Pure-Rust async PostgreSQL (MySQL, SQLite to follow) |
| **CLI Integration** | `std::process::Command` | Wraps system `pg_dump` / `pg_restore` binaries |
| **Frontend** | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) | Component-based UI |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) | Utility-first, dark mode, glassmorphic design |
| **State** | [Zustand](https://zustand.docs.pmnd.rs) / [Jotai](https://jotai.org) | Lightweight client-state for tabs, connections, queries |
| **Code Editor** | *(planned)* [Monaco Editor](https://microsoft.github.io/monaco-editor/) | IDE-grade SQL editing with autocomplete (coming soon) |
| **Data Grid** | [TanStack Virtual](https://tanstack.com/virtual) | Virtualized row rendering for 100k+ rows |
| **Local DB** | SQLite via [rusqlite](https://github.com/rusqlite/rusqlite) | User settings, saved queries, workspace state |

---

## Development

### Prerequisites
- [Rust](https://rustup.rs) (latest stable)
- [Bun](https://bun.sh) (or Node.js + npm)
- Tauri system dependencies ([see guide](https://tauri.app/start/prerequisites/))
- PostgreSQL client tools (`pg_dump`, `pg_restore`) for admin features

### Setup

```bash
# Clone
git clone https://github.com/adrianbonpin/gridline.git
cd gridline

# Install frontend dependencies
bun install

# Run in development mode (hot-reload)
bun run tauri dev

# Build for production
bun run tauri build
```

### Project Structure

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

### Architecture

```
┌──────────────────────────────────────────────────┐
│                    Tauri Shell                     │
│  ┌─────────────────┐   ┌────────────────────────┐ │
│  │   React (WebView)│   │     Rust Backend       │ │
│  │                  │   │                        │ │
│  │  • Monaco Editor │◄──►│ • sqlx/tokio-postgres  │ │
│  │  • Glide Grid    │IPC│ • Connection pool      │ │
│  │  • Tailwind UI   │   │ • pg_dump/restore      │ │
│  │  • Zustand state │   │ • SQLite (local)       │ │
│  │                  │   │ • OS Keychain          │ │
│  └─────────────────┘   └────────────────────────┘ │
└──────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │  PostgreSQL / MySQL  │
              │  SQLite / Redis      │
              └─────────────────────┘
```

---

## Roadmap

1. **Phase 1 — Core Shell & Storage**
   - [x] Tauri 2.0 + React project scaffold
   - [ ] SQLite persistence layer for workspaces, folders, connections, saved queries
   - [ ] Workspace/folder tree UI

2. **Phase 2 — Connection Management**
   - [ ] Rust connection pool manager (`sqlx` / `tokio-postgres`)
   - [ ] URI parser with auto-population
   - [ ] OS Keychain credential storage

3. **Phase 3 — Schema Explorer**
   - [x] PostgreSQL `pg_catalog` / `information_schema` introspection
   - [x] Full object tree (Tables, Views, Functions, Triggers, Enums, Sequences, Extensions)
   - [x] Per-type detail views with source code, arguments, metadata

4. **Phase 4 — Query Workbench**
   - [ ] Monaco Editor integration with SQL autocomplete
   - [x] Virtualized data grid for query results
   - [ ] Query history & saved snippets

5. **Phase 5 — Admin Tools**
   - [x] `pg_dump` / `pg_restore` UI wrappers
   - [x] DB-to-DB schema & data sync

6. **Phase 6 — Multi-Database Support**
   - [ ] MySQL driver
   - [ ] SQLite driver
   - [ ] Redis support

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

<p align="center">
  <sub>Built with ♥ for developers who believe powerful tools should be free.</sub>
</p>