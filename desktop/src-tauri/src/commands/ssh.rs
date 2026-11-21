use crate::commands::ssh_trust::{
    enroll_host_trust, establish_trusted_session, host_key_from_blob, probe_host_trust,
    reenroll_host_trust, HostTrustProvider, SshTransport, SshTunnelError,
};
use crate::models::ssh_trust::{HostKey, HostKeyFingerprint, SshHostTrustState};
use crate::models::SshConfig;
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

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

    /// Create a tunnel handle whose `closer` runs when the tunnel is closed.
    ///
    /// Backends that own real resources (a listener, a session) hand their
    /// teardown in here, so closing the tunnel actually ends them — which is
    /// what makes "the tunnel stayed open for this query" observable.
    pub fn with_closer(local_port: u16, closer: Box<dyn FnOnce() + Send>) -> Self {
        Tunnel {
            local_port,
            closer: Some(closer),
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
    ///
    /// The SSH host key is verified before any credential is sent; an unknown
    /// or conflicting key returns a `SshTunnelError` carrying the trust state.
    fn open(
        &self,
        key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, SshTunnelError>;

    /// Report the host-trust state for an endpoint. Handshakes only: no
    /// password, key or passphrase is sent.
    fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String>;

    /// Remember an explicitly accepted fingerprint for an endpoint.
    fn enroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String>;

    /// Deliberately replace stale host trust for an endpoint.
    ///
    /// Reachable only from the connection's trust state — never from `open` or
    /// any other authentication path.
    fn reenroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String>;
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
    ) -> Result<u16, SshTunnelError> {
        if !cfg.is_valid() {
            return Err(SshTunnelError::Failed(
                "invalid SSH configuration".to_string(),
            ));
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

    /// Report the host-trust state for an SSH endpoint (no credentials sent).
    pub fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String> {
        self.backend.probe_host_trust(host, port)
    }

    /// Remember an explicitly accepted fingerprint for an SSH endpoint.
    pub fn enroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.backend.enroll_host_trust(host, port, accepted)
    }

    /// Deliberately replace stale host trust for an SSH endpoint.
    pub fn reenroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.backend.reenroll_host_trust(host, port, accepted)
    }
}

/// Real ssh2 backend: binds a loopback listener, verifies the SSH host key,
/// authenticates over a blocking socket, then forwards clients on nonblocking
/// channels.
///
/// The whole `open` runs inside `tokio::task::spawn_blocking` at the call
/// sites because `ssh2::Session` is purely blocking.
pub struct Ssh2Backend {
    trust: Arc<dyn HostTrustProvider>,
}

impl Ssh2Backend {
    pub fn new(trust: Arc<dyn HostTrustProvider>) -> Self {
        Ssh2Backend { trust }
    }
}

/// Open a TCP connection to the SSH host and complete the SSH handshake.
///
/// No credentials are involved, which is why probing an endpoint's host key can
/// use the same path as a real connection.
fn connect_session(host: &str, port: u16) -> Result<ssh2::Session, String> {
    use ssh2::Session;

    let addresses = (host, port)
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
    Ok(session)
}

/// Adapter that lets the shared host-trust seam drive a real ssh2 session.
struct Ssh2Transport<'a> {
    session: &'a mut ssh2::Session,
}

impl SshTransport for Ssh2Transport<'_> {
    fn handshake(&mut self) -> Result<(), String> {
        self.session
            .handshake()
            .map_err(|e| format!("ssh handshake: {e}"))
    }

    fn host_key(&mut self) -> Result<HostKey, String> {
        let (blob, _kind) = self
            .session
            .host_key()
            .ok_or_else(|| "ssh server did not present a host key".to_string())?;
        host_key_from_blob(blob)
    }

    fn authenticate_password(&mut self, user: &str, password: &str) -> Result<(), String> {
        self.session
            .userauth_password(user, password)
            .map_err(|e| format!("ssh password auth: {e}"))
    }

    fn authenticate_key(
        &mut self,
        user: &str,
        private_key_path: &Path,
        passphrase: Option<&str>,
    ) -> Result<(), String> {
        self.session
            .userauth_pubkey_file(user, None, private_key_path, passphrase)
            .map_err(|e| format!("ssh key auth: {e}"))
    }

    fn authenticated(&self) -> bool {
        self.session.authenticated()
    }
}

