# Bundled PostgreSQL client tools

This directory is populated **at build time by CI** (`.github/workflows/release.yml`)
with `pg_dump`, `pg_restore`, and `psql` for the current target, built from the
pinned, SHA-256-verified PostgreSQL source release (or the pinned Windows
package) declared in `scripts/tool-inputs.env`. Binaries are NOT committed to
the repo; the build writes `checksums.txt` here and
`scripts/verify-bundled-tools.sh` re-checks that manifest before anything is
uploaded.

In `tauri dev`, this dir is usually empty — the app falls back to any `pg_dump`/`pg_restore`
on `PATH` (system-first resolution). Admin features degrade with a clear error if neither is present.