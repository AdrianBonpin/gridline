//! File reads and writes the renderer asks for, authorized by File Grants.
//!
//! Three renderer flows used to touch the disk through the `plugin-fs` IPC
//! surface, where the **path came from the renderer**: connection JSON import
//! and export (`lib/importExport.ts`) and the schema-visualizer image export
//! (`SchemaVisualizerPage.tsx`). What authorized those writes was a session-long
//! scope that the dialog plugin extended with whatever the picker returned — a
//! general "read or write any path I can name" power for the webview, bounded
//! only by a short deny list. That is not the File Grant model: nothing expired,
//! nothing was single-use, and any path outside the list (say `~/.kube/config`
//! or `~/.npmrc`) was readable by renderer code.
//!
//! Every flow now goes the way backup, restore, data import and settings do: the
//! renderer asks Rust to show the native dialog (`select_file_for_grant`),
//! receives a grant id plus display metadata, and hands the id back here. A raw
//! path — or the empty string — resolves to no grant and authorizes nothing
//! (spec §"Tool jobs and file authorization": *raw paths are not
//! authorization*; `GLOSSARY.md` → File Grant).
//!
//! The two shapes below are deliberate:
//!
//! * The **connection** flows are intent-specific commands. Export renders the
//!   transfer document in Rust and publishes it to a write grant; import reads
//!   the file a read grant authorized and hands the text back for the existing
//!   `import_connections` validator. The renderer never sees a path it can act
//!   on, and neither command can do anything but that one job.
//! * [`save_granted_bytes`] publishes renderer-produced bytes to a
//!   write-granted destination. Rasterizing the schema diagram can only happen
//!   in the webview, so the *bytes* legitimately originate there — the
//!   destination is what needs authorizing, and it comes from the grant, not
//!   from the caller. The size cap keeps a runaway render from filling memory.

use crate::commands::test_connection::sanitize_error;
use crate::file_grant::{consume_granted_path, FileGrantStore, FileIntent};
use crate::store::Store;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// Hard cap on a connection transfer file. A real export is a few kilobytes of
/// non-secret connection settings; a larger file is a mistake, not a transfer.
pub const MAX_CONNECTIONS_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Hard cap on renderer-produced bytes published through a write grant (the
/// schema-visualizer image, which is the only such flow). A 1600×1000 render at
/// 2× pixel ratio is a few megabytes; 32 MiB leaves room without letting a
/// renderer turn one grant into an arbitrary disk-filling write.
pub const MAX_GRANTED_WRITE_BYTES: usize = 32 * 1024 * 1024;

/// Publish `bytes` to `destination` atomically: write a temporary sibling,
/// flush, sync, then rename over the destination.
///
/// A failed write leaves any existing file intact and no partial artifact
/// behind, so a half-written export can never masquerade as a good one.
pub(crate) fn write_atomically(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "the destination does not name a file".to_string())?;
    let dir = match destination.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let partial = dir.join(format!(".{name}.gridline-partial-{}", uuid::Uuid::new_v4()));

    let write = (|| -> Result<(), String> {
        {
            use std::io::Write as _;
            let mut file = std::fs::File::create(&partial)
                .map_err(|e| format!("cannot create {}: {e}", partial.display()))?;
            file.write_all(bytes)
                .map_err(|e| format!("write failed: {e}"))?;
            file.sync_all().map_err(|e| format!("write failed: {e}"))?;
        }
        std::fs::rename(&partial, destination)
            .map_err(|e| format!("cannot replace {}: {e}", destination.display()))
    })();
    if write.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    write
}

/// Read a granted file as text under a byte cap.
///
/// The cap is enforced from `metadata` **before** the read so an oversized file
/// is refused without being buffered, and a path that is not a regular file is
/// refused rather than approximated. `what` names the file kind in the message
/// ("settings file", "connection file") so the user sees which flow failed.
pub(crate) fn read_text_capped(path: &Path, max_bytes: u64, what: &str) -> Result<String, String> {
    let shown = path.display();
    let meta =
        std::fs::metadata(path).map_err(|e| format!("cannot read the {what} {shown}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("the {what} is not a regular file: {shown}"));
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "the {what} is too large ({} bytes; the limit is {max_bytes})",
            meta.len()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| format!("cannot read the {what} {shown}: {e}"))
}

/// Write the connection transfer document to the path a **write** grant
/// authorized. Returns the path that was written (display metadata only).
pub(crate) fn export_connections_to_granted_path(
    grants: &FileGrantStore,
    store: &Mutex<Store>,
    grant_id: &str,
) -> Result<String, String> {
    let path = consume_granted_path(grants, grant_id, FileIntent::Write)?;
    let json = crate::commands::import_export::export_connections_inner(store)?;
    write_atomically(Path::new(&path), json.as_bytes())?;
    Ok(path)
}

/// Read a connection transfer file through a **read** grant and return its text.
/// The caller validates it (`import_connections`), so a malformed file keeps
/// reporting through the same import path as before.
pub(crate) fn read_connections_from_granted_path(
    grants: &FileGrantStore,
    grant_id: &str,
) -> Result<String, String> {
    let path = consume_granted_path(grants, grant_id, FileIntent::Read)?;
    read_text_capped(
        Path::new(&path),
        MAX_CONNECTIONS_FILE_BYTES,
        "connection file",
    )
}

/// Publish renderer-produced bytes to the path a **write** grant authorized.
/// Returns the path that was written (display metadata only).
pub(crate) fn write_granted_bytes(
    grants: &FileGrantStore,
    grant_id: &str,
    bytes: &[u8],
) -> Result<String, String> {
    // The size check runs before the grant is consumed: an over-large payload
    // leaves the selection usable, so the user can retry with a smaller export
    // instead of starting over.
    if bytes.len() > MAX_GRANTED_WRITE_BYTES {
        return Err(format!(
            "the export is too large ({} bytes; the limit is {} MB)",
            bytes.len(),
            MAX_GRANTED_WRITE_BYTES / (1024 * 1024)
        ));
    }
    let path = consume_granted_path(grants, grant_id, FileIntent::Write)?;
    write_atomically(Path::new(&path), bytes)?;
    Ok(path)
}

/// Export connections to the file the user selected. `file_grant` is the id from
/// `select_file_for_grant` (write intent) and is consumed by this call.
#[tauri::command]
pub fn export_connections_to_file(
    file_grant: String,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    export_connections_to_granted_path(&state.file_grants, &state.db_store, &file_grant)
}

/// Read the connection transfer file the user selected. `file_grant` is the id
/// from `select_file_for_grant` (read intent) and is consumed by this call.
#[tauri::command]
pub fn read_connections_file(
    file_grant: String,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    read_connections_from_granted_path(&state.file_grants, &file_grant)
}

/// Save bytes the renderer produced (a rendered schema image) to the file the
/// user selected. `file_grant` is the id from `select_file_for_grant` (write
/// intent) and is consumed by this call; the destination is the grant's, never
/// an argument.
#[tauri::command]
pub async fn save_granted_bytes(
    file_grant: String,
    bytes: Vec<u8>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let grants = state.file_grants.clone();
    tauri::async_runtime::spawn_blocking(move || write_granted_bytes(&grants, &file_grant, &bytes))
        .await
        .map_err(|e| sanitize_error(&format!("The export could not be saved: {e}")))?
}

#[cfg(test)]
#[path = "file_io.test.rs"]
mod tests;
