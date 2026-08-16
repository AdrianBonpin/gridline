use crate::db::tls::TlsDecision;
use crate::models::SshConfig;
use std::collections::HashMap;
use std::sync::Arc;

/// Through a tunnel the TLS peer is loopback (`127.0.0.1`), so certificate
/// verification is meaningless: `verify-ca`/`verify-full` degrade to
/// encrypt-only `require`. A direct (non-tunneled) connection honors the
/// user's mode unchanged.
pub fn effective_tls_decision(d: TlsDecision, via_tunnel: bool) -> TlsDecision {
    if via_tunnel && matches!(d, TlsDecision::Verify) {
        TlsDecision::Require
    } else {
        d
    }
}

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

    /// Clone of the active backend, for handing into `spawn_blocking` so the
    /// blocking ssh2 work never blocks an async runtime thread.
    pub fn backend_clone(&self) -> Arc<dyn TunnelBackend> {
        self.backend.clone()
    }

    /// Insert an already-opened tunnel under `key`, closing any previous one.
    pub fn insert_tunnel(&mut self, key: String, tunnel: Tunnel) {
        if let Some(old) = self.tunnels.insert(key, tunnel) {
            drop(old.closer);
        }
    }

    /// Return the number of active tunnels.
    pub fn active_count(&self) -> usize {
        self.tunnels.len()
    }
}

/// Real ssh2 backend: binds a loopback listener, authenticates to the SSH
/// host over a blocking socket, and pumps data between the local client and
/// the remote DB over an SSH direct-tcpip channel.
///
/// The whole `open` runs inside `tokio::task::spawn_blocking` at the call
/// sites because `ssh2::Session` is purely blocking.
pub struct Ssh2Backend;

impl TunnelBackend for Ssh2Backend {
    fn open(
        &self,
        _key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, String> {
        use ssh2::Session;

        // Loopback-only listener with an ephemeral port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("bind local tunnel port: {e}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("local tunnel address: {e}"))?
            .port();

        let tcp = std::net::TcpStream::connect((cfg.host.as_str(), cfg.port))
            .map_err(|e| format!("connect ssh host: {e}"))?;
        let mut session = Session::new().map_err(|e| format!("ssh session: {e}"))?;
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|e| format!("ssh handshake: {e}"))?;

        match cfg.auth_method.as_str() {
            "key" => {
                let path = cfg
                    .private_key_path
                    .as_deref()
                    .ok_or_else(|| "private_key_path required for key auth".to_string())?;
                session
                    .userauth_pubkey_file(&cfg.user, None, std::path::Path::new(path), passphrase)
                    .map_err(|e| format!("ssh key auth: {e}"))?;
            }
            _ => session
                .userauth_password(&cfg.user, password.unwrap_or(""))
                .map_err(|e| format!("ssh password auth: {e}"))?,
        }
        if !session.authenticated() {
            return Err("SSH authentication failed".into());
        }

        let remote_host = remote_host.to_string();
        let session = Arc::new(std::sync::Mutex::new(session));
        let (closer_tx, closer_rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            if let Ok((mut local, _)) = listener.accept() {
                // Open the direct-tcpip channel to the remote DB. `Channel` is
                // cloneable (Arc-shared inner), so one clone per direction
                // lets two pump threads copy data in parallel.
                let mut channel = match session.lock().unwrap().channel_direct_tcpip(
                    &remote_host,
                    remote_port as u16,
                    None,
                ) {
                    Ok(c) => c,
                    Err(_) => return,
                };
                // The accepted socket stays owned by this thread; when the
                // tunnel is closed the closer wakes us, we drop `local` and
                // the pumps end on EOF/broken pipe.
                let mut upstream = channel.clone();
                let down = local.try_clone();
                let pump = match down {
                    Ok(down) => Some(std::thread::spawn(move || {
                        let mut down = down;
                        // client -> remote DB
                        let _ = std::io::copy(&mut down, &mut upstream);
                    })),
                    Err(_) => None,
                };
                // remote DB -> client (this thread)
                let _ = std::io::copy(&mut channel, &mut local);
                if let Some(p) = pump {
                    let _ = p.join();
                }
            }
            let _ = closer_rx.recv();
        });
        Ok(Tunnel {
            local_port,
            closer: Some(Box::new(move || {
                let _ = closer_tx.send(());
            })),
        })
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
    fn tunneled_tls_is_downgraded_to_require() {
        // verify-full through a tunnel degrades to encrypt-only `require`
        assert_eq!(
            effective_tls_decision(crate::db::tls::tls_decision(Some("verify-full")), true),
            crate::db::tls::TlsDecision::Require
        );
        // direct (non-tunneled) connection keeps the user's mode
        assert_eq!(
            effective_tls_decision(crate::db::tls::tls_decision(Some("verify-full")), false),
            crate::db::tls::TlsDecision::Verify
        );
        // disable stays disabled regardless of tunneling
        assert_eq!(
            effective_tls_decision(crate::db::tls::tls_decision(Some("disable")), true),
            crate::db::tls::TlsDecision::Disable
        );
    }

    #[test]
    fn manager_backend_clone_returns_backend() {
        let backend = Arc::new(FakeBackend {
            next_port: 7,
            ..Default::default()
        });
        let mgr = SshTunnelManager::new(backend.clone());
        // The cloned Arc points at the same fake backend.
        let cloned = mgr.backend_clone();
        let cfg = crate::models::SshConfig::new("h".into(), 22, "u".into(), "password".into());
        let tunnel = cloned
            .open("c1", &cfg, "db.host", 5432, None, None)
            .unwrap();
        assert_eq!(tunnel.local_port, 7);
    }

    #[test]
    fn manager_insert_tunnel_replaces_and_closes_old() {
        let mut mgr = SshTunnelManager::new(Arc::new(FakeBackend::default()));
        mgr.insert_tunnel("c1".to_string(), Tunnel::fake(1111));
        assert_eq!(mgr.get_local_port("c1"), Some(1111));
        // Re-inserting under the same key replaces the old tunnel.
        mgr.insert_tunnel("c1".to_string(), Tunnel::fake(2222));
        assert_eq!(mgr.get_local_port("c1"), Some(2222));
        assert_eq!(mgr.active_count(), 1);
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
