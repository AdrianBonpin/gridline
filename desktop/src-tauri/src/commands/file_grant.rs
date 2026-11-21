//! The IPC boundary for File Grants.
//!
//! The renderer can ask for a native selection and then present the grant id
//! back to a file-touching command. It cannot mint a grant, and it cannot name
//! a path: [`NativeFilePicker`] owns the OS dialog, so the path originates in
//! the backend (spec §"Tool jobs and file authorization").

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::test_connection::sanitize_error;
use crate::file_grant::{self, FileGrant, FileIntent, FilePicker, PickRequest, PickedFile};

/// Which native dialog a File Grant intent requires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogKind {
    Open,
    Save,
}

/// Read intents open an existing file; write intents choose an output path.
/// Pure so the mapping is testable without a window.
pub fn dialog_kind(intent: FileIntent) -> DialogKind {
    match intent {
        FileIntent::Read => DialogKind::Open,
        FileIntent::Write => DialogKind::Save,
    }
}

/// The production picker: the OS dialog, brokered and owned by Rust.
pub struct NativeFilePicker {
    app: AppHandle,
}

impl NativeFilePicker {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl FilePicker for NativeFilePicker {
    fn pick(&self, request: &PickRequest) -> Result<Option<PickedFile>, String> {
        let mut dialog = self.app.dialog().file().set_title(request.title.clone());
        if let Some(name) = &request.default_name {
            dialog = dialog.set_file_name(name.clone());
        }
        for filter in &request.filters {
            // A filter with no extensions would match nothing; skipping it means
            // "unrestricted", exactly like the unfiltered save dialog the same
            // flow used before (e.g. pg_dump's directory format).
            if filter.extensions.is_empty() {
                continue;
            }
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(filter.name.clone(), &extensions);
        }

        let picked = match dialog_kind(request.intent) {
            DialogKind::Open => dialog.blocking_pick_file(),
            DialogKind::Save => dialog.blocking_save_file(),
        };

        let Some(file_path) = picked else {
            return Ok(None);
        };
        // A non-UTF-8 path cannot be represented in the grant or in the tool
        // arguments; refuse it instead of silently approximating it.
        let path = file_path.into_path().map_err(|e| {
            sanitize_error(&format!("The file dialog returned an unusable path: {e}"))
        })?;
        let path = path.to_str().ok_or_else(|| {
            "The selected path is not valid UTF-8. Choose a different file.".to_string()
        })?;
        Ok(Some(PickedFile {
            path: path.to_string(),
        }))
    }
}

/// Show the native dialog and issue a File Grant for what was chosen.
///
/// Returns `Ok(None)` when the user cancelled. The dialog runs on a blocking
/// thread: `blocking_save_file` must not be called from the main thread.
#[tauri::command]
pub async fn select_file_for_grant(
    app: AppHandle,
    request: PickRequest,
    state: State<'_, crate::AppState>,
) -> Result<Option<FileGrant>, String> {
    let grants = state.file_grants.clone();
    let picker_app = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let picker = NativeFilePicker::new(picker_app);
        file_grant::grant_selection(&grants, &picker, &request)
    })
    .await
    .map_err(|e| sanitize_error(&format!("The file dialog could not be shown: {e}")))?
}

#[cfg(test)]
#[path = "file_grant.test.rs"]
mod tests;
