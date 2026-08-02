use serde::{Deserialize, Serialize};

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