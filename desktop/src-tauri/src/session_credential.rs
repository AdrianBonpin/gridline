//! Session-only database credentials.
//!
//! With the keychain toggle off a connection's password is never persisted: the
//! user re-enters it each session. The renderer keeps the copy used by the
//! connect form; tool jobs (`pg_dump`, `pg_restore`, `psql`, `mariadb-dump`)
//! and DDL copy run in Rust, so they need a backend copy of the *same*
//! credential, keyed by the saved connection (the Change Origin) that owns it.
//!
//! The store is memory-only and process-lifetime. Nothing here is written to
//! the local store, written to a log, or placed in a process argument list: a
//! tool job reads the credential out of this map and hands it to the child
//! through its environment (`PGPASSWORD` / `MYSQL_PWD`). Keychain-enabled
//! connections never read this store — their credential stays in the OS
//! keychain exactly as before.

use std::collections::HashMap;
use std::sync::Mutex;

/// The rejection a tool job returns when a keychain-off connection has no
/// credential in this session yet.
///
/// Followed by `:<connection_id>` so the UI can prompt for exactly that
/// connection — a DB sync resolves two credentials and may be missing only one.
/// The value is a state code, never a credential: the refusal never includes
/// the password.
pub const SESSION_CREDENTIAL_REQUIRED: &str = "session-credential-required";

/// Build the named refusal for a connection whose session credential is absent.
pub fn required_error(connection_id: &str) -> String {
    format!("{SESSION_CREDENTIAL_REQUIRED}:{connection_id}")
}

/// Memory-only credentials for connections with keychain persistence off.
#[derive(Default)]
pub struct SessionCredentialStore {
    credentials: Mutex<HashMap<String, String>>,
}

impl SessionCredentialStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember the credential for this session. Replacing an existing entry is
    /// the normal path (the prompt is answered again, or the user reconnected).
    pub fn set(&self, connection_id: &str, password: &str) {
        let mut credentials = self.lock();
        credentials.insert(connection_id.to_string(), password.to_string());
    }

    /// Drop the credential (connection deleted, or the session copy replaced).
    pub fn forget(&self, connection_id: &str) {
        self.lock().remove(connection_id);
    }

    /// The session credential for a connection, if one was supplied.
    pub fn get(&self, connection_id: &str) -> Option<String> {
        self.lock().get(connection_id).cloned()
    }

    /// The session credential for a connection, or the named refusal the UI
    /// turns into a password prompt. An empty string is not a credential.
    pub fn require(&self, connection_id: &str) -> Result<String, String> {
        match self.get(connection_id) {
            Some(password) if !password.is_empty() => Ok(password),
            _ => Err(required_error(connection_id)),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        // A panic while an entry was being inserted must not take the rest of
        // the session's credentials (or every later tool job) down with it.
        self.credentials
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Resolve the credential a tool job authenticates with.
///
/// * Keychain enabled (the default) — read the OS keychain, exactly as tool
///   jobs have always done. `keychain_lookup` is only called on this path.
/// * Keychain disabled — reuse the session credential held in backend memory.
///   When none was supplied the job must not run with an empty password, so the
///   resolution returns [`required_error`] and the UI prompts instead.
///
/// An empty string is not treated as a credential: the connect flow asks again
/// in that case too, and a tool must never authenticate with a silently empty
/// password.
pub fn resolve_tool_credential(
    session: &SessionCredentialStore,
    use_keychain: bool,
    connection_id: &str,
    keychain_lookup: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<String, String> {
    if use_keychain {
        // Preserve the existing keychain behavior byte for byte: a missing or
        // failed keychain read is not a hard error here (it has never been for
        // tool jobs), and the server rejects a bad credential itself.
        return Ok(keychain_lookup().unwrap_or_default().unwrap_or_default());
    }
    session.require(connection_id)
}

#[cfg(test)]
#[path = "session_credential.test.rs"]
mod tests;