impl TunnelBackend for Ssh2Backend {
    fn open(
        &self,
        _key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, SshTunnelError> {
        // Loopback-only listener with an ephemeral port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| SshTunnelError::Failed(format!("bind local tunnel port: {e}")))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| SshTunnelError::Failed(format!("local tunnel address: {e}")))?
            .port();

        let mut session = connect_session(&cfg.host, cfg.port).map_err(SshTunnelError::Failed)?;
        // Verify the host key before authentication: an unknown or conflicting
        // key returns here, so no password, key or passphrase is ever sent to
        // an unverified server.
        {
            let mut transport = Ssh2Transport {
                session: &mut session,
            };
            establish_trusted_session(
                &mut transport,
                self.trust.as_ref(),
                cfg,
                password,
                passphrase,
            )?;
        }

        // Channel clones share the session's mutex. A blocking read would
        // prevent writes on every clone, deadlocking client-first protocols.
        session.set_blocking(false);
        listener
            .set_nonblocking(true)
            .map_err(|e| SshTunnelError::Failed(format!("nonblocking tunnel listener: {e}")))?;
        let remote_host = remote_host.to_string();
        let (closer_tx, closer_rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut pending = None;
            let mut clients = Vec::new();
            let mut idle_rounds: u32 = 0;
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
                if progressed {
                    idle_rounds = 0;
                } else {
                    // Poll tightly while data is flowing and back off once the
                    // tunnel idles (an open pool connection is idle most of
                    // its life): a fixed 5 ms poll wakes the CPU ~200x/s per
                    // tunnel for nothing, and on Windows it rounds up to the
                    // ~15.6 ms timer granularity anyway. The first round after
                    // activity is still 1 ms, so a request that arrives while
                    // the tunnel is warm only pays ~1 ms.
                    idle_rounds = idle_rounds.saturating_add(1);
                    let delay_ms = if idle_rounds <= 250 { 1 } else { 20 };
                    std::thread::sleep(Duration::from_millis(delay_ms));
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

    fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String> {
        self.probe_session(host, port, TrustAction::Probe)
    }

    fn enroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.probe_session(host, port, TrustAction::Enroll(accepted))
    }

    fn reenroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.probe_session(host, port, TrustAction::Reenroll(accepted))
    }
}

/// What a handshake-only session should do with the host key it reads.
#[derive(Clone, Copy)]
enum TrustAction<'a> {
    /// Report the state, change nothing.
    Probe,
    /// First use: remember an explicit acceptance.
    Enroll(&'a HostKeyFingerprint),
    /// Deliberate re-enrollment: replace stale trust.
    Reenroll(&'a HostKeyFingerprint),
}

impl Ssh2Backend {
    /// Handshake and read the host key, then drop the session: nothing is
    /// authenticated and no credential is sent.
    fn probe_session(
        &self,
        host: &str,
        port: u16,
        action: TrustAction<'_>,
    ) -> Result<SshHostTrustState, String> {
        let mut session = connect_session(host, port)?;
        let mut transport = Ssh2Transport {
            session: &mut session,
        };
        match action {
            TrustAction::Probe => probe_host_trust(&mut transport, self.trust.as_ref(), host, port),
            TrustAction::Enroll(accepted) => {
                enroll_host_trust(&mut transport, self.trust.as_ref(), host, port, accepted)
            }
            TrustAction::Reenroll(accepted) => {
                reenroll_host_trust(&mut transport, self.trust.as_ref(), host, port, accepted)
            }
        }
    }
}

/// Report the SSH host-trust state for an endpoint.
///
/// Handshake + host key only: no password, private key or passphrase is sent,
/// so the UI can show the fingerprint and ask for acceptance *before* a
/// connection attempt carries credentials.
#[tauri::command]
pub async fn ssh_host_trust_state(
    host: String,
    port: u16,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SshHostTrustState, String> {
    validate_endpoint(&host, port)?;
    let backend = state
        .ssh_manager
        .lock()
        .map_err(|e| e.to_string())?
        .backend_clone();
    tokio::task::spawn_blocking(move || backend.probe_host_trust(&host, port))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&e))
}

/// Remember an explicitly accepted host-key fingerprint for an endpoint.
///
/// Re-reads the offered key: a server that switched keys between the prompt and
/// the acceptance is refused, and a key that conflicts with existing trust is
/// never replaced here (that is a deliberate re-enrollment, not authentication).
#[tauri::command]
pub async fn ssh_host_trust_enroll(
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SshHostTrustState, String> {
    validate_endpoint(&host, port)?;
    let backend = state
        .ssh_manager
        .lock()
        .map_err(|e| e.to_string())?
        .backend_clone();
    let accepted = HostKeyFingerprint {
        key_type,
        fingerprint,
    };
    tokio::task::spawn_blocking(move || backend.enroll_host_trust(&host, port, &accepted))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&e))
}

/// Deliberately replace stale host trust for an endpoint after the user
/// confirmed the presented fingerprint out of band (ADR 0001).
///
/// This is the only command that replaces trust. It is deliberately absent from
/// every connect/test path: a mismatched key during authentication stays a dead
/// end, and the user has to come here — from the connection's trust state — to
/// re-enroll. Re-reads the offered key, so a server that switched keys after the
/// confirmation is refused. Sends no credentials and records none.
#[tauri::command]
pub async fn ssh_host_trust_reenroll(
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<SshHostTrustState, String> {
    validate_endpoint(&host, port)?;
    let backend = state
        .ssh_manager
        .lock()
        .map_err(|e| e.to_string())?
        .backend_clone();
    let accepted = HostKeyFingerprint {
        key_type,
        fingerprint,
    };
    tokio::task::spawn_blocking(move || backend.reenroll_host_trust(&host, port, &accepted))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&e))
}

