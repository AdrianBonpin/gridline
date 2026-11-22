//! Connection lifecycle tests.
//!
//! These run the real teardown and reconnection paths against real loopback
//! listeners, so "the tunnel is closed" means the port refuses connections —
//! not merely that a map entry went away.

use super::*;
use crate::cancel::{CancelHandle, SqliteCancel};
use crate::commands::ssh::{shutdown_pair, TunnelBackend};
use crate::commands::ssh_trust::SshTunnelError;
use crate::db::pool::{ConnectionPoolManager, DbConfig, DbHandle};
use crate::models::ssh_trust::{HostKeyFingerprint, SshHostTrustState};
use crate::models::SshConfig;
use std::net::TcpListener;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

/// A tunnel backend whose tunnels own a **real** loopback listener, closed with
/// the same request/acknowledgement handshake the ssh2 forwarding worker uses.
///
/// That makes both halves of the lifecycle observable from a test: a connection
/// to the returned port succeeds while the tunnel is live, and is refused once
/// the tunnel has been closed.
#[derive(Default)]
struct LoopbackBackend {
    opens: StdMutex<Vec<String>>,
    ports: StdMutex<Vec<u16>>,
}

impl LoopbackBackend {
    fn opened_ports(&self) -> Vec<u16> {
        self.ports.lock().unwrap().clone()
    }

    fn last_port(&self) -> u16 {
        *self
            .ports
            .lock()
            .unwrap()
            .last()
            .expect("a tunnel was opened")
    }

    fn record_port(&self, port: u16) {
        self.ports.lock().unwrap().push(port);
    }
}

/// A tunnel backend that opens the first tunnel normally, then hands out
/// listeners that accept a connection and answer the database handshake with
/// garbage before hanging up.
///
/// That is what a reconnect into a database that stopped answering looks like:
/// the SSH hop comes up, the loopback listener exists, and the database
/// handshake fails fast.
#[derive(Default)]
struct BrokenHandshakeBackend {
    inner: Arc<LoopbackBackend>,
    opens: std::sync::atomic::AtomicUsize,
}

impl TunnelBackend for BrokenHandshakeBackend {
    fn open(
        &self,
        key: &str,
        cfg: &SshConfig,
        remote_host: &str,
        remote_port: u16,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<Tunnel, SshTunnelError> {
        // The first tunnel belongs to the already-working session.
        if self.opens.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            return self
                .inner
                .open(key, cfg, remote_host, remote_port, password, passphrase);
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| SshTunnelError::Failed(format!("bind: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| SshTunnelError::Failed(format!("addr: {e}")))?
            .port();
        self.inner.record_port(port);
        let (worker, closer) = shutdown_pair();
        std::thread::spawn(move || {
            use std::io::Write;
            let _ = listener.set_nonblocking(true);
            while !worker.requested() {
                match listener.accept() {
                    // A byte no PostgreSQL client accepts as an SSL response,
                    // followed by a close: the handshake cannot complete.
                    Ok((mut stream, _)) => {
                        let _ = stream.write_all(&[0xFF, 0xFF, 0xFF, 0xFF]);
                        let _ = stream.flush();
                        drop(stream);
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(1)),
                }
            }
            drop(listener);
            worker.complete();
        });
        Ok(Tunnel::with_closer(
            port,
            Box::new(move || {
                closer.close();
            }),
        ))
    }

    fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String> {
        self.inner.probe_host_trust(host, port)
    }

    fn enroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.inner.enroll_host_trust(host, port, accepted)
    }

    fn reenroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
        self.inner.reenroll_host_trust(host, port, accepted)
    }
}

impl TunnelBackend for LoopbackBackend {
    fn open(
        &self,
        key: &str,
        _cfg: &SshConfig,
        _remote_host: &str,
        _remote_port: u16,
        _password: Option<&str>,
        _passphrase: Option<&str>,
    ) -> Result<Tunnel, SshTunnelError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| SshTunnelError::Failed(format!("bind: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| SshTunnelError::Failed(format!("addr: {e}")))?
            .port();
        self.opens.lock().unwrap().push(key.to_string());
        self.ports.lock().unwrap().push(port);
        let (worker, closer) = shutdown_pair();
        std::thread::spawn(move || {
            // Own the listener for as long as the tunnel is open; teardown
            // drops it before acknowledging the close.
            while !worker.requested() {
                std::thread::sleep(Duration::from_millis(1));
            }
            drop(listener);
            worker.complete();
        });
        Ok(Tunnel::with_closer(
            port,
            Box::new(move || {
                closer.close();
            }),
        ))
    }

    fn probe_host_trust(&self, host: &str, port: u16) -> Result<SshHostTrustState, String> {
        Ok(SshHostTrustState::Unknown {
            host: host.to_string(),
            port,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:fake".into(),
        })
    }

    fn enroll_host_trust(
        &self,
        host: &str,
        port: u16,
        accepted: &HostKeyFingerprint,
    ) -> Result<SshHostTrustState, String> {
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
        self.enroll_host_trust(host, port, accepted)
    }
}

/// The three resources one connection owns, plus a fake SSH backend.
struct Rig {
    id: String,
    backend: Arc<LoopbackBackend>,
    pool: tokio::sync::Mutex<ConnectionPoolManager>,
    ssh: StdMutex<SshTunnelManager>,
    cancel: CancelRegistry,
}

impl Rig {
    fn new(id: &str) -> Self {
        let backend = Arc::new(LoopbackBackend::default());
        Self::with_backend(id, backend.clone(), backend)
    }

