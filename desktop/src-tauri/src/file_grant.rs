//! File Grants: the only thing that authorizes a filesystem touch.
//!
//! A **File Grant** is short-lived authorization created by a Rust-brokered
//! native file selection for one intended operation and one job (see
//! `GLOSSARY.md`). A displayed or renderer-supplied path is not a File Grant:
//! the webview can only *display* a path and *present a grant id back*, so a
//! compromised or buggy renderer cannot name a file for this process to read or
//! write.
//!
//! Invariants this module owns:
//!
//! * **Backend-issued** — only [`FileGrantStore::mint`] creates one, and only
//!   [`grant_selection`] (driven by an injected [`FilePicker`]) reaches it from
//!   a command. The renderer has no minting command.
//! * **Intent-scoped** — a grant authorizes one [`FileIntent`] (`Read` or
//!   `Write`). Consuming it for another intent is rejected.
//! * **Single-job, single-use** — the first successful consume uses it up; a
//!   replay is rejected so a second job needs a fresh selection.
//! * **Five-minute expiry** — [`GRANT_TTL`] after selection. An expired grant
//!   reports the [`CODE_EXPIRED`] state so the UI can show a real recovery
//!   action instead of a silent fallback.
//! * **Fail closed** — an unknown id (including a raw path or an empty string)
//!   authorizes nothing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a File Grant stays consumable after the selection was made.
pub const GRANT_TTL: Duration = Duration::from_secs(5 * 60);

/// How long an expired/consumed entry is kept so repeated attempts keep
/// reporting the specific state (expired, already consumed) instead of decaying
/// into "unknown". Purely a memory-hygiene bound.
pub const RETENTION_GRACE: Duration = Duration::from_secs(60 * 60);

/// Stable IPC error codes. The renderer selects a visible state from the
/// `<code>: <message>` prefix instead of matching on human text.
pub const CODE_INVALID: &str = "file-grant-invalid";
pub const CODE_EXPIRED: &str = "file-grant-expired";
pub const CODE_WRONG_INTENT: &str = "file-grant-wrong-intent";
pub const CODE_CONSUMED: &str = "file-grant-consumed";

/// What a File Grant authorizes. Backup output is `Write`; the restore, import
/// and streamed-export paths will consume `Read` grants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileIntent {
    Read,
    Write,
}

impl FileIntent {
    pub fn as_str(&self) -> &'static str {
        match self {
            FileIntent::Read => "read",
            FileIntent::Write => "write",
        }
    }
}

/// Why a grant did not authorize an operation. Nothing here ever contains a
/// path or a grant id (errors cross the IPC boundary and are shown to users).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantError {
    /// No such grant. This is also what a raw renderer-supplied path — or an
    /// empty string — resolves to: a path is not a grant.
    Unknown,
    /// The grant aged past [`GRANT_TTL`].
    Expired,
    /// The grant was minted for a different intent than the operation asks for.
    WrongIntent {
        expected: FileIntent,
        actual: FileIntent,
    },
    /// The grant was already consumed by an earlier job.
    AlreadyConsumed,
}

impl GrantError {
    pub fn code(&self) -> &'static str {
        match self {
            GrantError::Unknown => CODE_INVALID,
            GrantError::Expired => CODE_EXPIRED,
            GrantError::WrongIntent { .. } => CODE_WRONG_INTENT,
            GrantError::AlreadyConsumed => CODE_CONSUMED,
        }
    }

    /// User-facing text: what happened and what to do about it.
    pub fn message(&self) -> String {
        match self {
            GrantError::Unknown => {
                "No file selection authorizes this operation. Choose the file again.".to_string()
            }
            GrantError::Expired => {
                "The file selection expired five minutes after it was made. Choose the file again."
                    .to_string()
            }
            GrantError::WrongIntent { .. } => {
                "That file selection was made for a different operation. Choose the file again."
                    .to_string()
            }
            GrantError::AlreadyConsumed => {
                "That file selection was already used by another job. Choose the file again."
                    .to_string()
            }
        }
    }

    /// The IPC error string: `code: message`, so the UI can pick a state and
    /// still show a readable explanation.
    pub fn to_ipc(&self) -> String {
        format!("{}: {}", self.code(), self.message())
    }
}

impl std::fmt::Display for GrantError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_ipc())
    }
}

/// What the renderer receives after a native selection. `path` is display
/// metadata only; `id` is the authorization.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileGrant {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub intent: FileIntent,
    /// Seconds from selection to expiry, so the UI can warn ahead of time.
    pub expires_in_seconds: u64,
}

/// One native-dialog filter group (name + allowed extensions).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// What the renderer asks the *backend* to show. The renderer picks the intent
/// and the suggested file name; the backend owns the dialog and the path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickRequest {
    pub intent: FileIntent,
    pub title: String,
    pub default_name: Option<String>,
    pub filters: Vec<FileFilter>,
}

