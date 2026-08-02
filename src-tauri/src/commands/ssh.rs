use crate::models::SshConfig;
use std::collections::HashMap;
use std::sync::Arc;

/// A live tunnel handle. `closer` drops the listener + ssh session when called.
pub struct Tunnel {
    pub local_port: u16,
    closer: Option<Box<dyn FnOnce() + Send>>,
}

impl Tunnel {
    /// Create a tunnel handle with no resources to clean up (test backend).
    pub fn fake(port: u16) -> Self {
        Tunnel {
            local_port: port,
            closer: None,
        }
    }
}

/// Backend that actually establishes SSH tunnels.
///
/// The manager only does bookkeeping; opening/closing the OS-level tunnel is
/// delegated here so it can be faked in tests.
pub trait TunnelBackend: Send + Sync {
    /// Open a tunnel to `remote_host:remote_port` via `cfg` and return a
    /// handle exposing the bound local port.
    fn open(
        &self,
        key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, String>;
}

/// Manages SSH tunnels, mapping connection keys to active tunnels.
///
/// Bookkeeping only: validation, key->tunnel map, and lifecycle hooks.
/// The actual SSH connectivity is delegated to a `TunnelBackend` so the
/// manager's behavior is unit-testable with a fake backend.
pub struct SshTunnelManager {
    tunnels: HashMap<String, Tunnel>,
    backend: Arc<dyn TunnelBackend>,
}

impl SshTunnelManager {
    /// Create a new tunnel manager backed by `backend`.
    pub fn new(backend: Arc<dyn TunnelBackend>) -> Self {
        SshTunnelManager {
            tunnels: HashMap::new(),
            backend,
        }
    }

    /// Open an SSH tunnel for the given config.
    ///
    /// Returns the local port on success. Replaces any existing tunnel for
    /// the same key (closing the old one).
    pub fn open_tunnel(
        &mut self,
        key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<u16, String> {
        if !cfg.is_valid() {
            return Err("invalid SSH configuration".to_string());
        }
        let tunnel = self
            .backend
            .open(key, cfg, remote_host, remote_port, password, passphrase)?;
        let port = tunnel.local_port;
        if let Some(old) = self.tunnels.insert(key.to_string(), tunnel) {
            drop(old.closer);
        }
        Ok(port)
    }

    /// Close and remove the SSH tunnel for the given key.
    pub fn close_tunnel(&mut self, key: &str) {
        if let Some(t) = self.tunnels.remove(key) {
            drop(t.closer);
        }
    }

    /// Close all active SSH tunnels.
    pub fn close_all(&mut self) {
        let tunnels = std::mem::take(&mut self.tunnels);
        for (_, t) in tunnels {
            drop(t.closer);
        }
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

/// Real ssh2 backend — plumbing wired in a later task; returns Err here so
/// the crate compiles and the manager is fully wired.
pub struct Ssh2Backend;

impl TunnelBackend for Ssh2Backend {
    fn open(
        &self,
        _key: &str,
        cfg: &SshConfig,
        _remote_host: &str,
        _remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, String> {
        let _ = (cfg, password, passphrase);
        Err("Ssh2Backend.open is wired in Task 9".into())
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

    // ------------------------------------------------------------------
    // Tunnel manager tests (fake backend)
    // ------------------------------------------------------------------

    #[derive(Debug, Default)]
    struct FakeBackend {
        opens: std::sync::Mutex<Vec<String>>,
        next_port: u16,
    }

    impl Clone for FakeBackend {
        fn clone(&self) -> Self {
            Self {
                opens: std::sync::Mutex::new(self.opens.lock().unwrap().clone()),
                next_port: self.next_port,
            }
        }
    }

    impl TunnelBackend for FakeBackend {
        fn open(
            &self,
            key: &str,
            _cfg: &crate::models::SshConfig,
            _remote_host: &str,
            _remote_port: u16,
            _pw: Option<&str>,
            _pp: Option<&str>,
        ) -> Result<Tunnel, String> {
            self.opens.lock().unwrap().push(key.to_string());
            let p = self.next_port;
            Ok(Tunnel::fake(p))
        }
    }

    #[test]
    fn manager_open_and_get_port() {
        let backend = Arc::new(FakeBackend {
            next_port: 22222,
            ..Default::default()
        });
        let mut mgr = SshTunnelManager::new(backend.clone());
        let cfg = crate::models::SshConfig::new("h".into(), 22, "u".into(), "password".into());
        let port = mgr
            .open_tunnel("c1", &cfg, "db.host", 5432, None, None)
            .unwrap();
        assert_eq!(port, 22222);
        assert_eq!(mgr.get_local_port("c1"), Some(22222));
    }

    #[test]
    fn manager_invalid_config_errors() {
        let backend = Arc::new(FakeBackend::default());
        let mut mgr = SshTunnelManager::new(backend);
        let cfg = crate::models::SshConfig::new("".into(), 22, "u".into(), "password".into());
        assert!(mgr
            .open_tunnel("c1", &cfg, "db.host", 5432, None, None)
            .is_err());
    }

    #[test]
    fn manager_close_removes_tunnel() {
        let backend = Arc::new(FakeBackend {
            next_port: 1,
            ..Default::default()
        });
        let mut mgr = SshTunnelManager::new(backend);
        let cfg = crate::models::SshConfig::new("h".into(), 22, "u".into(), "password".into());
        mgr.open_tunnel("c1", &cfg, "db.host", 5432, None, None)
            .unwrap();
        mgr.close_tunnel("c1");
        assert_eq!(mgr.get_local_port("c1"), None);
        assert_eq!(mgr.active_count(), 0);
    }

    #[test]
    fn manager_close_all() {
        let backend = Arc::new(FakeBackend::default());
        let mut mgr = SshTunnelManager::new(backend);
        let cfg = crate::models::SshConfig::new("h".into(), 22, "u".into(), "password".into());
        mgr.open_tunnel("a", &cfg, "db", 5432, None, None).ok();
        mgr.open_tunnel("b", &cfg, "db", 5432, None, None).ok();
        mgr.close_all();
        assert_eq!(mgr.active_count(), 0);
    }
}