    /// A rig whose tunnel backend is `tunnel_backend`; `loopback` records the
    /// ports opened for the assertions.
    fn with_backend(
        id: &str,
        loopback: Arc<LoopbackBackend>,
        tunnel_backend: Arc<dyn TunnelBackend>,
    ) -> Self {
        Self {
            id: id.to_string(),
            backend: loopback,
            pool: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
            ssh: StdMutex::new(SshTunnelManager::new(tunnel_backend)),
            cancel: CancelRegistry::new(),
        }
    }

    /// Establish a working session the way `commit` does: pool handle, tunnel,
    /// and cancellation handle all live under `id`.
    async fn live_session(&self) -> u16 {
        let tunnel = {
            let backend = self.ssh.lock().unwrap().backend_clone();
            backend
                .open(&self.id, &ssh_config(), "db.internal", 5432, None, None)
                .expect("open tunnel")
        };
        let port = tunnel.local_port;
        self.ssh
            .lock()
            .unwrap()
            .insert_tunnel(self.id.clone(), tunnel);

        // The interrupt handle is taken from the connection that is about to be
        // pooled, so it can never outlive the session it interrupts.
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let interrupt = conn.get_interrupt_handle();
        self.pool
            .lock()
            .await
            .register(&self.id, DbHandle::sqlite(conn));
        self.cancel
            .set_sqlite(&self.id, SqliteCancel::new(interrupt));
        self.cancel.mark_cancelled(&self.id);
        port
    }

    fn tunnel_port(&self) -> Option<u16> {
        self.ssh.lock().unwrap().get_local_port(&self.id)
    }

    async fn pool_handle_is_live(&mut self) -> bool {
        match self.pool.lock().await.acquire(&self.id) {
            Some(DbHandle::Sqlite(conn)) => {
                let conn = conn.try_lock().expect("sqlite connection free");
                conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                    .is_ok()
            }
            _ => false,
        }
    }