/// A path chosen in the native dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickedFile {
    pub path: String,
}

/// The native dialog, behind a trait so the grant boundary is headless-testable
/// without a window. Production uses the Tauri dialog plugin
/// (`commands::file_grant::NativeFilePicker`).
pub trait FilePicker: Send + Sync {
    fn pick(&self, request: &PickRequest) -> Result<Option<PickedFile>, String>;
}

/// Monotonic clock, injected so expiry is testable without sleeping.
pub type Clock = Box<dyn Fn() -> Instant + Send + Sync>;

struct Entry {
    path: PathBuf,
    intent: FileIntent,
    issued_at: Instant,
    consumed: bool,
}

/// Process-lifetime grant store, owned by `AppState`.
pub struct FileGrantStore {
    entries: Mutex<HashMap<String, Entry>>,
    ttl: Duration,
    clock: Clock,
}

impl Default for FileGrantStore {
    fn default() -> Self {
        Self::new()
    }
}

impl FileGrantStore {
    pub fn new() -> Self {
        Self::with_clock(GRANT_TTL, Box::new(Instant::now))
    }

    pub fn with_clock(ttl: Duration, clock: Clock) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl,
            clock,
        }
    }

    /// Issue a grant for an already-validated absolute path.
    ///
    /// Callers must come through [`grant_selection`] (a native picker result);
    /// this is not reachable from the IPC boundary.
    pub fn mint(&self, path: PathBuf, intent: FileIntent) -> FileGrant {
        let now = (self.clock)();
        let display_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let grant = FileGrant {
            id: uuid::Uuid::new_v4().to_string(),
            path: path.to_string_lossy().into_owned(),
            display_name,
            intent,
            expires_in_seconds: self.ttl.as_secs(),
        };
        let mut entries = self.lock();
        Self::forget_old(&mut entries, now, self.ttl);
        entries.insert(
            grant.id.clone(),
            Entry {
                path,
                intent,
                issued_at: now,
                consumed: false,
            },
        );
        grant
    }

    /// Use a grant up. On success the grant is consumed and its path returned;
    /// every failure leaves the store unchanged (except evicting an entry that
    /// is past the retention window).
    pub fn consume(&self, grant_id: &str, intent: FileIntent) -> Result<PathBuf, GrantError> {
        let now = (self.clock)();
        let mut entries = self.lock();
        Self::forget_old(&mut entries, now, self.ttl);

        let Some(entry) = entries.get(grant_id) else {
            return Err(GrantError::Unknown);
        };
        // Expiry is checked before anything else so the UI gets the specific
        // "expired" state rather than a generic rejection.
        if now.saturating_duration_since(entry.issued_at) > self.ttl {
            return Err(GrantError::Expired);
        }
        if entry.intent != intent {
            return Err(GrantError::WrongIntent {
                expected: intent,
                actual: entry.intent,
            });
        }
        if entry.consumed {
            return Err(GrantError::AlreadyConsumed);
        }
        let entry = entries
            .get_mut(grant_id)
            .expect("entry existed during the checks above");
        entry.consumed = true;
        Ok(entry.path.clone())
    }

    /// Number of grants still holding an entry (used by tests and diagnostics).
    pub fn active_grants(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        // A poisoned lock must not disable file authorization entirely, and the
        // map holds no other invariant to repair.
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Drop entries that are past expiry plus the retention grace. Expired
    /// entries are kept until then so they keep reporting `Expired`.
    fn forget_old(entries: &mut HashMap<String, Entry>, now: Instant, ttl: Duration) {
        let horizon = ttl + RETENTION_GRACE;
        entries.retain(|_, e| now.saturating_duration_since(e.issued_at) <= horizon);
    }
}

/// Validate a path that came from the native dialog.
///
/// Fail closed: the dialog always yields an absolute path, so anything else is
/// a defect we refuse rather than resolve against the process CWD (the app is
/// often launched with CWD `/`).
pub fn validate_grant_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("No file was selected".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "The selected path must be absolute, got: {trimmed}"
        ));
    }
    if path.file_name().is_none() {
        return Err("The selected path must name a file or folder".to_string());
    }
    Ok(path.to_path_buf())
}

/// The one path from a native selection to a File Grant.
///
/// Returns `Ok(None)` when the user cancelled (nothing is minted, nothing is
/// logged), and an error when the dialog failed or handed back a path that
/// fails [`validate_grant_path`].
pub fn grant_selection(
    grants: &FileGrantStore,
    picker: &dyn FilePicker,
    request: &PickRequest,
) -> Result<Option<FileGrant>, String> {
    let Some(picked) = picker.pick(request)? else {
        return Ok(None);
    };
    let path = validate_grant_path(&picked.path)?;
    Ok(Some(grants.mint(path, request.intent)))
}

#[cfg(test)]
#[path = "file_grant.test.rs"]
mod tests;
