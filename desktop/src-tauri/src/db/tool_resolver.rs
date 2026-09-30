//! Unified, headless external-client-tool resolver shared by the PostgreSQL
//! and MySQL backup/restore/sync paths.
//!
//! Fixes issue #44: bundled tools live under `resource_dir/resources/<subdir>/`
//! (Tauri preserves the `resources/` component from `tauri.conf.json`), not
//! directly under `resource_dir/`. System lookup is ordered — trusted absolute
//! directories first, then the inherited PATH, then bundled — and probes both
//! `mariadb-dump`/`mysqldump` style names.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// The nested directory component Tauri injects when copying
/// `bundle.resources`. Pinned by `bundled_prefix_matches_tauri_config_resources`.
pub const BUNDLED_RESOURCE_PREFIX: &str = "resources";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSource {
    /// Found in a fixed, trusted absolute directory.
    TrustedDir,
    /// Found on the inherited `PATH`.
    Path,
    /// Found in the app's bundled resource directory.
    Bundled,
}

impl ToolSource {
    /// The value surfaced to the UI (matches the pre-existing
    /// `"system" | "bundled"` strings).
    pub fn as_str(self) -> &'static str {
        match self {
            ToolSource::TrustedDir | ToolSource::Path => "system",
            ToolSource::Bundled => "bundled",
        }
    }
}

/// A successfully resolved tool: the runnable program plus its provenance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    pub program: String,
    pub source: ToolSource,
    /// The binary name that resolved (`mariadb-dump`, `mysqldump`, …).
    pub name: String,
}

/// One engine + tool role, e.g. the MySQL dump tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRequest {
    /// Resource subdirectory name, e.g. `mysql_tools` / `pg_tools`.
    pub subdir: &'static str,
    /// Candidate binary names, in preference order.
    pub names: Vec<&'static str>,
}

impl ToolRequest {
    pub fn new(subdir: &'static str, names: &[&'static str]) -> Self {
        Self { subdir, names: names.to_vec() }
    }

    /// The bundled binary that ships for this role.
    pub fn bundled_name(&self) -> &'static str {
        self.names[0]
    }

    /// Stable cache key for this role.
    pub fn cache_key(&self) -> String {
        format!("{}::{}", self.subdir, self.names.join(","))
    }
}

/// Platform executable suffix.
pub fn exe_suffix() -> &'static str {
    if cfg!(windows) { ".exe" } else { "" }
}

/// `pg_dump` -> `pg_dump` (POSIX) / `pg_dump.exe` (Windows).
pub fn bundled_bin_name(bin: &str) -> String {
    format!("{bin}{}", exe_suffix())
}

/// Fixed, trusted absolute directories probed before the inherited `PATH`.
/// Windows deliberately returns an empty list (spec §9 Q5): PATH + bundled only.
pub fn trusted_dirs() -> Vec<PathBuf> {
    let raw: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/opt/homebrew/bin",
            "/opt/homebrew/opt/mysql-client/bin",
            "/opt/homebrew/opt/mariadb/bin",
            "/opt/homebrew/opt/libpq/bin",
            "/usr/local/bin",
            "/usr/local/opt/mysql-client/bin",
            "/usr/local/opt/mariadb/bin",
            "/usr/local/opt/libpq/bin",
            "/opt/local/bin",
            "/Applications/Postgres.app/Contents/Versions/latest/bin",
        ]
    } else if cfg!(target_os = "linux") {
        &["/usr/bin", "/usr/local/bin", "/usr/local/mysql/bin", "/opt/mysql/bin"]
    } else {
        &[]
    };
    raw.iter().map(PathBuf::from).collect()
}

pub fn pg_dump_request() -> ToolRequest { ToolRequest::new("pg_tools", &["pg_dump"]) }
pub fn pg_restore_request() -> ToolRequest { ToolRequest::new("pg_tools", &["pg_restore"]) }
pub fn psql_request() -> ToolRequest { ToolRequest::new("pg_tools", &["psql"]) }

/// Maps a PostgreSQL tool name to its request; `None` for unknown names.
pub fn pg_request(tool: &str) -> Option<ToolRequest> {
    match tool {
        "pg_dump" => Some(pg_dump_request()),
        "pg_restore" => Some(pg_restore_request()),
        "psql" => Some(psql_request()),
        _ => None,
    }
}

/// MySQL dump role: system `mariadb-dump` -> system `mysqldump` -> bundled.
pub fn mysql_dump_request() -> ToolRequest {
    ToolRequest::new("mysql_tools", &["mariadb-dump", "mysqldump"])
}

/// MySQL client role (used by sync as the restore target).
pub fn mysql_client_request() -> ToolRequest {
    ToolRequest::new("mysql_tools", &["mariadb", "mysql"])
}

/// The bundled binary path for a role. Note the nested
/// `BUNDLED_RESOURCE_PREFIX` component — this is the issue #44 fix.
pub fn bundled_tool_path(resource_dir: &Path, subdir: &str, bin: &str) -> PathBuf {
    resource_dir
        .join(BUNDLED_RESOURCE_PREFIX)
        .join(subdir)
        .join(bundled_bin_name(bin))
}

/// Locate `name` on a `PATH`-shaped value without invoking a shell.
pub fn path_lookup_in(name: &str, path_var: &OsStr) -> Option<PathBuf> {
    let file = bundled_bin_name(name);
    for dir in std::env::split_paths(path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Locate `name` on the inherited `PATH`.
pub fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    path_lookup_in(name, &path_var)
}

#[cfg(test)]
#[path = "tool_resolver.test.rs"]
mod tests;
