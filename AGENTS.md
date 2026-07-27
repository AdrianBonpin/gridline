# AGENTS.md

Guidance for AI coding agents working on **Gridline**.

---

## Project Identity

Gridline is an **open-source, cross-platform database GUI client** for PostgreSQL (with MySQL, SQLite, and Redis to follow). It is built as a **Tauri 2.0 desktop app** — a lightweight native shell (~40MB baseline) around a React web frontend, with a Rust backend handling all database operations, CLI tool orchestration, and local persistence.

**Core differentiators from commercial alternatives (DB Pro, TablePlus, etc.):**
- No paywalls — unlimited tabs, connections, and saved queries by default
- First-class PostgreSQL administration: `pg_dump`, `pg_restore`, DB-to-DB sync
- Full object explorer: Functions, Triggers, Sequences, Enums, Extensions — not just tables

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
├── src/                          # React frontend (TypeScript)
│   ├── components/               # Reusable UI components
│   │   ├── layout/               # App shell, sidebar, tabs
│   │   ├── editor/               # Monaco wrapper, autocomplete
│   │   ├── grid/                 # Data grid, filters, export
│   │   ├── tree/                 # Workspace/object explorer tree
│   │   └── ui/                   # Primitives (buttons, modals, inputs)
│   ├── stores/                   # Zustand/Jotai stores
│   ├── hooks/                    # Custom hooks (useConnection, useQuery, etc.)
│   ├── lib/                      # Utilities, types, Tauri bindings
│   │   ├── commands.ts           # Typed wrappers around Tauri invoke()
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   └── utils.ts              # Formatting, validation helpers
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                 # Tailwind directives + custom theme tokens
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Binary entry point
│   │   ├── lib.rs                # Tauri builder, command registration
│   │   ├── db/                   # Connection pooling, query execution
│   │   │   ├── mod.rs
│   │   │   ├── pool.rs           # Connection pool manager
│   │   │   └── introspection.rs  # Schema/system catalog queries
│   │   ├── commands/             # Tauri #[tauri::command] handlers
│   │   │   ├── mod.rs
│   │   │   ├── connections.rs    # CRUD for saved connections
│   │   │   ├── query.rs          # SQL execution
│   │   │   ├── schema.rs         # Object tree introspection
│   │   │   ├── backup.rs         # pg_dump / pg_restore wrappers
│   │   │   └── workspace.rs      # Workspace/folder persistence
│   │   ├── models/               # Serde structs shared across commands
│   │   │   ├── mod.rs
│   │   │   ├── connection.rs
│   │   │   ├── query.rs
│   │   │   └── workspace.rs
│   │   └── store/                # SQLite local persistence layer
│   │       ├── mod.rs
│   │       └── migrations.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/             # Tauri capability permissions
├── public/                       # Static frontend assets
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
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
bun install              # Install frontend dependencies
bun run dev              # Vite dev server only (no Tauri)
bun run tauri dev        # Full Tauri app with hot-reload
bun run tauri build      # Production build
cargo build              # Rust backend only (from src-tauri/)
cargo test               # Rust tests
```

### Adding a Tauri Command

1. Define the command function in the appropriate `src-tauri/src/commands/` module
2. Register it in `src-tauri/src/lib.rs` via `.invoke_handler(tauri::generate_handler![...])`
3. Create a typed wrapper function in `src/lib/commands.ts`
4. Call the wrapper from your React component/store

### Adding a New Dependency

- **Frontend:** `bun add <package>` (runtime) or `bun add -d <package>` (dev)
- **Rust:** Add to `src-tauri/Cargo.toml` under `[dependencies]`

### Testing Strategy

- **Rust:** Unit tests for database logic, connection pool management, and command handlers. Use `sqlx::test` with a test PostgreSQL instance for integration tests.
- **Frontend:** Vitest + React Testing Library for component tests. Focus on store logic, command wrappers, and critical UI flows (connection form, query execution).
- **E2E:** (Future) Tauri WebDriver or Playwright for critical paths.

---

## Constraints & Guardrails

- **Do NOT** implement `pg_dump` file format parsing — always shell out to system binaries
- **Do NOT** store passwords in SQLite or local files — use OS keychain APIs exclusively
- **Do NOT** render large query results in raw DOM — always use the virtualized grid component
- **Do NOT** log credentials, connection strings, or query data
- **Do NOT** introduce Electron, Node.js server processes, or Docker dependencies
- **Do NOT** execute data-modifying SQL (INSERT, UPDATE, DELETE, DROP, ALTER) directly — always push to the changes queue first and require explicit user confirmation via "Commit All"
- **DO** keep Tauri commands thin — business logic lives in `db/` and `store/` modules
- **DO** type all IPC boundaries explicitly
- **DO** validate and sanitize all user-provided SQL and connection parameters before execution

---

## Related Documents

- [Tauri 2.0 Documentation](https://tauri.app/develop/)
- [sqlx Documentation](https://docs.rs/sqlx)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/)
- [Project README](./README.md)
- [Feature Specification](./README.md#features)

---

*This file is read by AI coding agents (Claude, Cursor, Copilot, etc.) to understand project conventions and architecture before making changes. Keep it current as the project evolves.*