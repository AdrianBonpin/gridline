export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: "0.8.2",
    date: "2026-09-29",
    highlights: [
      "MySQL columns now show their values. Every non-string MySQL type was decoding to NULL, so `id`/integer columns looked empty in the grid and the query editor — and it was not only integers: `DECIMAL`, `BIT`, `YEAR`, `DATE`, `TIME`, `DATETIME`, `DATETIME(6)`, `TIMESTAMP`, `FLOAT` and `DOUBLE` were affected too (21 of 30 types). Decoding is now driven by each column's declared type instead of a guess, 64-bit integers and `DECIMAL` travel as strings so no digits are lost, and `DATETIME(6)` keeps its microseconds. Temporal values are shown as stored, never silently shifted into another time zone.",
      "MySQL restore now works against MySQL 8. It used to shell out to a bundled MariaDB client, which cannot authenticate with MySQL 8's default `caching_sha2_password`, so restore failed with `ERROR 1045` (or `ERROR 2026` once TLS was involved) while browsing worked fine. Restore now runs in-process over the same driver that browsing uses: it stops at the first error and tells you which statement failed, it can be cancelled, and it understands the `DELIMITER` directive so dumps containing triggers and stored routines apply correctly. The **Clean** toggle is now real — it drops only the objects the dump recreates, so an unrelated table in the target survives — and because MySQL DDL commits as it runs, the form warns that a failed restore cannot be rolled back.",
      "`.sql` files can be opened with Gridline straight from your file manager. Right-click a script → Open With → Gridline (it appears as an alternate handler, so your default for `.sql` is left alone) and it opens in a query tab named after the file. Opening never executes anything — Run still goes through the destructive-query confirmation — and re-opening the same file focuses the existing tab without discarding edits. If no connection is open, the script is held and Home prompts you to pick one, so a double-click never dead-ends.",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-09-24",
    highlights: [
      "Managed-provider connections fixed — pasting a Neon / Supabase / PlanetScale connection string now carries its `?sslmode=` into the saved connection (it was silently dropped, so TLS stayed off and Neon answered `connection is insecure (try using sslmode=require)`). The SSH / SSL tab's mode and certificate paths are now persisted on create *and* edit, and the managed presets pre-select their TLS mode (Supabase / Neon → Require, PlanetScale → Verify Full). As a safety net, hosts under `*.neon.tech` / `*.supabase.co` / `*.psdb.cloud` default to `require` when a connection has no stored mode, so connections saved before this fix keep working.",
      "Pasting a connection URI fills every setting it can — type, host, port, user, password, database and TLS mode — and suggests a name from the URL (database name, else host), which Test and Save use when the label is left blank. A pasted URL can now be tested and saved with no retyping.",
      "macOS keychain prompts now self-heal — an item whose ACL still points at an older binary path (the pre-monorepo `src-tauri/` layout, a reinstalled app, an ad-hoc dev build) made macOS ask for your keychain password on *every* access, once per secret, with no way to make it stick. The app now checks the item's ACL (silently) before reading and repairs it when needed, so you authorize a secret once and it stays silent afterwards.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-09-09",
    highlights: [
      "Schema diff / compare — pick a source connection of the same engine family and diff it against the current one: added/removed/changed tables, columns, constraints, indexes, views, sequences, and enums, each with generated same-dialect sync SQL. Non-destructive items stage into the changes queue; destructive changes (DROPs, ALTER TYPE) are copy-only with a warning.",
      "Multiple result sets — run a script and see every statement's results stacked in order, with affected-count notices for DML/DDL and a stop-at-first-error card that keeps prior results visible.",
      "Export all rows to file — stream the full result of any query (no page limit, constant memory) to CSV, JSONL, or JSON, with progress and cancel.",
      "MariaDB — first-class database type: provider card, type filter, connection URL copy/paste, and full viewer/editing/import/backup parity with MySQL.",
      "TimescaleDB — hypertables surface in the Objects view on PostgreSQL connections with the extension installed: dimensions, compression status, chunk count, and size.",
      "PlanetScale preset — managed MySQL (Vitess) provider card with a researched setup guide and .psdb.cloud host detection.",
    ],
  },
  {
    version: "0.7.15",
    date: "2026-09-08",
    highlights: [
      "Insert Row now works — it adds an editable pending row at the top of the data grid (with a visible accent outline), and committing inserts only the columns you filled in so serial/identity/generated defaults apply.",
      "Smart cell editors — date/time/datetime pickers, a boolean select, and number inputs for the matching column types (enums and foreign keys already had dropdowns), applied to both new rows and inline editing.",
      "Landing page adds a support channel: coffee via Ko-fi (ko-fi.com/adrianbonpin), always optional, never gates a feature.",
      "Landing page copy refreshed: em dashes dropped, OSS section simplified, FAQ added for how the project is funded.",
    ],
  },
  {
    version: "0.7.14",
    date: "2026-09-04",
    highlights: [
      "No more repeated macOS keychain prompts — saved connection passwords and SSH secrets are now ACL-pinned to the app's code signature when stored, so app upgrades never re-trigger the macOS keychain access dialog (users upgrading from older builds see one final prompt — choose Always Allow).",
      "Install via Homebrew — add the Homebrew tap (brew tap AdrianBonpin/gridline https://github.com/AdrianBonpin/homebrew-gridline.git) and run brew install --cask gridline.",
    ],
  },
  {
    version: "0.7.13",
    date: "2026-09-04",
    highlights: [
      "macOS is now Developer-ID signed and notarized — the app is properly code-signed with a Developer ID Application certificate and notarized by Apple, so macOS opens it without the Gatekeeper 'Open Anyway' prompt or the xattr quarantine workaround.",
    ],
  },
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
