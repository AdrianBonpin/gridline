export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: "0.7.12",
    date: "2026-09-01",
    highlights: [
      "Reliable cell editing for non-text columns — editing a PostgreSQL cell whose type isn't text (integers, booleans, UUIDs, json/jsonb, timestamps, enums, numerics) now works; edited values are sent to PostgreSQL in text wire format so the server parses them into the column's own type.",
      "Recent connections fix — the Recent strip no longer renders empty on first launch when the connections list hadn't loaded yet.",
      "Full CI release pipeline for Windows — the self-hosted Windows runner now builds the .exe/.msi installers (bundled pg_dump/pg_restore/psql + MariaDB clients) and uploads them to the release alongside Linux.",
    ],
  },
  {
    version: "0.7.10",
    date: "2026-08-13",
    highlights: [
      "Copy connection URL from the connection card menu — with or without the password (password fetched from your OS keychain on demand, percent-encoded, sslmode appended for PostgreSQL).",
      "First-launch documentation improvements for macOS (Gatekeeper / quarantine instructions).",
    ],
  },
  {
    version: "0.7.9",
    date: "2026-08-08",
    highlights: ["Fix macOS launch issues on Apple Silicon."],
  },
  {
    version: "0.7.8",
    date: "2026-08-08",
    highlights: [
      "MySQL & SQLite backup and restore — SQLite `.dump` portability plus mysqldump for MySQL, matching the pg_dump UX.",
      "DB-to-DB sync extended beyond PostgreSQL (MySQL & SQLite).",
      "Excel (.xlsx) export alongside JSON / CSV / SQL / Markdown.",
      "Cancel long-running queries from the toolbar (pg_cancel_backend / MySQL KILL / SQLite interruption).",
      "Settings export/import (theme, accent, editor options, page sizes, defaults).",
      "Windows/Linux title-bar fix — native title bar for dragging, macOS keeps the overlay drag strip.",
      "Visual Create Table / Edit Table extended to SQLite (SQLite-aware type mapping and ALTER TABLE limits).",
    ],
  },
  {
    version: "0.7.7",
    date: "2026-08-07",
    highlights: [
      "PostgreSQL roles & grants — create/edit/drop roles, per-role privilege explorer grouped by object class, and GRANT/REVOKE staging with WITH GRANT OPTION.",
      "Table maintenance — right-click any table for VACUUM / ANALYZE / REINDEX.",
      "Visual Create Table editor — columns grid with type dropdowns, drag-to-reorder, single & composite primary keys, live SQL preview.",
      "Edit Table as a robust column diff — ADD/DROP/RENAME/ALTER TYPE/SET|DROP DEFAULT/SET|DROP NOT NULL staged one per queue item, with a stale-write guard.",
      "Atomic column-reorder table rebuild — single transaction, preserves constraints/indexes/FKs/grants/sequences, fail-closed for triggers/RLS/partitioning.",
      "Foreign keys — multi-column FK composer, cross-schema references, ON DELETE / ON UPDATE actions, edit/remove from the form.",
      "Table options — tablespace picker and row-level security toggle.",
      "Fixes: rolconnlimit cast, aclexplode-based privilege queries (works on PG 15+), auto schema-tree refresh after schema-modifying commits.",
    ],
  },
  {
    version: "0.7.6",
    date: "2026-08-06",
    highlights: [
      "PostgreSQL object management CRUD — right-click / ⋮ create, edit, and drop every PG object type, opened as workspace tabs with a Visual ⇄ SQL toggle and staged through the changes queue with generated-SQL preview.",
      "Objects view now uses the shared tabbed workspace — object details open as tabs, plus an inline manual query tab.",
      "Keychain toggle (default ON) — opt out to keep DB passwords session-only and purge existing keychain entries; SSH secrets stay keychain-only.",
    ],
  },
  {
    version: "0.7.5",
    date: "2026-08-05",
    highlights: [
      "Bundled PostgreSQL client tools — pg_dump, pg_restore, and psql ship as Tauri resources with system-first, bundled-fallback resolution.",
      "Schema CRUD — create, rename, and drop schemas from the object tree with CASCADE-drop typed-name confirmation and a dependency warning.",
      "Global object search (Cmd+K) — current-schema scope across all object types; results open a table tab or jump to the Objects view.",
      "Copy as DDL for any object — CREATE DDL for every browsable type (tables via pg_dump, pg_get_*def passthrough, synthesized sequences/enums/extensions/views).",
      "Object dependencies — a pg_depend “what depends on this?” view shown before destructive drops (table, schema).",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-08-04",
    highlights: [
      "Revamped New Connection screen — two-stage entry: paste a connection URI or pick from a 6-card provider grid (PostgreSQL / MySQL / SQLite / Redis / Supabase / NeonDB), then configure label, tags, environment, folder, and General | SSH·SSL tabs.",
      "MySQL DB viewer — connect (SSL + SSH tunnel), browse databases/tables/columns/FKs, query with pagination, inline cell editing with a changes queue, DDL copy, CSV/JSON import.",
      "SQLite connection via file-path picker instead of a URI field.",
      "DB viewer capability gating — per-database-type feature matrix; Redis browsing gated with a clean “not supported” state.",
      "Schema/database selector loading states, table toolbar renders during load, tag overflow scroll on connection cards.",
    ],
  },
];
