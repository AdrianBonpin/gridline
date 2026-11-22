//! Backend-authoritative Change Origin validation.
//!
//! Every staged change carries the Change Origin it was staged against: the
//! saved connection, the selected database, and a fingerprint of the connection
//! target configuration (where writes would land). The renderer already refuses
//! to commit work against a retargeted connection, but the renderer is not
//! authoritative — a reused connection id must never redirect a staged write even
//! if the UI is bypassed or is simply out of date. So the command boundary
//! revalidates the origin against the **saved** connection before any statement
//! runs, and nothing is written when the target moved.
//!
//! The fingerprint is a canonical, readable string rather than a hash, so both
//! sides can compute it independently and a mismatch is diagnosable. The renderer
//! computes the identical string in `desktop/src/lib/changeOrigin.ts`
//! (`connectionTarget().fingerprint`); [`TARGET_FIELDS`] and
//! [`connection_target_fingerprint`] must stay in step with it. Values are
//! trimmed, and an absent value contributes the empty string.
//!
//! The origin compared here is the one recorded when the change was **staged**
//! (`QueueItem.origin`, sent by `ChangesQueuePanel`), never one recomputed at
//! commit time. Recomputing it from the live connection would compare the saved
//! connection with itself — tautologically true — and hand the retarget decision
//! back to the renderer, which is the one answer this module exists to make
//! impossible (`commands::db_viewer::execute_staged_change`).

use crate::models::Connection;
use serde::Deserialize;

/// The connection fields that decide *where writes land*, in fingerprint order.
///
/// Deliberately excludes presentation/organization metadata (name, folder, tags,
/// environment, favorite, keychain reference): renaming or refiling a connection
/// must not invalidate pending work. Secrets are never part of any identity.
pub const TARGET_FIELDS: [&str; 14] = [
    "db_type",
    "host",
    "port",
    "username",
    "database",
    "ssh_host",
    "ssh_port",
    "ssh_user",
    "ssh_auth_method",
    "ssh_private_key_path",
    "ssl_mode",
    "ssl_ca_path",
    "ssl_cert_path",
    "ssl_key_path",
];

/// The Change Origin a staged change belongs to, as the renderer reports it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeOrigin {
    /// Saved connection id the change was staged from.
    pub connection_id: String,
    /// Database selected at staging time (`""` when the engine has no selection).
    #[serde(default)]
    pub database: String,
    /// [`connection_target_fingerprint`] of the saved connection at staging time.
    pub target: String,
    /// Human-readable target description, for refusal messages.
    #[serde(default)]
    pub target_label: String,
}

fn normalize(value: Option<&str>) -> String {
    value.map(str::trim).unwrap_or_default().to_string()
}

fn normalize_port(port: Option<i64>) -> String {
    port.map(|p| p.to_string()).unwrap_or_default()
}

/// The canonical target fingerprint of a saved connection.
///
/// Must produce exactly the string `connectionTarget()` produces in
/// `desktop/src/lib/changeOrigin.ts`.
pub fn connection_target_fingerprint(conn: &Connection) -> String {
    let values = [
        normalize(Some(&conn.db_type)),
        normalize(Some(&conn.host)),
        normalize_port(conn.port),
        normalize(conn.username.as_deref()),
        normalize(conn.database.as_deref()),
        normalize(conn.ssh_host.as_deref()),
        normalize_port(conn.ssh_port),
        normalize(conn.ssh_user.as_deref()),
        normalize(conn.ssh_auth_method.as_deref()),
        normalize(conn.ssh_private_key_path.as_deref()),
        normalize(conn.ssl_mode.as_deref()),
        normalize(conn.ssl_ca_path.as_deref()),
        normalize(conn.ssl_cert_path.as_deref()),
        normalize(conn.ssl_key_path.as_deref()),
    ];
    TARGET_FIELDS
        .iter()
        .zip(values)
        .map(|(field, value)| format!("{field}={value}"))
        .collect::<Vec<_>>()
        .join("|")
}

/// A short description of where a saved connection points, for messages.
pub fn describe_connection_target(conn: &Connection) -> String {
    let mut text = format!("{} {}", conn.db_type.trim(), conn.host.trim());
    if let Some(port) = conn.port {
        text.push_str(&format!(":{port}"));
    }
    if let Some(database) = conn
        .database
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        text.push('/');
        text.push_str(database);
    }
    text
}

/// Stable IPC code prefix for a refused commit, so the renderer can recognise
/// the case without matching on human text.
pub const CHANGE_ORIGIN_RETARGETED: &str = "change-origin-retargeted";

/// Refuse a staged change whose Change Origin is not the given connection's
/// current target.
///
/// Fails closed: a missing/blank fingerprint, a different connection id, or a
/// changed target configuration all refuse. This runs before the change is
/// applied, so a refusal writes nothing.
pub fn validate_change_origin(
    stored: &Connection,
    connection_id: &str,
    origin: &ChangeOrigin,
) -> Result<(), String> {
    if origin.connection_id != connection_id {
        return Err(format!(
            "{CHANGE_ORIGIN_RETARGETED}: this change belongs to connection {}, not {connection_id}. \
             Nothing was written.",
            origin.connection_id
        ));
    }
    let current = connection_target_fingerprint(stored);
    if origin.target != current {
        let staged = if origin.target_label.trim().is_empty() {
            "an earlier configuration of this connection".to_string()
        } else {
            origin.target_label.trim().to_string()
        };
        return Err(format!(
            "{CHANGE_ORIGIN_RETARGETED}: this pending change was staged against {staged}, but the \
             saved connection now targets {}. Nothing was written; revert or clear the change, or \
             stage it again on the current target.",
            describe_connection_target(stored)
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "change_target.test.rs"]
mod tests;
