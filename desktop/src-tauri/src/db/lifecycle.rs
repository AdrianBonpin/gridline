//! Connection lifecycle: gather, publish, and release everything one
//! connection owns.
//!
//! A connection owns three things that must be freed together: its **pool
//! handle** (the live database session), its **SSH tunnel** (a loopback
//! listener that proxies every client of that session), and its **cancellation
//! handles** (the tokens/interrupts that abort a running statement). Freeing
//! one and leaking the others is the bug this module exists to prevent: a
//! surviving listener is a live proxy to the database that no session owns any
//! more, and a surviving pool handle keeps that session answering queries after
//! the user disconnected.
//!
//! Two rules follow from that, and both are encoded here rather than in the
//! Tauri commands:
//!
//! 1. **Teardown is atomic in ordering.** [`teardown_connection`] removes the
//!    pool handle first (it is what uses the tunnel and the cancel token), then
//!    takes the tunnel out of the manager and closes it — which waits until the
//!    forwarding worker has released the loopback listener — and only then
//!    clears cancellation state.
//! 2. **A connect attempt publishes nothing until it succeeds.** A
//!    [`ConnectionAttempt`] opens its tunnel privately; a failed reconnect
//!    ([`ConnectionAttempt::abort`]) releases only what the attempt itself
//!    opened, so the session it was replacing keeps its pool, tunnel, cancel
//!    token, and listener.

use crate::cancel::{CancelHandle, CancelRegistry};
use crate::commands::ssh::{SshTunnelManager, Tunnel};
use crate::db::pool::{ConnectionPoolManager, DbConfig, DbHandle};
use std::sync::Mutex;

/// An in-flight connection attempt: resources gathered but not yet live.
pub(crate) struct ConnectionAttempt {
    connection_id: String,
    tunnel: Option<Tunnel>,
}

impl ConnectionAttempt {
    /// Open the tunnel this attempt needs, if the config asks for one.
    ///
    /// The tunnel is deliberately **not** inserted into `SshTunnelManager`, so
    /// a reconnect in flight never disturbs the tunnel of the live session it
    /// is replacing. Any failure here — including an SSH host key that is
    /// unknown or changed — returns an error and leaves that session alone.
    pub(crate) async fn begin(
        connection_id: &str,
        config: &DbConfig,
        default_remote_port: u16,
        ssh_manager: &Mutex<SshTunnelManager>,
    ) -> Result<Self, String> {
        let Some(ssh_cfg) = config.ssh_config() else {
            return Ok(Self {
                connection_id: connection_id.to_string(),
                tunnel: None,
            });
        };
        let key = connection_id.to_string();
        let remote_host = config.host.clone();
        let remote_port = config.port.unwrap_or(default_remote_port as i64) as u16;
        let password = config.ssh_password.clone();
        let passphrase = config.ssh_passphrase.clone();
        // The blocking ssh2 handshake runs on a blocking thread so it never
        // stalls the async runtime, exactly as the SSH test path does.
        let backend = ssh_manager
            .lock()
            .map_err(|e| e.to_string())?
            .backend_clone();
        let tunnel = tokio::task::spawn_blocking(move || {
            backend.open(
                &key,
                &ssh_cfg,
                &remote_host,
                remote_port,
                password.as_deref(),
                passphrase.as_deref(),
            )
        })
        .await
        .map_err(|e| format!("Connection failed: {e}"))?
        .map_err(|e: crate::commands::ssh_trust::SshTunnelError| {
            crate::commands::db_viewer::sanitize_error(&e.message())
        })?;
        Ok(Self {
            connection_id: connection_id.to_string(),
            tunnel: Some(tunnel),
        })
    }

    /// The `(host, port)` the database client must connect to, plus whether
    /// that endpoint is this attempt's loopback tunnel.
    pub(crate) fn target(&self, config: &DbConfig, default_port: u16) -> (String, u16, bool) {
        match &self.tunnel {
            Some(tunnel) => ("127.0.0.1".to_string(), tunnel.local_port, true),
            None => (
                config.host.clone(),
                config.port.unwrap_or(default_port as i64) as u16,
                false,
            ),
        }
    }

