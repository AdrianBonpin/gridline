use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// SSH tunnel configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// "password" or "key"
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

impl SshConfig {
    /// Create a new `SshConfig` with the required fields.
    pub fn new(
        host: String,
        port: u16,
        user: String,
        auth_method: String,
    ) -> Self {
        SshConfig {
            host,
            port,
            user,
            auth_method,
            password: None,
            private_key_path: None,
            passphrase: None,
        }
    }

    /// Validate SSH configuration.
    ///
    /// Returns `true` if:
    /// - `host` is not empty
    /// - `port` is in range 1..=65535 (u16 guarantees <= 65535)
    /// - `user` is not empty
    pub fn is_valid(&self) -> bool {
        !self.host.is_empty() && self.port >= 1 && !self.user.is_empty()
    }
}

/// Represents an active SSH tunnel connection.
#[derive(Debug)]
struct SshTunnel {
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

/// Manages SSH tunnels, mapping connection keys to active tunnels.
///
/// This is a placeholder implementation. Real SSH connectivity (via `ssh2`
/// or `async-ssh2`) will be added in a later task. Currently the manager
/// stores mock entries when validation passes.
#[derive(Debug)]
pub struct SshTunnelManager {
    tunnels: HashMap<String, SshTunnel>,
}

impl SshTunnelManager {
    /// Create a new empty tunnel manager.
    pub fn new() -> Self {
        SshTunnelManager {
            tunnels: HashMap::new(),
        }
    }

    /// Open an SSH tunnel for the given config.
    ///
    /// Returns the local port on success.
    ///
    /// TODO: Replace placeholder with a real SSH connection via `ssh2` or
    /// `async-ssh2`. Currently stores a mock entry (`local_port = 15432`)
    /// when `config.is_valid()` passes.
    pub fn open_tunnel(&mut self, key: &str, config: &SshConfig) -> Result<u16, String> {
        if !config.is_valid() {
            return Err("invalid SSH configuration".to_string());
        }
        // TODO: Replace with real SSH tunnel via ssh2::Session + port forwarding.
        // For now, store a mock entry with local_port = 15432.
        self.tunnels.insert(
            key.to_string(),
            SshTunnel {
                local_port: 15432,
                remote_host: config.host.clone(),
                remote_port: config.port,
            },
        );
        Ok(15432)
    }

    /// Close and remove the SSH tunnel for the given key.
    ///
    /// TODO: When real SSH is implemented, this should disconnect the
    /// session and free the local port.
    pub fn close_tunnel(&mut self, key: &str) {
        self.tunnels.remove(key);
    }

    /// Close all active SSH tunnels.
    pub fn close_all(&mut self) {
        self.tunnels.clear();
    }

    /// Get the local port for an active tunnel, if any.
    pub fn get_local_port(&self, key: &str) -> Option<u16> {
        self.tunnels.get(key).map(|t| t.local_port)
    }

    /// Return the number of active tunnels.
    pub fn active_count(&self) -> usize {
        self.tunnels.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // SshConfig validation
    // ------------------------------------------------------------------

    #[test]
    fn ssh_config_validation() {
        // Invalid: empty host
        let config = SshConfig::new(
            "".to_string(),
            22,
            "user".to_string(),
            "password".to_string(),
        );
        assert!(!config.is_valid(), "empty host should be invalid");

        // Invalid: empty user
        let config = SshConfig::new(
            "host.example.com".to_string(),
            22,
            "".to_string(),
            "password".to_string(),
        );
        assert!(!config.is_valid(), "empty user should be invalid");

        // Valid: all required fields present
        let config = SshConfig::new(
            "host.example.com".to_string(),
            2222,
            "tunnel".to_string(),
            "key".to_string(),
        );
        assert!(config.is_valid(), "valid config should be accepted");
    }

    #[test]
    fn ssh_config_rejects_non_standard_ports() {
        // Port 0 is invalid
        let config = SshConfig::new(
            "host.example.com".to_string(),
            0,
            "user".to_string(),
            "password".to_string(),
        );
        assert!(!config.is_valid(), "port 0 should be invalid");

        // Port 1 is valid (boundary)
        let config = SshConfig::new(
            "host.example.com".to_string(),
            1,
            "user".to_string(),
            "password".to_string(),
        );
        assert!(config.is_valid(), "port 1 should be valid");
    }
}