# Smoke checklist — native MySQL execution (0.8.2)

These flows cannot be automated on this machine: `RunEvent::Opened` only fires
for a bundled `.app` registered with LaunchServices, and a real MySQL 8 restore
needs a live server. Run every box before publishing a draft release.

Build first (both scripts exist — `build` in `desktop/package.json`, the Tauri
CLI via the `tauri` script in `desktop/package.json`):

    bun run --filter gridline-desktop build
    bun run --filter gridline-desktop tauri build

## A. Association and OS open

- [ ] The built `.app` appears under **Finder → right-click a `.sql` file → Open With**.
- [ ] The previous default handler for `.sql` is **unchanged** (rank is Alternate).
      Refresh LaunchServices if it is stale:
      `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Gridline.app`
- [ ] With Gridline **closed**, double-click a `.sql` file → the app launches with a
      query tab named after the file, containing the file's text.
- [ ] With Gridline **running**, open another `.sql` file → a second tab appears
      (no second app instance, and no duplicate of the first tab).
- [ ] Open the **same** file twice → the existing tab is focused; edits in it are NOT reset.
- [ ] With **no connection open**, open a `.sql` file → Home is shown with a banner
      naming the file; after connecting, the tab opens automatically and the banner clears.
- [ ] Open a file larger than 5 MB → nothing opens and no freeze occurs (a file over
      `MAX_SQL_FILE_BYTES` is rejected by the buffer and must be routed to Tools → Restore,
      whose own cap is 100 MB).
- [ ] Open a `.txt` file via Open With → Gridline ignores it (no tab, no error dialog).
- [ ] The notarized `Gridline_0.8.2_*.dmg` still carries the association and still launches.

## B. Cell decoding (issue #41)

- [ ] Connect to a MySQL database and open a table with `INT`/`BIGINT` columns:
      the primary key renders its values, **not** NULL.
- [ ] Columns of type `DECIMAL`, `DATE`, `DATETIME`, `TIMESTAMP`, `FLOAT`, `TINYINT`,
      `BIT` and `YEAR` all render values.
- [ ] Run the reporter's exact statement and confirm the ids are values:
      `SELECT id, uuid, first_name FROM users ORDER BY id;`
- [ ] A `BIGINT` column renders as a string and a `DECIMAL` renders with its exact
      digits (no float rounding).
- [ ] A `VARCHAR` column still renders as before (no regression on the types that worked).

## C. Native restore

- [ ] Tools → Restore against a MySQL 8 server whose user authenticates with
      `caching_sha2_password` (the case the bundled MariaDB client cannot reach):
      the restore completes.
- [ ] The MySQL restore form is usable even when no `mariadb`/`mysql` client is installed.
- [ ] `clean` ON into a **non-empty** target: objects the dump defines are replaced;
      an unrelated table created beforehand **survives**.
- [ ] `clean` OFF into a non-empty target: fails with `table already exists`, and the
      error names the statement position.
- [ ] A dump containing a trigger or stored routine (with `DELIMITER`) restores without
      a syntax error.
- [ ] Cancel a long restore → it stops and reports cancellation rather than running to completion.
- [ ] The form states that a failed MySQL restore cannot be rolled back.

## D. Suite

- [ ] `cd desktop/src-tauri && cargo test --lib` → 0 failures.
- [ ] `cd desktop && bun run test` → 0 failures.
- [ ] `cd desktop && bunx tsc --noEmit` → clean.
