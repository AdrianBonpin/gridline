//! OS-delivered "open this .sql file with Gridline" requests.
//!
//! Every platform funnels into [`accept_os_path`], which opens the file, decides
//! from **that already-open file** whether it may be queued, and keeps the
//! handle. The frontend only ever calls [`take_pending_sql_files`], which takes
//! **no path argument** and drains what was queued — so the webview cannot name
//! a file to read. That is the boundary that keeps this feature from becoming an
//! arbitrary-filesystem-read primitive and defeating the deliberate `fs` scope
//! (spec §2).
//!
//! Validation and reading deliberately refer to the same opened file: the
//! extension comes from the path we opened, the regular-file check and the size
//! cap come from that handle's metadata, symlinks are not followed, and the
//! contents are read from the handle — never by re-resolving the path. A path
//! that is replaced between "open with" and the webview draining the queue
//! therefore cannot redirect the read (spec §6).

use std::ffi::OsStr;
use std::io::Read;
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

/// An accepted SQL file, held open from the moment it was validated.
///
/// The handle — not the path — is what gets read later. Holding it also means
/// the file the user asked for is pinned even if it is renamed or deleted
/// before the webview drains the queue.
#[derive(Debug)]
pub struct OpenedSqlFile {
    path: PathBuf,
    file: std::fs::File,
}

impl OpenedSqlFile {
    /// The path that was opened, for display and tab deduplication only.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Process-wide FIFO of accepted files. Lives in Rust (not the webview) so a
/// window reload cannot lose an open request.
#[derive(Default)]
pub struct PendingOpenFiles(Mutex<Vec<OpenedSqlFile>>);

/// Open-then-validate. Fail closed: anything we are not certain about is
/// rejected rather than opened (spec §6).
///
/// The order matters. The file is opened first — without following a symlink
/// and, on Unix, without blocking on a FIFO or device — and every later check
/// is answered by the **opened handle's** metadata. Nothing is read from the
/// path after the open, so there is no window in which the path could be
/// swapped for a different file that passes or bypasses those checks.
pub fn open_sql_file_with_cap(path: &Path, cap: u64) -> Option<OpenedSqlFile> {
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

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // O_NOFOLLOW: a symlink must not be followed into an arbitrary target.
        // O_NONBLOCK: opening a FIFO named `*.sql` would otherwise block the
        // caller forever; a non-blocking open returns the handle, and the
        // regular-file check below rejects it. A regular file is unaffected.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: open the link itself rather than its
        // target, so the symlink check below can refuse it.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).ok()?;

    // Everything below answers from the opened handle, not from `path`.
    let meta = file.metadata().ok()?;
    let file_type = meta.file_type();
    if !file_type.is_file() || file_type.is_symlink() {
        return None;
    }
    if meta.len() > cap {
        return None;
    }

    Some(OpenedSqlFile {
        path: path.to_path_buf(),
        file,
    })
}

/// Open and validate against the production cap.
pub fn open_sql_file(path: &Path) -> Option<OpenedSqlFile> {
    open_sql_file_with_cap(path, MAX_SQL_FILE_BYTES)
}

/// Queue an OS-supplied path. Returns `true` when it was newly queued, so
/// callers can decide whether a nudge event is worth emitting.
///
/// Takes the path as an OS string: Unix argv and file URLs are bytes, and a
/// non-UTF-8 path must be rejected (or accepted) on its own terms rather than
/// round-tripped through a lossy string that names a different file.
pub fn accept_os_path(buffer: &PendingOpenFiles, path: &Path) -> bool {
    let Some(opened) = open_sql_file(path) else {
        return false;
    };
    let mut queue = buffer.0.lock().unwrap();
    if queue.iter().any(|p| p.path() == path) {
        return false;
    }
    queue.push(opened);
    true
}

/// Validate and queue a path that arrived as text (the single-instance
/// plugin's forwarded argv, and tests).
pub fn accept_path(buffer: &PendingOpenFiles, raw: &str) -> bool {
    accept_os_path(buffer, Path::new(raw))
}

/// Queue every path in a process argument list.
///
/// Generic over `AsRef<OsStr>` so startup can pass `std::env::args_os()`: on
/// Unix argv is arbitrary bytes, and `std::env::args()` — which assumes UTF-8 —
/// would panic before the UI exists (spec §6).
pub fn accept_process_args<I, S>(buffer: &PendingOpenFiles, args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut accepted = false;
    for arg in args {
        if accept_os_path(buffer, Path::new(arg.as_ref())) {
            accepted = true;
        }
    }
    accepted
}

fn pending_file(opened: OpenedSqlFile, cap: u64) -> Result<PendingSqlFile, String> {
    let path = opened.path;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    // Read from the handle that was validated, and never more than one byte
    // past the cap: a file that grew after it was accepted is refused instead
    // of being buffered or handed to Monaco.
    let mut bytes = Vec::new();
    (&opened.file)
        .take(cap.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read {}: {e}", name))?;
    if bytes.len() as u64 > cap {
        return Err(format!(
            "{name} is larger than the {cap} byte editor limit; use Tools → Restore instead"
        ));
    }

    // Fail closed on undecodable bytes rather than guessing an encoding for
    // the user's SQL.
    let content = String::from_utf8(bytes).map_err(|_| format!("{name} is not valid UTF-8"))?;
    Ok(PendingSqlFile {
        path: path.to_string_lossy().into_owned(),
        name,
        content,
    })
}

/// Read and remove everything queued. Separated from the command so it is
/// testable without a Tauri `State`.
pub fn take_from_buffer_with_cap(
    buffer: &PendingOpenFiles,
    cap: u64,
) -> Result<Vec<PendingSqlFile>, String> {
    let drained: Vec<OpenedSqlFile> = {
        let mut queue = buffer.0.lock().unwrap();
        std::mem::take(&mut *queue)
    };

    drained
        .into_iter()
        .map(|opened| pending_file(opened, cap))
        .collect()
}

/// Drain every queued open request at the production cap.
pub fn take_from_buffer(buffer: &PendingOpenFiles) -> Result<Vec<PendingSqlFile>, String> {
    take_from_buffer_with_cap(buffer, MAX_SQL_FILE_BYTES)
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
