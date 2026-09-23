use crate::keychain_acl;
use tauri_plugin_keyring_store::KeyringExt;

/// Store a connection password in the OS keychain.
/// The connection ID is used as the keyring account name.
#[tauri::command]
pub fn save_connection_password(
    app: tauri::AppHandle,
    connection_id: String,
    password: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .set_password(&connection_id, &password)
        .map_err(|e| e.to_string())?;
    // Best-effort: pin the item's ACL to this app so re-signed builds never prompt.
    keychain_acl::after_store(&app, &connection_id);
    Ok(())
}

/// Retrieve a connection password from the OS keychain.
/// Returns None if no password was stored for this connection.
#[tauri::command]
pub fn get_connection_password(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Option<String>, String> {
    // Repair a stale item ACL first: after a rebuild/path change macOS would
    // otherwise ask for the keychain password on every access (once per secret).
    keychain_acl::before_read(&app, &connection_id);
    app.keyring()
        .store
        .get_password(&connection_id)
        .map_err(|e| e.to_string())
}

/// Retrieve a connection password from the OS keychain (internal helper).
/// Returns None if no password was stored for this connection.
pub fn get_connection_password_internal(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<Option<String>, String> {
    keychain_acl::before_read(app, connection_id);
    app.keyring()
        .store
        .get_password(connection_id)
        .map_err(|e| e.to_string())
}

/// Build the keyring account name for an SSH secret (password or passphrase).
/// The `connection_id` namespaces each secret per connection.
pub fn ssh_account(kind: &str, connection_id: &str) -> String {
    format!("ssh_{kind}:{connection_id}")
}

/// Store an SSH tunnel password in the OS keychain.
#[tauri::command]
pub fn save_connection_ssh_password(
    app: tauri::AppHandle,
    connection_id: String,
    password: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .set_password(&ssh_account("password", &connection_id), &password)
        .map_err(|e| e.to_string())?;
    keychain_acl::after_store(&app, &ssh_account("password", &connection_id));
    Ok(())
}

/// Retrieve an SSH tunnel password from the OS keychain.
/// Returns None if no SSH password was stored for this connection.
#[tauri::command]
pub fn get_connection_ssh_password(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Option<String>, String> {
    keychain_acl::before_read(&app, &ssh_account("password", &connection_id));
    app.keyring()
        .store
        .get_password(&ssh_account("password", &connection_id))
        .map_err(|e| e.to_string())
}

/// Delete an SSH tunnel password from the OS keychain.
#[tauri::command]
pub fn delete_connection_ssh_password(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(&ssh_account("password", &connection_id))
        .map_err(|e| e.to_string())
}

/// Store an SSH private-key passphrase in the OS keychain.
#[tauri::command]
pub fn save_connection_ssh_passphrase(
    app: tauri::AppHandle,
    connection_id: String,
    passphrase: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .set_password(&ssh_account("passphrase", &connection_id), &passphrase)
        .map_err(|e| e.to_string())?;
    keychain_acl::after_store(&app, &ssh_account("passphrase", &connection_id));
    Ok(())
}

/// Retrieve an SSH private-key passphrase from the OS keychain.
/// Returns None if no passphrase was stored for this connection.
#[tauri::command]
pub fn get_connection_ssh_passphrase(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Option<String>, String> {
    keychain_acl::before_read(&app, &ssh_account("passphrase", &connection_id));
    app.keyring()
        .store
        .get_password(&ssh_account("passphrase", &connection_id))
        .map_err(|e| e.to_string())
}

/// Delete an SSH private-key passphrase from the OS keychain.
#[tauri::command]
pub fn delete_connection_ssh_passphrase(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(&ssh_account("passphrase", &connection_id))
        .map_err(|e| e.to_string())
}

/// Retrieve an SSH tunnel password from the OS keychain (internal helper).
/// Returns None if no SSH password was stored for this connection.
pub fn get_connection_ssh_password_internal(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<Option<String>, String> {
    keychain_acl::before_read(app, &ssh_account("password", connection_id));
    app.keyring()
        .store
        .get_password(&ssh_account("password", connection_id))
        .map_err(|e| e.to_string())
}

/// Delete an SSH tunnel password from the OS keychain (internal helper).
/// Errors are ignored by callers (deleting an absent key is a no-op).
pub fn delete_connection_ssh_password_internal(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(&ssh_account("password", connection_id))
        .map_err(|e| e.to_string())
}

/// Delete an SSH private-key passphrase from the OS keychain (internal helper).
/// Errors are ignored by callers (deleting an absent key is a no-op).
pub fn delete_connection_ssh_passphrase_internal(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(&ssh_account("passphrase", connection_id))
        .map_err(|e| e.to_string())
}

/// Delete a connection password from the OS keychain.
#[tauri::command]
pub fn delete_connection_password(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(&connection_id)
        .map_err(|e| e.to_string())
}

/// Delete a connection password from the OS keychain (internal helper).
/// Errors are ignored by callers (deleting an absent key is a no-op).
pub fn delete_connection_password_internal(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> Result<(), String> {
    app.keyring()
        .store
        .delete(connection_id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_account_namespaces_password() {
        assert_eq!(ssh_account("password", "c1"), "ssh_password:c1");
        assert_eq!(ssh_account("passphrase", "c1"), "ssh_passphrase:c1");
    }
}
