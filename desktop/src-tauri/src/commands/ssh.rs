use crate::db::tls::TlsDecision;
use crate::models::SshConfig;
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

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

impl Drop for Tunnel {
    fn drop(&mut self) {
        if let Some(close) = self.closer.take() {
            close();
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
            drop(old);
        }
        Ok(port)
    }

    /// Close and remove the SSH tunnel for the given key.
    pub fn close_tunnel(&mut self, key: &str) {
        if let Some(t) = self.tunnels.remove(key) {
            drop(t);
        }
    }

    /// Close all active SSH tunnels.
    pub fn close_all(&mut self) {
        let tunnels = std::mem::take(&mut self.tunnels);
        for (_, t) in tunnels {
            drop(t);
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
            drop(old);
        }
    }

    /// Return the number of active tunnels.
    pub fn active_count(&self) -> usize {
        self.tunnels.len()
    }
}

/// Real ssh2 backend: binds a loopback listener, authenticates to the SSH
/// host over a blocking socket, then forwards clients on nonblocking channels.
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

        let addresses = (cfg.host.as_str(), cfg.port)
            .to_socket_addrs()
            .map_err(|e| format!("resolve ssh host: {e}"))?;
        let mut last_error = io::Error::new(io::ErrorKind::NotFound, "no SSH host addresses");
        let tcp = addresses
            .filter_map(
                |addr| match TcpStream::connect_timeout(&addr, Duration::from_secs(10)) {
                    Ok(tcp) => Some(tcp),
                    Err(e) => {
                        last_error = e;
                        None
                    }
                },
            )
            .next()
            .ok_or_else(|| format!("connect ssh host: {last_error}"))?;
        let mut session = Session::new().map_err(|e| format!("ssh session: {e}"))?;
        session.set_timeout(10_000);
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

        // Channel clones share the session's mutex. A blocking read would
        // prevent writes on every clone, deadlocking client-first protocols.
        session.set_blocking(false);
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("nonblocking tunnel listener: {e}"))?;
        let remote_host = remote_host.to_string();
        let (closer_tx, closer_rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut pending = None;
            let mut clients = Vec::new();
            while matches!(
                closer_rx.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ) {
                let mut progressed = false;
                if pending.is_none() {
                    match listener.accept() {
                        Ok((local, _)) => pending = Some(local),
                        Err(e) if retry_io(&e) => {}
                        Err(_) => break,
                    }
                }
                // Only one channel-open operation is in flight per session;
                // existing clients keep forwarding while it waits for SSH I/O.
                if pending.is_some() {
                    match session.channel_direct_tcpip(&remote_host, remote_port, None) {
                        Ok(channel) => {
                            if let Ok(client) =
                                ForwardedClient::new(pending.take().unwrap(), channel)
                            {
                                clients.push(client);
                            }
                            progressed = true;
                        }
                        Err(e) if ssh_would_block(&e) => {}
                        Err(_) => {
                            pending.take();
                        }
                    }
                }
                clients.retain_mut(|client| match client.forward() {
                    Ok(CopyState::Progress) => {
                        progressed = true;
                        true
                    }
                    Ok(CopyState::Pending) => true,
                    Ok(CopyState::Eof) | Err(_) => false,
                });
                if !progressed {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            // Dropping the worker's listener, clients and session closes all
            // sockets, including clients stalled in authentication or a query.
        });
        Ok(Tunnel {
            local_port,
            closer: Some(Box::new(move || {
                let _ = closer_tx.send(());
            })),
        })
    }
}

fn ssh_would_block(error: &ssh2::Error) -> bool {
    error.code() == ssh2::ErrorCode::Session(-37) // LIBSSH2_ERROR_EAGAIN
}

