//! Reading a data-import source (CSV / JSON) that a File Grant authorized.
//!
//! Data import used to read its file in the renderer through the fs plugin, so
//! any path the webview named could be read. It now goes the same way backup
//! and restore do: the renderer asks Rust to show the native dialog
//! (`select_file_for_grant`, `Read` intent), then hands the grant id back here.
//! A path is not a grant (see `GLOSSARY.md` → File Grant), so handing one in
//! fails closed with the `file-grant-invalid` state.
//!
//! The import caps are unchanged: 100,000 rows (enforced by the staging UI) and
//! 100 MB, with the byte limit checked from the file's metadata **before** the
//! file is read so an oversized file is never buffered (spec §"Large results").

use crate::commands::test_connection::sanitize_error;
use crate::file_grant::{consume_granted_path, FileGrantStore, FileIntent};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// The existing import size limit, enforced before any of the file is read.
pub const MAX_IMPORT_BYTES: u64 = 100 * 1024 * 1024;

/// What the renderer gets back: the file's text plus display metadata. Only
/// `text` is data — the name is for the UI to show which file it staged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub text: String,
    pub display_name: String,
    pub bytes: u64,
}

/// Consume the File Grant that authorizes reading an import source and return
/// its path. Import reads a file, so the grant must carry the `Read` intent; a
/// backup/export write grant is refused here.
pub fn resolve_import_source(grants: &FileGrantStore, grant_id: &str) -> Result<String, String> {
    consume_granted_path(grants, grant_id, FileIntent::Read)
}

/// Read a granted import source under a byte cap.
///
/// The cap is enforced from `metadata` first: an oversized file is refused
/// without being read, so the limit cannot be turned into a memory spike. A
/// path that is not a regular file, or whose bytes are not UTF-8, is refused
/// rather than approximated.
pub fn read_import_source(path: &Path, max_bytes: u64) -> Result<ImportSource, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read the import file: {e}"))?;
    if !meta.is_file() {
        return Err("The import source is not a regular file. Choose the file again.".to_string());
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "File exceeds {} MB limit ({} bytes)",
            max_bytes / (1024 * 1024),
            meta.len()
        ));
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("Cannot read the import file: {e}"))?;
    let display_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    Ok(ImportSource {
        text,
        display_name,
        bytes: meta.len(),
    })
}

/// Read the import source named by a File Grant. The grant is consumed here, so
/// each import needs its own selection.
#[tauri::command]
pub async fn read_import_file(
    file_grant: String,
    state: State<'_, crate::AppState>,
) -> Result<ImportSource, String> {
    let path = PathBuf::from(resolve_import_source(&state.file_grants, &file_grant)?);
    tauri::async_runtime::spawn_blocking(move || read_import_source(&path, MAX_IMPORT_BYTES))
        .await
        .map_err(|e| sanitize_error(&format!("The import file could not be read: {e}")))?
}

#[cfg(test)]
#[path = "import_file.test.rs"]
mod tests;
