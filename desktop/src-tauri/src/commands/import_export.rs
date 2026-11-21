use crate::models::ConnectionInput;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;

const VALID_DB_TYPES: [&str; 5] = ["postgresql", "mysql", "mariadb", "sqlite", "redis"];

/// Version written into the export envelope. The record shape is the serialized
/// [`crate::models::Connection`], which only ever grows optional fields, so a
/// reader for version 1 stays a reader for every later version.
const EXPORT_FORMAT_VERSION: u32 = 1;

/// The current connection-file shape: a versioned envelope. `version` is
/// accepted and ignored rather than required, because the record shape only
/// ever grows optional fields; the legacy bare-array shape is read separately
/// in [`parse_connection_file`].
#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(default)]
    #[allow(dead_code)]
    version: Option<u32>,
    connections: Vec<ImportRecord>,
}

/// One connection record from a transfer file.
///
/// Only non-secret settings are listed: a transfer file never carries a
/// database password or an SSH secret, and a file that does contain such keys
/// has them ignored rather than copied into the local store.
///
/// Optional fields stay `Option`: the pre-envelope importer typed them that
/// way, so a file that spelled an absent value as `null` imported then and
/// still imports now.
#[derive(Debug, Deserialize)]
pub(crate) struct ImportRecord {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    db_type: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    port: Option<i64>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    database: Option<String>,
    #[serde(default)]
    environment: Option<String>,
    #[serde(default)]
    folder_id: Option<String>,
    #[serde(default)]
    tag_ids: Option<Vec<String>>,
    #[serde(default)]
    favorite: Option<bool>,
    #[serde(default)]
    ssh_host: Option<String>,
    #[serde(default)]
    ssh_port: Option<i64>,
    #[serde(default)]
    ssh_user: Option<String>,
    #[serde(default)]
    ssh_auth_method: Option<String>,
    #[serde(default)]
    ssh_private_key_path: Option<String>,
    #[serde(default)]
    ssl_mode: Option<String>,
    #[serde(default)]
    ssl_ca_path: Option<String>,
    #[serde(default)]
    ssl_cert_path: Option<String>,
    #[serde(default)]
    ssl_key_path: Option<String>,
    #[serde(default)]
    use_keychain: Option<bool>,
}

/// A record that was imported but lost something: an organization link that
/// does not exist locally. The connection itself survives; the link is dropped.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    pub index: usize,
    pub name: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRecord {
    pub index: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub skipped_records: Vec<SkippedRecord>,
    pub warnings: Vec<ImportWarning>,
}

/// Read either connection-file shape into its records.
///
/// Today's files are the versioned envelope `{ "version": 1, "connections":
/// [...] }`; files written before the envelope existed, and files written by
/// hand for the old importer, are a bare array of the same records and must
/// keep importing. The file's shape decides how it is read, so a malformed
/// file produces an error about the file the user actually has instead of
/// serde's "data did not match any variant" message.
pub fn parse_connection_file(json: &str) -> Result<Vec<ImportRecord>, String> {
    let shape: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid connection file: {e}"))?;
    match shape {
        serde_json::Value::Object(_) => serde_json::from_str::<Envelope>(json)
            .map(|envelope| envelope.connections)
            .map_err(|e| format!("invalid connection file: {e}")),
        serde_json::Value::Array(_) => serde_json::from_str::<Vec<ImportRecord>>(json)
            .map_err(|e| format!("invalid connection file: {e}")),
        _ => Err(
            "invalid connection file: expected a versioned export or a list of connections"
                .to_string(),
        ),
    }
}

/// Keep the organization links that resolve in this store, and report the ones
/// that do not. A link to a folder or tag that does not exist here cannot be
/// written: the store enforces referential integrity, so passing it through
/// would reject an otherwise valid record.
fn resolve_links(
    index: usize,
    name: &str,
    folder_id: Option<&str>,
    tag_ids: &[String],
    known_folders: &HashSet<String>,
    known_tags: &HashSet<String>,
    warnings: &mut Vec<ImportWarning>,
) -> (Option<String>, Vec<String>) {
    let mut warn = |message: String| {
        warnings.push(ImportWarning {
            index,
            name: name.to_string(),
            message,
        })
    };

    let resolved_folder = match folder_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) if known_folders.contains(id) => Some(id.to_string()),
        Some(id) => {
            warn(format!(
                "folder \"{id}\" does not exist here; connection imported without a folder"
            ));
            None
        }
        None => None,
    };

    let mut resolved_tags: Vec<String> = Vec::new();
    for tag_id in tag_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
    {
        if !known_tags.contains(tag_id) {
            warn(format!(
                "tag \"{tag_id}\" does not exist here; connection imported without that tag"
            ));
        } else if !resolved_tags.iter().any(|kept| kept == tag_id) {
            resolved_tags.push(tag_id.to_string());
        }
    }

    (resolved_folder, resolved_tags)
}