fn retry_io(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

#[derive(Debug, PartialEq, Eq)]
enum CopyState {
    Pending,
    Progress,
    Eof,
}

/// Keep unconsumed bytes in the reader across partial writes and WouldBlock.
fn copy_available(reader: &mut impl BufRead, writer: &mut impl Write) -> io::Result<CopyState> {
    let bytes = match reader.fill_buf() {
        Ok([]) => return Ok(CopyState::Eof),
        Ok(bytes) => bytes,
        Err(e) if retry_io(&e) => return Ok(CopyState::Pending),
        Err(e) => return Err(e),
    };
    match writer.write(bytes) {
        Ok(0) => Err(io::ErrorKind::WriteZero.into()),
        Ok(n) => {
            reader.consume(n);
            Ok(CopyState::Progress)
        }
        Err(e) if retry_io(&e) => Ok(CopyState::Pending),
        Err(e) => Err(e),
    }
}

struct ForwardedClient {
    local: TcpStream,
    local_reader: BufReader<TcpStream>,
    channel: ssh2::Channel,
    channel_reader: BufReader<ssh2::Channel>,
    sent_eof: bool,
    received_eof: bool,
}

impl ForwardedClient {
    fn new(local: TcpStream, channel: ssh2::Channel) -> io::Result<Self> {
        local.set_nonblocking(true)?;
        Ok(Self {
            local_reader: BufReader::new(local.try_clone()?),
            local,
            channel_reader: BufReader::new(channel.clone()),
            channel,
            sent_eof: false,
            received_eof: false,
        })
    }

    fn forward(&mut self) -> io::Result<CopyState> {
        let mut progressed = false;
        if !self.sent_eof {
            match copy_available(&mut self.local_reader, &mut self.channel)? {
                CopyState::Eof => match self.channel.send_eof() {
                    Ok(()) => {
                        self.sent_eof = true;
                        progressed = true;
                    }
                    Err(e) if ssh_would_block(&e) => {}
                    Err(e) => return Err(e.into()),
                },
                CopyState::Progress => progressed = true,
                CopyState::Pending => {}
            }
        }
        if !self.received_eof {
            match copy_available(&mut self.channel_reader, &mut self.local)? {
                CopyState::Eof => {
                    self.local.shutdown(Shutdown::Write)?;
                    self.received_eof = true;
                    progressed = true;
                }
                CopyState::Progress => progressed = true,
                CopyState::Pending => {}
            }
        }
        Ok(if self.sent_eof && self.received_eof {
            CopyState::Eof
        } else if progressed {
            CopyState::Progress
        } else {
            CopyState::Pending
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_available_keeps_bytes_on_backpressure_and_partial_writes() {
        struct SlowWriter {
            bytes: Vec<u8>,
            blocked: bool,
        }
        impl Write for SlowWriter {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                self.blocked = !self.blocked;
                if self.blocked {
                    return Err(io::ErrorKind::WouldBlock.into());
                }
                let n = bytes.len().min(2);
                self.bytes.extend_from_slice(&bytes[..n]);
                Ok(n)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let payload = b"client-first protocol";
        let mut reader = BufReader::with_capacity(3, payload.as_slice());
        let mut writer = SlowWriter {
            bytes: Vec::new(),
            blocked: false,
        };
        for _ in 0..100 {
            if copy_available(&mut reader, &mut writer).unwrap() == CopyState::Eof {
                assert_eq!(writer.bytes, payload);
                return;
            }
        }
        panic!("buffered transfer did not complete");
    }

    #[test]
    fn manager_replacement_and_close_run_tunnel_cleanup() {
        let (tx, rx) = std::sync::mpsc::channel();
        let first = tx.clone();
        let mut manager = SshTunnelManager::new(Arc::new(FakeBackend::default()));
        manager.insert_tunnel(
            "connection".into(),
            Tunnel {
                local_port: 1,
                closer: Some(Box::new(move || first.send(1).unwrap())),
            },
        );
        manager.insert_tunnel(
            "connection".into(),
            Tunnel {
                local_port: 2,
                closer: Some(Box::new(move || tx.send(2).unwrap())),
            },
        );
        assert_eq!(rx.try_recv().unwrap(), 1);
        manager.close_tunnel("connection");
        assert_eq!(rx.try_recv().unwrap(), 2);
    }

    /// Run against an SSH host forwarding to PostgreSQL, without a DB password:
    /// GRIDLINE_TEST_SSH_HOST=... GRIDLINE_TEST_SSH_USER=... \
    /// GRIDLINE_TEST_SSH_KEY=... cargo test ssh_live -- --ignored
    #[test]
    #[ignore]
    fn ssh_live_forwards_client_first_protocol_and_multiple_connections() {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;

        let mut cfg = SshConfig::new(
            std::env::var("GRIDLINE_TEST_SSH_HOST").expect("GRIDLINE_TEST_SSH_HOST"),
            std::env::var("GRIDLINE_TEST_SSH_PORT")
                .unwrap_or_else(|_| "22".into())
                .parse()
                .unwrap(),
            std::env::var("GRIDLINE_TEST_SSH_USER").expect("GRIDLINE_TEST_SSH_USER"),
            "key".into(),
        );
        cfg.private_key_path =
            Some(std::env::var("GRIDLINE_TEST_SSH_KEY").expect("GRIDLINE_TEST_SSH_KEY"));
        let target_host =
            std::env::var("GRIDLINE_TEST_PG_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let target_port = std::env::var("GRIDLINE_TEST_PG_PORT")
            .unwrap_or_else(|_| "5432".into())
            .parse()
            .unwrap();
        let passphrase = std::env::var("GRIDLINE_TEST_SSH_PASSPHRASE").ok();
        let tunnel = Ssh2Backend
            .open(
                "live-test",
                &cfg,
                &target_host,
                target_port,
                None,
                passphrase.as_deref(),
            )
            .expect("open SSH tunnel");

        // Two clients must work concurrently; PostgreSQL waits for each
        // client's SSLRequest before replying. No credentials or SQL are sent.
        let mut clients: Vec<_> = (0..2)
            .map(|_| {
                let stream = TcpStream::connect(("127.0.0.1", tunnel.local_port)).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                stream
            })
            .collect();
        for client in &mut clients {
            client.write_all(&[0, 0, 0, 8, 4, 210, 22, 47]).unwrap();
        }
        for client in &mut clients {
            let mut reply = [0];
            client
                .read_exact(&mut reply)
                .expect("PostgreSQL SSL response through SSH");
            assert!(matches!(reply[0], b'S' | b'N'));
        }

        drop(tunnel);
        for client in &mut clients {
            assert_eq!(
                client.read(&mut [0]).unwrap(),
                0,
                "dropping tunnel closes clients"
            );
        }
    }

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
