//! OS-delivered "open this .sql file with Gridline" requests.
//!
//! Every platform funnels into [`accept_path`], which validates strictly and
//! queues the path. The frontend only ever calls [`take_pending_sql_files`],
//! which takes **no path argument** and drains what was queued — so the webview
//! cannot name a file to read. That is the boundary that keeps this feature
//! from becoming an arbitrary-filesystem-read primitive and defeating the
//! deliberate `fs` scope (spec §2).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Editor-load cap. A larger script is routed to Tools → Restore instead of
/// being handed to Monaco (spec §2).
pub const MAX_SQL_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// A validated open request, delivered to the frontend with its contents.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSqlFile {
    pub path: String,
    pub name: String,
    pub content: String,
}

/// Process-wide FIFO of accepted paths. Lives in Rust (not the webview) so a
/// window reload cannot lose an open request.
#[derive(Default)]
pub struct PendingOpenFiles(Mutex<Vec<PathBuf>>);

/// Strict validation. Fail closed: anything we are not certain about is
/// rejected rather than opened (spec §6).
pub fn validate_sql_path_with_cap(raw: &str, cap: u64) -> Option<PathBuf> {
    let path = Path::new(raw);

    // Absolute only — the OS always hands us absolute paths, and accepting a
    // relative one would resolve against the process CWD. Note the app is
    // often launched with CWD `/` (see the app-data-dir note in lib.rs).
    if !path.is_absolute() {
        return None;
    }

    let ext = path.extension()?.to_str()?;
    if !ext.eq_ignore_ascii_case("sql") {
        return None;
    }

    // symlink_metadata, not metadata: a symlink must not be followed into an
    // arbitrary target (and `file_type().is_file()` is false for one).
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    if meta.len() > cap {
        return None;
    }
    Some(path.to_path_buf())
}

/// Validate against the production cap.
pub fn validate_sql_path(raw: &str) -> Option<PathBuf> {
    validate_sql_path_with_cap(raw, MAX_SQL_FILE_BYTES)
}

/// Queue an OS-supplied path. Returns `true` when it was newly queued, so
/// callers can decide whether a nudge event is worth emitting.
pub fn accept_path(buffer: &PendingOpenFiles, raw: &str) -> bool {
    let Some(path) = validate_sql_path(raw) else {
        return false;
    };
    let mut queue = buffer.0.lock().unwrap();
    if queue.iter().any(|p| p == &path) {
        return false;
    }
    queue.push(path);
    true
}

/// Read and remove everything queued. Separated from the command so it is
/// testable without a Tauri `State`.
pub fn take_from_buffer(buffer: &PendingOpenFiles) -> Result<Vec<PendingSqlFile>, String> {
    let drained: Vec<PathBuf> = {
        let mut queue = buffer.0.lock().unwrap();
        std::mem::take(&mut *queue)
    };

    drained
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());
            // Fail closed on undecodable bytes rather than guessing an
            // encoding for the user's SQL.
            let bytes =
                std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", name))?;
            let content =
                String::from_utf8(bytes).map_err(|_| format!("{name} is not valid UTF-8"))?;
            Ok(PendingSqlFile {
                path: path.to_string_lossy().into_owned(),
                name,
                content,
            })
        })
        .collect()
}

/// Drain every queued open request. The only file-reading command the webview
/// can call — deliberately argument-free (see the module docs).
#[tauri::command]
pub fn take_pending_sql_files(
    state: State<'_, PendingOpenFiles>,
) -> Result<Vec<PendingSqlFile>, String> {
    take_from_buffer(&state)
}

#[cfg(test)]
#[path = "open_files.test.rs"]
mod open_files_tests;