fn validate_endpoint(host: &str, port: u16) -> Result<(), String> {
    if host.trim().is_empty() {
        return Err("an SSH host is required".to_string());
    }
    if port == 0 {
        return Err("an SSH port is required".to_string());
    }
    Ok(())
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

        // Host trust first, exactly like the UI: probe the offered key, accept
        // its fingerprint explicitly, then connect.
        let backend = Ssh2Backend::new(Arc::new(
            crate::commands::ssh_trust::fake::FakeHostTrust::default(),
        ));
        let state = backend
            .probe_host_trust(&cfg.host, cfg.port)
            .expect("probe SSH host key");
        let accepted = match &state {
            SshHostTrustState::Unknown {
                key_type,
                fingerprint,
                ..
            } => HostKeyFingerprint {
                key_type: key_type.clone(),
                fingerprint: fingerprint.clone(),
            },
            other => panic!("expected an unknown host on first use, got {other:?}"),
        };
        backend
            .enroll_host_trust(&cfg.host, cfg.port, &accepted)
            .expect("enroll the live host key");

        let tunnel = backend
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
        probes: std::sync::Mutex<Vec<(String, u16)>>,
        enrollments: std::sync::Mutex<Vec<(String, u16, HostKeyFingerprint)>>,
        reenrollments: std::sync::Mutex<Vec<(String, u16, HostKeyFingerprint)>>,
        next_port: u16,
    }

    impl Clone for FakeBackend {
        fn clone(&self) -> Self {
            Self {
                opens: std::sync::Mutex::new(self.opens.lock().unwrap().clone()),
                probes: std::sync::Mutex::new(self.probes.lock().unwrap().clone()),
                enrollments: std::sync::Mutex::new(self.enrollments.lock().unwrap().clone()),
                reenrollments: std::sync::Mutex::new(self.reenrollments.lock().unwrap().clone()),
                next_port: self.next_port,
            }
        }
    }

    impl FakeBackend {
        fn unknown_state(host: &str, port: u16) -> SshHostTrustState {
            SshHostTrustState::Unknown {
                host: host.to_string(),
                port,
                key_type: "ssh-ed25519".into(),
                fingerprint: "SHA256:fake".into(),
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
        ) -> Result<Tunnel, SshTunnelError> {
            self.opens.lock().unwrap().push(key.to_string());
            let p = self.next_port;
            Ok(Tunnel::fake(p))
        }

        fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String> {
            self.probes.lock().unwrap().push((host.to_string(), port));
            Ok(FakeBackend::unknown_state(host, port))
        }

        fn enroll_host_trust(
            &self,
            host: &str,
            port: u16,
            accepted: &HostKeyFingerprint,
        ) -> Result<SshHostTrustState, String> {
            self.enrollments
                .lock()
                .unwrap()
                .push((host.to_string(), port, accepted.clone()));
            Ok(SshHostTrustState::Trusted {
                host: host.to_string(),
                port,
                key_type: accepted.key_type.clone(),
                fingerprint: accepted.fingerprint.clone(),
                source: crate::models::ssh_trust::TrustSource::Enrolled,
            })
        }

        fn reenroll_host_trust(
            &self,
            host: &str,
            port: u16,
            accepted: &HostKeyFingerprint,
        ) -> Result<SshHostTrustState, String> {
            self.reenrollments
                .lock()
                .unwrap()
                .push((host.to_string(), port, accepted.clone()));
            Ok(SshHostTrustState::Trusted {
                host: host.to_string(),
                port,
                key_type: accepted.key_type.clone(),
                fingerprint: accepted.fingerprint.clone(),
                source: crate::models::ssh_trust::TrustSource::Enrolled,
            })
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
    fn tunnel_endpoint_does_not_change_tls_verification() {
        // A tunnel used to degrade verify-ca/verify-full to encrypt-only
        // `require`, because the TLS peer is loopback. The connection plan now
        // keeps the user's mode and verifies the real hostname instead; this
        // asserts the tunnel manager's endpoint (loopback + local port) is the
        // only thing a tunnel contributes.
        use crate::db::tls::{pg_connect_plan, TlsDecision};

        let plan = pg_connect_plan("db.internal", Some(5432), Some("verify-full"), Some(41234))
            .expect("verify-full is a valid mode");
        assert_eq!(plan.decision, TlsDecision::Verify);
        assert_eq!(plan.host, "db.internal");
        assert_eq!(plan.port, 41234);

        // disable stays disabled regardless of tunneling
        let plan =
            pg_connect_plan("db.internal", Some(5432), Some("disable"), Some(41234)).unwrap();
        assert_eq!(plan.decision, TlsDecision::Disable);
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

    #[test]
    fn manager_delegates_host_trust_probe_and_enrollment() {
        let backend = Arc::new(FakeBackend::default());
        let mgr = SshTunnelManager::new(backend.clone());

        let state = mgr
            .probe_host_trust("db.example.com", 2222)
            .expect("probe delegates to the backend");
        assert!(matches!(
            state,
            SshHostTrustState::Unknown { port: 2222, .. }
        ));

        let accepted = HostKeyFingerprint {
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:fake".into(),
        };
        let enrolled = mgr
            .enroll_host_trust("db.example.com", 2222, &accepted)
            .expect("enrollment delegates to the backend");
        assert!(enrolled.is_trusted());

        assert_eq!(
            *backend.probes.lock().unwrap(),
            vec![("db.example.com".to_string(), 2222)]
        );
        assert_eq!(
            *backend.enrollments.lock().unwrap(),
            vec![("db.example.com".to_string(), 2222, accepted)]
        );
    }

    #[test]
    fn manager_delegates_deliberate_re_enrollment() {
        let backend = Arc::new(FakeBackend::default());
        let mgr = SshTunnelManager::new(backend.clone());
        let accepted = HostKeyFingerprint {
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:rotated".into(),
        };

        let state = mgr
            .reenroll_host_trust("db.example.com", 2222, &accepted)
            .expect("re-enrollment delegates to the backend");

        assert!(state.is_trusted());
        assert_eq!(
            *backend.reenrollments.lock().unwrap(),
            vec![("db.example.com".to_string(), 2222, accepted)],
            "re-enrollment goes through the deliberate path, not the connect path"
        );
        assert!(
            backend.opens.lock().unwrap().is_empty(),
            "no tunnel was opened"
        );
        assert!(
            backend.enrollments.lock().unwrap().is_empty(),
            "first-use enrollment was not used"
        );
    }
}