    fn cancel_handle_present(&self) -> bool {
        self.cancel.get(&self.id).is_some()
    }
}

fn ssh_config() -> SshConfig {
    SshConfig::new(
        "jump.internal".into(),
        22,
        "tunnel".into(),
        "password".into(),
    )
}

/// A config that asks for an SSH tunnel, so attempts open one.
fn tunneled_config() -> DbConfig {
    DbConfig {
        db_type: "postgresql".into(),
        host: "db.internal".into(),
        port: Some(5432),
        username: Some("app".into()),
        password: Some("pw".into()),
        database: Some("appdb".into()),
        ssh_host: Some("jump.internal".into()),
        ssh_port: Some(22),
        ssh_user: Some("tunnel".into()),
        ssh_auth_method: Some("password".into()),
        ssh_password: Some("pw".into()),
        ..Default::default()
    }
}

/// True when the loopback endpoint `port` accepts a TCP connection.
fn reachable(port: u16) -> bool {
    let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok()
}

/// Criterion: disconnect closes the pool, the SSH tunnel, and cancellation
/// handles together.
#[tokio::test]
async fn disconnect_closes_pool_tunnel_and_cancel_handles() {
    let mut rig = Rig::new("conn-1");
    rig.live_session().await;
    assert!(rig.pool_handle_is_live().await, "session starts live");
    assert!(rig.tunnel_port().is_some());
    assert!(rig.cancel_handle_present());

    teardown_connection(&rig.id, &rig.pool, &rig.ssh, &rig.cancel).await;

    assert!(
        !rig.pool_handle_is_live().await,
        "the pool handle is closed"
    );
    assert!(
        rig.tunnel_port().is_none(),
        "the SSH tunnel handle is closed and removed"
    );
    assert!(
        !rig.cancel_handle_present(),
        "the cancellation handle is closed"
    );
    assert!(
        !rig.cancel.is_cancelled(&rig.id),
        "no stale cancel-requested flag survives teardown"
    );
}

/// A saved connection is the target every staged write is validated against, so
/// an edit that MOVES it must close the session opened with the old config —
/// otherwise commands keep writing through a configuration the store no longer
/// holds (the validated config is not the one in use).
#[tokio::test]
async fn editing_the_target_of_a_saved_connection_closes_its_live_session() {
    let mut rig = Rig::new("conn-retarget");
    rig.live_session().await;
    assert!(rig.pool_handle_is_live().await, "session starts live");
    let port = rig.tunnel_port().expect("a tunnel is open");
    assert!(reachable(port));

    let before = saved_connection("db.internal");
    // Same saved id, different host: writes would land somewhere else.
    let after = saved_connection("prod.internal");

    let closed =
        close_session_if_retargeted(&rig.id, &before, &after, &rig.pool, &rig.ssh, &rig.cancel)
            .await;

    assert!(closed, "a moved target closes the session");
    assert!(
        !rig.pool_handle_is_live().await,
        "the stale pool handle is gone"
    );
    assert!(rig.tunnel_port().is_none(), "its tunnel is closed");
    assert!(
        !reachable(port),
        "the old loopback listener no longer proxies the database"
    );
    assert!(!rig.cancel_handle_present(), "its cancel handle is gone");
}

/// The other half: renaming or refiling a connection is not a retarget, so it
/// must never drop a working session (that would disconnect users for a label).
#[tokio::test]
async fn editing_only_metadata_leaves_the_live_session_alone() {
    let mut rig = Rig::new("conn-rename");
    rig.live_session().await;
    let port = rig.tunnel_port().expect("a tunnel is open");

    let before = saved_connection("db.internal");
    let mut after = saved_connection("db.internal");
    after.name = "Renamed environment".into();
    after.folder_id = Some("folder-1".into());
    after.environment = Some("production".into());
    after.favorite = true;
    after.tag_ids = vec!["tag-1".into()];

    let closed =
        close_session_if_retargeted(&rig.id, &before, &after, &rig.pool, &rig.ssh, &rig.cancel)
            .await;

    assert!(!closed, "a metadata edit is not a retarget");
    assert!(rig.pool_handle_is_live().await, "the session keeps working");
    assert_eq!(rig.tunnel_port(), Some(port), "its tunnel stays open");
    assert!(rig.cancel_handle_present());
}

/// A saved connection shaped like the ones above, so only target/metadata
/// differences matter.
fn saved_connection(host: &str) -> crate::models::Connection {
    crate::models::Connection {
        id: "conn-retarget".into(),
        name: "Local dev".into(),
        db_type: "postgresql".into(),
        host: host.into(),
        port: Some(5432),
        username: Some("app".into()),
        database: Some("appdb".into()),
        folder_id: None,
        keychain_ref: None,
        environment: None,
        favorite: false,
        ssh_host: Some("jump.internal".into()),
        ssh_port: Some(22),
        ssh_user: Some("tunnel".into()),
        ssh_auth_method: Some("password".into()),
        ssh_private_key_path: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        tag_ids: Vec::new(),
        use_keychain: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

/// Criterion: no loopback listener remains reachable after a viewer is closed
/// or disconnected.
#[tokio::test]
async fn disconnect_leaves_no_reachable_loopback_listener() {
    let rig = Rig::new("conn-2");
    let port = rig.live_session().await;
    assert!(
        reachable(port),
        "the tunnel's loopback listener accepts connections while the viewer is open"
    );

    teardown_connection(&rig.id, &rig.pool, &rig.ssh, &rig.cancel).await;

    assert!(
        !reachable(port),
        "no loopback listener remains reachable after disconnect (port {port})"
    );
}

/// Criterion: a failed reconnect preserves the previously working session and
/// reports the failure.
#[tokio::test]
async fn failed_reconnect_keeps_the_working_session_and_its_listener() {
    let mut rig = Rig::new("conn-3");
    let old_port = rig.live_session().await;

    // A reconnect attempt opens its own private tunnel, then the database
    // handshake fails.
    let attempt = ConnectionAttempt::begin(&rig.id, &tunneled_config(), 5432, &rig.ssh)
        .await
        .unwrap();
    let new_port = rig.backend.last_port();
    assert_ne!(new_port, old_port, "the attempt opened a second tunnel");
    assert_eq!(
        rig.tunnel_port(),
        Some(old_port),
        "an in-flight attempt publishes nothing: the live tunnel is untouched"
    );

    attempt.abort();

    assert!(
        rig.pool_handle_is_live().await,
        "the previously working session still answers queries after a failed reconnect"
    );
    assert_eq!(
        rig.tunnel_port(),
        Some(old_port),
        "the working session keeps its tunnel"
    );
    assert!(
        reachable(old_port),
        "the working session's loopback listener is still reachable"
    );
    assert!(
        rig.cancel_handle_present(),
        "the working session keeps its cancellation handle"
    );
    assert!(
        !reachable(new_port),
        "the failed attempt's listener was released, so it cannot linger as a proxy"
    );
}

/// Criterion: a failed reconnect preserves the previously working session and
/// reports the failure — driven through the real connect entry point.
///
/// `run_pg_connect` opens the attempt's tunnel, the database handshake fails,
/// and the caller must get the failure back while the session that was working
/// when the reconnect started is still complete: pool handle, tunnel, reachable
/// loopback listener and cancellation handle. The attempt's own listener must be
/// gone, so a failed reconnect cannot leave a second proxy behind.
#[tokio::test]
async fn failed_reconnect_through_the_connect_path_reports_and_preserves_the_session() {
    let loopback = Arc::new(LoopbackBackend::default());
    let backend = Arc::new(BrokenHandshakeBackend {
        inner: loopback.clone(),
        opens: std::sync::atomic::AtomicUsize::new(0),
    });
    let mut rig = Rig::with_backend("conn-9", loopback.clone(), backend);
    let old_port = rig.live_session().await;
    assert!(
        reachable(old_port),
        "the session works before the reconnect"
    );

    let err = crate::commands::db_viewer::run_pg_connect(
        &rig.id,
        &tunneled_config(),
        &rig.ssh,
        &rig.pool,
        &rig.cancel,
    )
    .await
    .expect_err("a reconnect the database cannot complete must fail");

    assert!(
        err.starts_with("Connection failed"),
        "the failure is reported to the caller: {err}"
    );
    assert!(
        err.len() > "Connection failed: ".len(),
        "the reported failure carries a reason: {err}"
    );
    assert!(
        rig.pool_handle_is_live().await,
        "the previously working session still answers queries after a failed reconnect"
    );
    assert_eq!(
        rig.tunnel_port(),
        Some(old_port),
        "the working session keeps its own tunnel"
    );
    assert!(
        reachable(old_port),
        "the working session's loopback listener is still reachable (port {old_port})"
    );
    assert!(
        rig.cancel_handle_present(),
        "the working session keeps its cancellation handle"
    );
    assert_eq!(
        rig.ssh.lock().unwrap().active_count(),
        1,
        "the failed attempt published no tunnel of its own"
    );
    let failed_attempt_port = rig.backend.last_port();
    assert_ne!(failed_attempt_port, old_port);
    assert!(
        !reachable(failed_attempt_port),
        "the failed attempt's listener was released (port {failed_attempt_port})"
    );
}

/// Committing a verified attempt replaces the session and releases the tunnel
/// it superseded.
#[tokio::test]
async fn commit_replaces_the_session_and_closes_the_superseded_listener() {
    let rig = Rig::new("conn-4");
    let old_port = rig.live_session().await;

    let attempt = ConnectionAttempt::begin(&rig.id, &tunneled_config(), 5432, &rig.ssh)
        .await
        .unwrap();
    let new_port = rig.backend.last_port();
    let handle = DbHandle::sqlite(rusqlite::Connection::open_in_memory().unwrap());
    attempt
        .commit(handle, None, &rig.pool, &rig.ssh, &rig.cancel)
        .await;

    assert_eq!(
        rig.tunnel_port(),
        Some(new_port),
        "the committed attempt's tunnel is live"
    );
    assert!(
        reachable(new_port),
        "the new session's loopback listener is reachable"
    );
    assert!(
        !reachable(old_port),
        "the superseded session's loopback listener is closed"
    );
    assert!(
        !rig.cancel_handle_present(),
        "a commit without a cancellation handle does not inherit the old one"
    );
}

/// A reconnect that drops the SSH configuration must not leave the previous
/// tunnel proxying a session that no longer uses it.
#[tokio::test]
async fn commit_without_a_tunnel_closes_the_previous_one() {
    let rig = Rig::new("conn-8");
    let old_port = rig.live_session().await;
    assert!(reachable(old_port));

    let direct = DbConfig {
        db_type: "postgresql".into(),
        host: "db.internal".into(),
        port: Some(5432),
        ..Default::default()
    };
    let attempt = ConnectionAttempt::begin(&rig.id, &direct, 5432, &rig.ssh)
        .await
        .unwrap();
    assert!(!attempt.via_tunnel());
    let handle = DbHandle::sqlite(rusqlite::Connection::open_in_memory().unwrap());
    attempt
        .commit(handle, None, &rig.pool, &rig.ssh, &rig.cancel)
        .await;

    assert_eq!(
        rig.tunnel_port(),
        None,
        "the stale tunnel is no longer the connection's"
    );
    assert!(
        !reachable(old_port),
        "the stale tunnel's loopback listener is closed"
    );
}

/// A connection that never tunnelled keeps its direct target, and a tunneled
/// one targets loopback.
#[tokio::test]
async fn attempt_target_reports_loopback_only_when_tunnelled() {
    let rig = Rig::new("conn-5");
    let direct = DbConfig {
        db_type: "postgresql".into(),
        host: "db.internal".into(),
        port: Some(5433),
        ..Default::default()
    };
    let direct_attempt = ConnectionAttempt::begin(&rig.id, &direct, 5432, &rig.ssh)
        .await
        .unwrap();
    assert!(!direct_attempt.via_tunnel());
    assert_eq!(
        direct_attempt.target(&direct, 5432),
        ("db.internal".to_string(), 5433, false)
    );
    direct_attempt.abort();

    let tunnelled = ConnectionAttempt::begin(&rig.id, &tunneled_config(), 5432, &rig.ssh)
        .await
        .unwrap();
    assert!(tunnelled.via_tunnel());
    let (host, port, via) = tunnelled.target(&tunneled_config(), 5432);
    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, rig.backend.last_port());
    assert!(via);
    assert_eq!(
        rig.tunnel_port(),
        None,
        "an uncommitted attempt is not in the tunnel map"
    );
    tunnelled.abort();
}

/// Teardown is idempotent: a second disconnect (viewer unmount after an
/// explicit disconnect) must not panic or resurrect state.
#[tokio::test]
async fn teardown_is_idempotent() {
    let mut rig = Rig::new("conn-6");
    rig.live_session().await;
    teardown_connection(&rig.id, &rig.pool, &rig.ssh, &rig.cancel).await;
    teardown_connection(&rig.id, &rig.pool, &rig.ssh, &rig.cancel).await;

    assert!(!rig.pool_handle_is_live().await);
    assert!(rig.tunnel_port().is_none());
    assert!(!rig.cancel_handle_present());
}

/// The cancel handle the registry exposes is typed per engine; committing one
/// installs exactly that handle.
#[tokio::test]
async fn commit_installs_the_cancellation_handle_it_was_given() {
    let rig = Rig::new("conn-7");
    let attempt = ConnectionAttempt::begin(&rig.id, &Default::default(), 5432, &rig.ssh)
        .await
        .unwrap();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let cancel = CancelHandle::Sqlite(SqliteCancel::new(conn.get_interrupt_handle()));
    attempt
        .commit(
            DbHandle::sqlite(conn),
            Some(cancel),
            &rig.pool,
            &rig.ssh,
            &rig.cancel,
        )
        .await;
    assert!(matches!(
        rig.cancel.get(&rig.id),
        Some(CancelHandle::Sqlite(_))
    ));
}
