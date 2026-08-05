# Bundled PostgreSQL client tools

This directory is populated **at build time by CI** (`.github/workflows/release.yml`)
with statically-linked `pg_dump`, `pg_restore`, and `psql` for the current target.
Binaries are NOT committed to the repo.

In `tauri dev`, this dir is usually empty — the app falls back to any `pg_dump`/`pg_restore`
on `PATH` (system-first resolution). Admin features degrade with a clear error if neither is present.