export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: "0.9.0",
    date: "2026-11-22",
    highlights: [
      "SSH host keys are verified before your credentials are sent, not after. A host you have connected to before verifies silently; a host Gridline has never seen pauses and asks you to accept its fingerprint once, which is remembered (non-standard ports included); a host whose key has changed fails closed and shows both the expected and the actual fingerprint. Replacing that trust is a separate, deliberate re-enrollment action — there is no inline override in the authentication error path — and the trust records contain no credentials, so no password, key or passphrase can reach a server whose identity has not been checked.",
      "A TLS mode Gridline does not recognise is now an error instead of a silent downgrade to plaintext. Only the supported modes are accepted — at save, at import and at connect — and the message names the valid set, so a typo or an imported `ssl_mode` from another tool can no longer connect with no TLS at all. Certificate verification through an SSH tunnel validates the original database hostname rather than the loopback endpoint the tunnel binds, so `verify-ca` and `verify-full` keep their meaning over a tunnel; MySQL, which cannot verify the hostname through a tunnel, refuses `verify-full` there instead of quietly weakening it.",
      "File access goes through File Grants. Backup output, restore input, streamed exports, CSV/JSON imports, settings import/export and connection transfer still open the normal native picker, but what comes back is a backend-issued grant scoped to one intent that expires five minutes after the selection and is used up by the first job that consumes it. A path the interface displays authorises nothing, so a bug or a compromise in the webview cannot name a file for the backend to read or write; a second file operation means selecting the file again, and an expired, already-used or wrong-intent grant produces a visible state with a recovery action rather than a fallback to the raw path. Output is written to a temporary sibling and only then published, so a failed export or dump removes its partial file and leaves any prior destination intact.",
      "A SQLite table rebuild is one transaction or no change at all, and it reproduces the table rather than approximating it. The create-copy-drop-rename script runs inside a single transaction with foreign-key enforcement suspended around it and `PRAGMA foreign_key_check` required before commit, so a failure restores the original table with no temporary file and no lost rows. Every clause the column editor does not model is carried over from the stored `CREATE TABLE` — `CHECK`, `COLLATE`, `REFERENCES` with their actions, named and composite `PRIMARY KEY`/`UNIQUE`/`FOREIGN KEY`, expression defaults, generated columns, `WITHOUT ROWID`/`STRICT` — and indexes, triggers and the `AUTOINCREMENT` sequence are recreated, so ids the table already issued are never handed out again. The script is read back and checked against the live table before the first mutating statement: an object it would not reproduce, or a shape it cannot represent (a virtual table, an unreadable definition, a generated expression naming a dropped column), refuses the whole change in the editor with Stage disabled. Values are copied by Column Identity, so a reorder moves no data, and a rename is staged only when you rename a column — adding, removing or moving one is never read as a rename.",
      "An edit or delete now changes exactly the row you selected, or nothing. Row Identity uses every primary-key column, so a composite key can no longer match its sibling rows, and a backend row locator is used only for a table with no primary key — never as a visible or exported column. The write runs in a transaction that commits only when exactly one row matched: zero or multiple matches roll back, so a reported failure can never conceal a durable change. The original value of the edited column travels with the write as an optimistic check, so another session's intervening change is reported as a conflict instead of being overwritten. Pending changes stay grouped by their Change Origin — the saved connection, database and target configuration they were staged against — so work staged in one environment cannot be committed into another, and each origin's queue reappears when you return to it.",
      "PostgreSQL restores are transactional whenever the dump allows it (`pg_restore --single-transaction`, or `psql --single-transaction` for a plain script), so a statement failure rolls the target back instead of leaving it half-replaced. A dump that cannot be atomic is identified before it runs — a bounded scan that skips comments, `COPY` data and dollar-quoted bodies, and looks for `VACUUM`, `CREATE`/`DROP DATABASE`, `CREATE`/`DROP TABLESPACE`, `ALTER SYSTEM`, `CREATE SUBSCRIPTION`, `CLUSTER`, `CONCURRENTLY` indexes, a psql `\\connect` or its own `BEGIN`/`COMMIT` — and only runs after you explicitly accept the partial-application risk the form states; an incompatibility that only appears at execution time still rolls back and explains the next step. A restore that is waiting on a lock is terminated after 60 seconds of continuous waiting (a large, progressing restore is never killed) and the failure names the wait instead of the tool's 'terminating connection' symptom, and in DB Sync a target failure is reported as the primary error rather than the broken source pipe it caused.",
      "MySQL restores read the dump as MySQL writes it and clean exactly what the dump recreates. Statement splitting honours backslash and doubled-quote escapes, `#` and `--` comments, `/*! … */` executable comments and `DELIMITER` directive bodies, and a quoted object name containing a dot stays one name instead of becoming schema plus table; the splitter borrows from the one buffer read from disk, so a dump at the 100 MB limit peaks around 150 MB of memory instead of several hundred. Clean drops only the tables, views, procedures, functions, triggers and events the dump recreates — an unrelated table in the target survives — and the replay is refused before anything runs if the dump would write outside the selected database (`USE otherdb`, or a schema-qualified `CREATE`/`DROP`), because replaying that verbatim restored nothing while the clean plan dropped the same-named object inside the target. The metadata-lock wait is bounded too, at 60 seconds instead of the server's one-year default.",
      "A SQLite dump is taken from one consistent snapshot, and it is either lossless or refused. Every table in the dump is read from the same snapshot, a row or metadata decode failure fails the backup instead of quietly dropping rows, the connection's own file cannot be chosen as the destination, and the dump is published atomically — a failure leaves any existing destination untouched. Values SQLite can store but a naive dump loses are preserved through a round trip or rejected before publication: invalid-UTF-8 `TEXT`, `BLOB`s, non-finite `REAL`s, sequence state, `user_version` and `application_id`.",
      "Every place SQL can be sent from applies the same rules. Run, toolbar re-run, history and saved-query runs, pagination, refresh and export all go through one guarded path (an ad-hoc query tab is excluded from table auto-refresh timers, so edited but unreviewed SQL cannot execute on a hidden timer), and classification reads the whole script: comments, `/*! … */` executable comments, data-modifying CTEs, `EXPLAIN` forms and unknown verbs are recognised, and an uncertain verb prompts rather than being assumed safe. Export is validated in the backend against an allowlist of read-only operations and executed under a read-only transaction (query-only for SQLite), so it cannot become an unguarded write path even if the frontend is bypassed. A confirmed destructive request is bound to its tab, Change Origin and exact SQL revision, and the statement runs once per accepted request — no count probe, no re-run on an empty result, no raw fallback — so a `SELECT` with side effects cannot execute twice and a total that cannot be obtained safely is reported as unknown.",
      "Long-running work is owned and cancellable. Backup, restore, sync and export jobs have visible cancellation that terminates the child process tree, quitting during a job takes its children with it, and availability and version probes are bounded and fail visibly instead of waiting on a broken tool. A continuously progressing large job is never killed by a total-duration limit. A slow query, export or schema read on one connection no longer blocks unrelated connections and tabs, and disconnecting closes the pool, the tunnel and the cancellation state together — a failed reconnect leaves the previous working session intact rather than silently breaking it.",
      "Release engineering was reduced to one pipeline with least trust. GitHub Actions is the only release path (the Gitea mirror keeps syncing code and builds nothing), every third-party action is pinned to a commit SHA, each job declares only the token scope it uses, and tag metadata reaches shell steps as data rather than as rendered program text. A macOS build without working signing and notarization credentials fails instead of publishing an ad-hoc artifact, and every macOS asset is verified (`codesign --verify --deep --strict`, hardened runtime, timestamp, stapler, Gatekeeper) before it is uploaded. The bundled PostgreSQL and MariaDB tools come from pinned inputs whose SHA-256 is re-checked on every build, packaged manifests are verified before upload, Homebrew cask rendering validates its version and checksums before it touches the tap, and known dependency advisories were either upgraded or assigned an owner, a rationale and a review date that CI enforces — along with cross-platform compile/test coverage on all four shipped targets.",
      "The Linux support claims now describe what is actually tested. Releases are one build from Ubuntu 22.04 x86_64 repackaged as `.deb`, `.rpm` and `.AppImage`; there is no per-distribution certification and no ARM build, and the README, the landing page and this changelog no longer imply otherwise. The AppImage black-window report ([issue #62](https://github.com/AdrianBonpin/gridline/issues/62)) remains **open**: no cause has been identified, nothing in this release claims to fix it, and Gridline ships no unconditional graphics workaround. What did ship is a diagnostic checklist asking for the exact Fedora release, session type, GPU and driver, terminal output and the result of each documented workaround, so the report can be reproduced from evidence.",
    ],
  },
  {
    version: "0.8.4",
    date: "2026-10-27",
    highlights: [
      "Restore and sync now stop at the first error. A failing statement during a PostgreSQL plain restore used to be skipped while the rest of the script ran, so a broken dump could report success with part of the schema applied; plain restores now run `psql` with `--no-psqlrc` and `-v ON_ERROR_STOP=1`, and archive restores and DB Sync add `pg_restore --exit-on-error`. SQLite clean restore became atomic: the drops and every statement of the dump run inside one `BEGIN IMMEDIATE`, so a malformed or truncated dump rolls back and leaves the target untouched, `VACUUM` / `ATTACH` / `DETACH` statements and empty dumps are rejected before anything is changed, and the target's `foreign_keys` setting is restored on every exit path.",
      "MySQL sync can no longer target the source database, and a failed dump is no longer reported as success. The dump does not emit `--databases` any more — that produced `CREATE DATABASE` / `USE <source>` and could redirect the restore into a schema named after the source — its exit status is checked before the restore's, and its stderr is drained on a thread so a burst of warnings cannot block the pipe. Each endpoint derives its own TLS, and MariaDB connections reach the MySQL tools pages instead of the SQLite ones.",
      "The confirmation dialog examines every statement. `SELECT 1; DROP TABLE demo;` used to run because only the first statement was inspected; it now prompts, and the dialog identifies the statement — *\"Statement 2 of 2 — a schema-modifying statement (DDL).\"* Read statements are allowlisted, writes and DDL prompt, an unrecognised verb prompts rather than being assumed safe, `WITH` chains are classified by their CTE bodies, and a schema-changing script refreshes the object tree however it was run.",
      "SSH tunnels no longer hang. A tunnelled connection could stall once authentication completed: Test connection never returned, and any second connection behind the tunnel waited on a listener that accepted only one client, because two forwarding threads shared one SSH session whose lock made a pending read block the write carrying the client's first packet. One nonblocking worker now drives the session — every client is served concurrently, partially written data is buffered, half-closes are preserved, and clients still stalled mid-authentication or mid-query are closed when the tunnel is released. SSH connect, handshake and authentication are bounded at 10 seconds, the PostgreSQL probe has a 10-second deadline covering TLS, authentication and the version query, and an idle tunnel polls less often. Reported and fixed by [@Amikas](https://github.com/Amikas) in [#57](https://github.com/AdrianBonpin/gridline/pull/57).",
      "Security and release changes: [SECURITY.md](https://github.com/AdrianBonpin/gridline/blob/prod/SECURITY.md) documents private vulnerability reporting through GitHub advisories, pull requests to `prod` run formatting, the Rust tests, the frontend tests and the frontend production build in a read-only workflow, and the Windows MariaDB archive is checksum-verified before it is bundled.",
    ],
  },
  {
    version: "0.8.3",
    date: "2026-09-30",
    highlights: [
      "External tools are found again, and this is the fix for issue #44 — Gridline reported “mysqldump not found” even with the tools installed, for three independent reasons. The bundled binaries were looked up one directory too high (`<resource_dir>/mysql_tools` instead of the `<resource_dir>/resources/mysql_tools` Tauri actually bundles), which silently disabled the bundled fallback for PostgreSQL as well as MySQL; a macOS GUI app inherits launchd's minimal `PATH` rather than your shell's, so Homebrew's `/opt/homebrew/bin` was invisible; and only `mariadb-dump`/`mariadb` were ever probed, never `mysqldump`/`mysql` — which is what `brew install mysql-client` actually installs. Both engines now resolve through one ordered chain: trusted absolute directories (Homebrew, MacPorts, Postgres.app, `/usr/local`), then your inherited `PATH`, then the bundled copy, where a candidate counts only if it is a real file that runs `--version`. Results are cached, and an explicit **Check again** re-detects.",
      "The bundled MySQL client works too. The dump step was passing MySQL-only options to the bundled MariaDB binary (`--databases=<db>`, `--skip-column-statistics`, `--ssl-mode=…`), so the job aborted at option parsing before it ever connected. Options are now tailored per client — MariaDB clients get `--ssl` and a positional `--databases` — so backup and DB sync succeed with either client.",
      "Backup, Restore, DB Sync and Schema Diff now tell you which tool they are using and where it came from (`Using system mysqldump`, `Using bundled mariadb-dump`), say so explicitly when a bundled copy is present but cannot run, and let you copy the install command in one click. A dump client whose major version is older than the server's produces a **non-blocking** warning at job start instead of silence. Those four pages also moved onto the same form layout the Objects view uses.",
      "The app icon is back to its previous rendering — at the maintainer's request the macOS “legacy plate” strip added in #40 was reverted, so the Dock and launcher icon can show a light border again below roughly 72px.",
    ],
  },
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
