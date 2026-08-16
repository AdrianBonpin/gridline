# Bundled MariaDB client tools

Static `mariadb-dump` and `mariadb` client binaries (wire-compatible with MySQL
servers) go here. They are NOT committed — `.github/workflows/release.yml`
builds and checksum-verifies them per matrix target, copying the result into
`resources/mysql_tools/{mariadb-dump,mariadb}` (plus `mariadb-dump.exe` /
`mariadb.exe` and the runtime `libmariadb.dll` on Windows). The app resolves
tools system-first and falls back to these bundled binaries (see
`backup::resolve_mysql_tool`).

In `tauri dev`, this dir is usually empty — the app falls back to any
`mariadb-dump`/`mariadb` on `PATH` (system-first resolution). MySQL
backup/restore degrades with a clear error if neither is present.
