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
        Self {
            id: id.to_string(),
            backend: backend.clone(),
            pool: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
            ssh: StdMutex::new(SshTunnelManager::new(backend)),
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
            .register(&self.id, DbHandle::Sqlite(conn));
        self.cancel
            .set_sqlite(&self.id, SqliteCancel::new(interrupt));
        self.cancel.mark_cancelled(&self.id);
        port
    }

    fn tunnel_port(&self) -> Option<u16> {
        self.ssh.lock().unwrap().get_local_port(&self.id)
    }

    async fn pool_handle_is_live(&mut self) -> bool {
        let mut guard = self.pool.lock().await;
        match guard.get(&self.id) {
            Some(DbHandle::Sqlite(conn)) => conn
                .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .is_ok(),
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
    let handle = DbHandle::Sqlite(rusqlite::Connection::open_in_memory().unwrap());
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
    let handle = DbHandle::Sqlite(rusqlite::Connection::open_in_memory().unwrap());
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
            DbHandle::Sqlite(conn),
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
