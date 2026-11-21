//! Session-only credential commands.
//!
//! The renderer is the place a keychain-off credential is entered, so it hands
//! the same value to the backend for the tool jobs that cannot reach the OS
//! keychain (`pg_dump`, `pg_restore`, `psql`, `mariadb-dump`) and for DDL copy.
//! The backend keeps it in memory only (see `crate::session_credential`): it is
//! never written to the local store, never logged, and never passed as a process
//! argument.
//!
//! These commands are deliberately separate from `commands::keychain`: nothing
//! here touches the OS keychain, and a keychain-enabled connection keeps using
//! its keychain entry.

use tauri::State;

/// Remember a keychain-off connection's password for this app session.
///
/// Only the in-memory session store is updated. The OS keychain is untouched,
/// so a connection with keychain persistence enabled never gains a second copy
/// of its credential from this path.
#[tauri::command]
pub fn store_session_credential(
    connection_id: String,
    password: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    state.session_credentials.set(&connection_id, &password);
    Ok(())
}

/// Forget a keychain-off connection's session password (connection deleted).
#[tauri::command]
pub fn forget_session_credential(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    state.session_credentials.forget(&connection_id);
    Ok(())
}