    /// Whether this attempt connects through a tunnel (so TLS must be resolved
    /// against a loopback peer).
    pub(crate) fn via_tunnel(&self) -> bool {
        self.tunnel.is_some()
    }

    /// Publish an established session, superseding the one it replaces.
    ///
    /// The pool handle goes live first so the new session answers queries
    /// immediately; the tunnel is swapped last, after nothing refers to the old
    /// one, so releasing it cannot cut off a session still in use.
    pub(crate) async fn commit(
        self,
        handle: DbHandle,
        cancel: Option<CancelHandle>,
        pool_manager: &tokio::sync::Mutex<ConnectionPoolManager>,
        ssh_manager: &Mutex<SshTunnelManager>,
        cancel_registry: &CancelRegistry,
    ) {
        let Self {
            connection_id,
            tunnel,
        } = self;
        pool_manager.lock().await.register(&connection_id, handle);
        // Cancellation state belongs to the session that just went live: install
        // the new handle, or clear a stale one so a later `cancel_query` can
        // never address the session this commit replaced.
        match cancel {
            Some(cancel) => cancel_registry.set(&connection_id, cancel),
            None => cancel_registry.forget(&connection_id),
        }
        if let Some(tunnel) = tunnel {
            // Close anything this replaced outside the manager's lock: closing
            // a tunnel waits for its forwarding worker.
            let replaced = {
                let mut manager = lock_tunnels(ssh_manager);
                manager.replace_tunnel(connection_id.clone(), tunnel)
            };
            drop(replaced);
        } else {
            // A reconnect that no longer tunnels must not leave the previous
            // tunnel proxying a session that does not use it.
            let stale = take_tunnel(ssh_manager, &connection_id);
            drop(stale);
        }
    }

    /// Abandon the attempt, publishing nothing.
    ///
    /// Dropping the attempt releases the tunnel it opened (and with it that
    /// attempt's loopback listener). The live session keeps its own pool
    /// handle, tunnel, listener, and cancellation handles untouched.
    pub(crate) fn abort(self) {
        drop(self);
    }
}

/// Release everything a connection owns: pool handle, SSH tunnel, and
/// cancellation state.
///
/// This is the only teardown path. `db_disconnect`, connection deletion, and
/// demo-database regeneration all go through it, so they cannot free different
/// subsets of a connection's resources.
pub(crate) async fn teardown_connection(
    connection_id: &str,
    pool_manager: &tokio::sync::Mutex<ConnectionPoolManager>,
    ssh_manager: &Mutex<SshTunnelManager>,
    cancel_registry: &CancelRegistry,
) {
    // The pool handle is what talks through the tunnel and holds the cancel
    // token's session: drop it before anything it depends on.
    pool_manager.lock().await.remove(connection_id);
    // Take the tunnel out of the map under the lock, then close it outside:
    // closing waits for the forwarding worker to release the loopback
    // listener, which must not block other connections' tunnel bookkeeping.
    let tunnel = take_tunnel(ssh_manager, connection_id);
    drop(tunnel);
    // Cancellation last: by now there is no session left that could be
    // cancelled, and no handle that could address another connection's.
    cancel_registry.forget(connection_id);
}

/// Lock the tunnel manager, recovering from poisoning.
///
/// A panic while the manager was locked must not turn into a leaked listener:
/// teardown still needs the map.
fn lock_tunnels(
    ssh_manager: &Mutex<SshTunnelManager>,
) -> std::sync::MutexGuard<'_, SshTunnelManager> {
    match ssh_manager.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Take a connection's tunnel out of the manager (or `None` if it has none).
fn take_tunnel(ssh_manager: &Mutex<SshTunnelManager>, connection_id: &str) -> Option<Tunnel> {
    lock_tunnels(ssh_manager).take_tunnel(connection_id)
}

/// Close a connection's tunnel without touching its pool handle or cancellation
/// state.
///
/// Used when a connection's target stops tunnelling (an edited connection
/// reconnecting without SSH, or a switch to SQLite): the old proxy must not stay
/// reachable once nothing uses it.
pub(crate) fn close_tunnel(ssh_manager: &Mutex<SshTunnelManager>, connection_id: &str) {
    drop(take_tunnel(ssh_manager, connection_id));
}

#[cfg(test)]
#[path = "lifecycle.test.rs"]
mod tests;
