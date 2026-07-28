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
        .map_err(|e| e.to_string())
}

/// Retrieve a connection password from the OS keychain.
/// Returns None if no password was stored for this connection.
#[tauri::command]
pub fn get_connection_password(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Option<String>, String> {
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
    app.keyring()
        .store
        .get_password(connection_id)
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