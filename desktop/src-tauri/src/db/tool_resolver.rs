//! Unified, headless external-client-tool resolver shared by the PostgreSQL
//! and MySQL backup/restore/sync paths.
//!
//! Fixes issue #44: bundled tools live under `resource_dir/resources/<subdir>/`
//! (Tauri preserves the `resources/` component from `tauri.conf.json`), not
//! directly under `resource_dir/`. System lookup is ordered — trusted absolute
//! directories first, then the inherited PATH, then bundled — and probes both
//! `mariadb-dump`/`mysqldump` style names.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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

/// Maps a MySQL tool name to its request; `None` for unknown names.
pub fn mysql_request(tool: &str) -> Option<ToolRequest> {
    match tool {
        "mariadb-dump" | "mysqldump" => Some(mysql_dump_request()),
        "mariadb" | "mysql" => Some(mysql_client_request()),
        _ => None,
    }
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

/// Per-probe timeout. `--version` returns in milliseconds; this only guards a
/// pathological binary.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
/// Aggregate deadline for one detection pass across all candidates.
pub const AGGREGATE_DEADLINE: Duration = Duration::from_secs(3);

/// Run `<program> --version` with a bounded wait. The child's stdio is
/// discarded — output is read separately by `version_of`.
pub fn run_version(program: &Path, timeout: Duration) -> bool {
    let mut cmd = Command::new(program);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => {
                let _ = child.kill();
                return false;
            }
        }
    }
}

/// A tool candidate counts only when it is a regular file AND runs.
pub fn probe(program: &Path) -> bool {
    program.is_file() && run_version(program, PROBE_TIMEOUT)
}

/// A probe that stops running anything once the aggregate deadline is crossed.
pub fn probe_within(start: Instant, deadline: Duration, program: &Path) -> bool {
    if start.elapsed() >= deadline {
        return false;
    }
    probe(program)
}

/// Ordered, injectable resolution.
///
/// 1. every trusted absolute directory, for each candidate name in order;
/// 2. the inherited `PATH`, for each candidate name in order;
/// 3. the bundled binary.
///
/// `probe_fn` decides whether a candidate is runnable, so tests never touch
/// the real filesystem. The aggregate deadline is enforced by the caller's
/// `probe_fn` (see `probe_within`).
pub fn resolve_with<F>(
    request: &ToolRequest,
    trusted: &[PathBuf],
    path_lookup: &dyn Fn(&str) -> Option<PathBuf>,
    bundled: Option<&Path>,
    mut probe_fn: F,
) -> Option<Resolution>
where
    F: FnMut(&Path) -> bool,
{
    for dir in trusted {
        for name in &request.names {
            let candidate = dir.join(bundled_bin_name(name));
            if probe_fn(&candidate) {
                return Some(Resolution {
                    program: candidate.to_string_lossy().to_string(),
                    source: ToolSource::TrustedDir,
                    name: (*name).to_string(),
                });
            }
        }
    }

    for name in &request.names {
        if let Some(found) = path_lookup(name) {
            if probe_fn(&found) {
                return Some(Resolution {
                    program: found.to_string_lossy().to_string(),
                    source: ToolSource::Path,
                    name: (*name).to_string(),
                });
            }
        }
    }

    if let Some(bundled) = bundled {
        if probe_fn(bundled) {
            let name = bundled
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| request.bundled_name().to_string());
            return Some(Resolution {
                program: bundled.to_string_lossy().to_string(),
                source: ToolSource::Bundled,
                name,
            });
        }
    }

    None
}

/// Read the first non-empty line of `<program> --version` (stdout, else stderr).
pub fn version_of(program: &str) -> Option<String> {
    let out = Command::new(program).arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Some(stdout);
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if stderr.is_empty() { None } else { Some(stderr) }
}

/// Lenient major-version extraction. Scans for numeric groups, unwraps the
/// legacy MariaDB `5.5.5-<real>-MariaDB` compatibility prefix, and returns
/// `None` when there is no number at all.
pub fn parse_major(version: &str) -> Option<u32> {
    let mut nums: Vec<u32> = Vec::new();
    let mut cur = String::new();
    for ch in version.chars() {
        if ch.is_ascii_digit() {
            cur.push(ch);
            continue;
        }
        if !cur.is_empty() {
            nums.push(cur.parse::<u32>().ok()?);
            cur.clear();
            // `6` is the only magic number here: it caps how many groups an
            // adversarial/advertising version string can make us collect
            // (we only ever read the first four).
            if nums.len() == 6 {
                break;
            }
        }
    }
    if !cur.is_empty() {
        if let Ok(n) = cur.parse::<u32>() {
            nums.push(n);
        }
    }
    if nums.is_empty() {
        return None;
    }
    if nums.len() >= 4 && nums[0] == 5 && nums[1] == 5 && nums[2] == 5 {
        return Some(nums[3]);
    }
    Some(nums[0])
}

/// Client/server version relationship. Advisory only — never an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compat {
    Ok,
    /// The client's major version is below the server's.
    ClientOlder,
    /// Either version could not be parsed.
    Unknown,
}

pub fn compat(client: Option<u32>, server: Option<u32>) -> Compat {
    match (client, server) {
        (Some(c), Some(s)) if s > c => Compat::ClientOlder,
        (Some(_), Some(_)) => Compat::Ok,
        _ => Compat::Unknown,
    }
}

/// Non-blocking warning text, or `None` when there is nothing to say.
pub fn warning_for(client_version: &str, server_version: &str, client_name: &str) -> Option<String> {
    match compat(parse_major(client_version), parse_major(server_version)) {
        Compat::ClientOlder => Some(format!(
            "Client/server version mismatch: the resolved dump tool `{client_name}` reports {client_version}, \
but the server is {server_version}. The backup may fail or omit data — installing a matching MySQL client is recommended."
        )),
        Compat::Ok | Compat::Unknown => None,
    }
}

/// Everything one detection pass knows about a tool role.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolResolution {
    pub resolved: Option<Resolution>,
    pub bundled_path: Option<PathBuf>,
    /// Whether the bundled file exists — regardless of whether it runs. Lets
    /// the UI say "ships with the app but could not run" instead of "absent".
    pub bundled_available: bool,
    pub version: Option<String>,
}

impl ToolResolution {
    pub fn none() -> Self {
        Self { resolved: None, bundled_path: None, bundled_available: false, version: None }
    }
}

/// Whether a bundled tool file exists at `path`.
pub fn bundled_present(path: &Path) -> bool {
    path.is_file()
}

/// Shape the existing resolver call sites expect: `(command, source)`.
pub fn adapt_resolution(res: &ToolResolution, fallback_name: &str) -> (String, Option<String>) {
    match &res.resolved {
        Some(r) => (r.program.clone(), Some(r.source.as_str().to_string())),
        None => (fallback_name.to_string(), None),
    }
}

// Cache is keyed by `ToolRequest::cache_key()` and holds no secrets.
static CACHE: OnceLock<Mutex<HashMap<String, ToolResolution>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, ToolResolution>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cache_get(key: &str) -> Option<ToolResolution> {
    cache().lock().ok()?.get(key).cloned()
}

pub fn cache_put(key: &str, value: ToolResolution) {
    if let Ok(mut map) = cache().lock() {
        map.insert(key.to_string(), value);
    }
}

pub fn cache_clear() {
    if let Ok(mut map) = cache().lock() {
        map.clear();
    }
}

#[cfg(test)]
#[path = "tool_resolver.test.rs"]
mod tests;