pub fn import_connections_inner(
    state: &Mutex<Store>,
    json: String,
) -> Result<ImportResult, String> {
    let records = parse_connection_file(&json)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    let known_folders: HashSet<String> = store
        .get_folders()?
        .into_iter()
        .map(|folder| folder.id)
        .collect();
    let known_tags: HashSet<String> = store.get_tags()?.into_iter().map(|tag| tag.id).collect();
    let mut imported = 0usize;
    let mut skipped_records = Vec::new();
    let mut warnings = Vec::new();
    for (i, rec) in records.iter().enumerate() {
        let name = match &rec.name {
            Some(n) if !n.trim().is_empty() => n.clone(),
            _ => {
                skipped_records.push(SkippedRecord {
                    index: i,
                    reason: "missing or empty name".into(),
                });
                continue;
            }
        };
        if rec.db_type.trim().is_empty() {
            skipped_records.push(SkippedRecord {
                index: i,
                reason: "missing or empty db_type".into(),
            });
            continue;
        }
        if !VALID_DB_TYPES.contains(&rec.db_type.as_str()) {
            skipped_records.push(SkippedRecord {
                index: i,
                reason: format!("invalid db_type: {}", rec.db_type),
            });
            continue;
        }
        if rec.host.trim().is_empty() {
            skipped_records.push(SkippedRecord {
                index: i,
                reason: "missing or empty host".into(),
            });
            continue;
        }
        let (folder_id, tag_ids) = resolve_links(
            i,
            &name,
            rec.folder_id.as_deref(),
            rec.tag_ids.as_deref().unwrap_or_default(),
            &known_folders,
            &known_tags,
            &mut warnings,
        );
        let input = ConnectionInput {
            name,
            db_type: rec.db_type.clone(),
            host: rec.host.clone(),
            port: rec.port,
            username: rec.username.clone(),
            folder_id,
            // A transfer file is not a credential: it never carries a password
            // or an SSH secret, and the input stays empty for all three.
            password: None,
            database: rec.database.clone(),
            ssh_host: rec.ssh_host.clone(),
            ssh_port: rec.ssh_port,
            ssh_user: rec.ssh_user.clone(),
            ssh_auth_method: rec.ssh_auth_method.clone(),
            ssh_private_key_path: rec.ssh_private_key_path.clone(),
            ssh_password: None,
            ssh_passphrase: None,
            ssl_mode: rec.ssl_mode.clone(),
            ssl_ca_path: rec.ssl_ca_path.clone(),
            ssl_cert_path: rec.ssl_cert_path.clone(),
            ssl_key_path: rec.ssl_key_path.clone(),
            environment: rec.environment.clone(),
            tag_ids,
            use_keychain: rec.use_keychain.unwrap_or(true),
        };
        match store.create_connection(input) {
            Ok(created) => {
                imported += 1;
                if rec.favorite.unwrap_or(false) {
                    if let Err(e) = store.set_connection_favorite(&created.id, true) {
                        warnings.push(ImportWarning {
                            index: i,
                            name: created.name.clone(),
                            message: format!("connection imported but not marked favorite: {e}"),
                        });
                    }
                }
            }
            Err(e) => skipped_records.push(SkippedRecord {
                index: i,
                reason: e,
            }),
        }
    }
    Ok(ImportResult {
        imported,
        skipped: skipped_records.len(),
        skipped_records,
        warnings,
    })
}

pub fn export_connections_inner(state: &Mutex<Store>) -> Result<String, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let conns = store.get_connections()?;
    let export = serde_json::json!({ "version": EXPORT_FORMAT_VERSION, "connections": conns });
    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_connections(
    state: tauri::State<crate::AppState>,
    json: String,
) -> Result<ImportResult, String> {
    import_connections_inner(&state.db_store, json)
}

#[tauri::command]
pub fn export_connections(state: tauri::State<crate::AppState>) -> Result<String, String> {
    export_connections_inner(&state.db_store)
}

#[cfg(test)]
#[path = "import_export.test.rs"]
mod tests;
