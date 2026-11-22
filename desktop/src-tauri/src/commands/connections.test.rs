use super::*;

fn mariadb_input() -> ConnectionInput {
    ConnectionInput {
        name: "Maria local".into(),
        db_type: "mariadb".into(),
        host: "127.0.0.1".into(),
        port: Some(3306),
        username: Some("root".into()),
        folder_id: None,
        tag_ids: vec![],
        password: None,
        database: Some("test".into()),
        environment: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssh_password: None,
        ssh_passphrase: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        use_keychain: true,
    }
}

#[test]
fn validate_accepts_mariadb_with_port() {
    assert!(validate(&mariadb_input()).is_ok());
}

#[test]
fn validate_rejects_mariadb_without_port() {
    let mut input = mariadb_input();
    input.port = None;
    assert!(
        validate(&input).is_err(),
        "mariadb requires a port like mysql"
    );
}

#[test]
fn validate_rejects_unknown_db_type() {
    let mut input = mariadb_input();
    input.db_type = "oracle".into();
    assert!(validate(&input).is_err());
}

/// Saving a connection with a TLS mode we cannot honor must be refused, naming
/// the valid set — a stored mode is later resolved by every connect path, so an
/// unrecognized value must never reach the store.
#[test]
fn validate_rejects_unknown_ssl_mode_names_the_valid_set() {
    let mut input = mariadb_input();
    input.ssl_mode = Some("verify-full-ish".into());
    let err = validate(&input).expect_err("an unknown TLS mode must be refused");
    assert!(err.contains("verify-full-ish"), "got: {err}");
    for valid in crate::db::tls::VALID_SSL_MODES {
        assert!(err.contains(valid), "error {err} must name {valid}");
    }
}

#[test]
fn validate_accepts_every_supported_ssl_mode_and_no_mode() {
    for mode in crate::db::tls::VALID_SSL_MODES {
        let mut input = mariadb_input();
        input.ssl_mode = Some(mode.into());
        assert!(validate(&input).is_ok(), "{mode} should be accepted");
    }
    let mut input = mariadb_input();
    input.ssl_mode = Some(String::new());
    assert!(validate(&input).is_ok(), "a blank mode means 'no mode'");
    input.ssl_mode = None;
    assert!(validate(&input).is_ok());
}

/// The update path validates through the same function, so an edit cannot sneak
/// an unknown mode in either.
#[test]
fn updating_a_connection_rejects_an_unknown_ssl_mode_and_keeps_the_stored_one() {
    let st = test_state();
    let created = create_connection_inner(&st, mariadb_input()).unwrap();

    let mut edit = mariadb_input();
    edit.ssl_mode = Some("bogus".into());
    let err = update_connection_inner(&st, created.id.clone(), edit)
        .expect_err("an unknown TLS mode must be refused on update");
    assert!(err.contains("bogus"), "got: {err}");

    let stored = get_connections_inner(&st).unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].ssl_mode, created.ssl_mode, "store is unchanged");
}

fn test_state() -> std::sync::Mutex<Store> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    std::sync::Mutex::new(Store::from_connection(conn).expect("test store"))
}

// ---------------------------------------------------------------------------
// An edit that moves a connection must not keep the session it invalidated
// ---------------------------------------------------------------------------

/// A tunnel backend that is never used: these connections do not tunnel, and a
/// teardown must not need one.
struct NoTunnels;

impl crate::commands::ssh::TunnelBackend for NoTunnels {
    fn open(
        &self,
        _key: &str,
        _cfg: &crate::models::SshConfig,
        _remote_host: &str,
        _remote_port: u16,
        _password: Option<&str>,
        _passphrase: Option<&str>,
    ) -> Result<crate::commands::ssh::Tunnel, crate::commands::ssh_trust::SshTunnelError> {
        Err(crate::commands::ssh_trust::SshTunnelError::Failed(
            "no SSH connectivity in tests".into(),
        ))
    }

    fn probe_host_trust(
        &self,
        host: &str,
        port: u16,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        Ok(crate::models::ssh_trust::SshHostTrustState::Unknown {
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
        accepted: &crate::models::ssh_trust::HostKeyFingerprint,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        Ok(crate::models::ssh_trust::SshHostTrustState::Trusted {
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
        accepted: &crate::models::ssh_trust::HostKeyFingerprint,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        self.enroll_host_trust(host, port, accepted)
    }
}

/// A saved connection whose live pool handle is registered, plus the managers an
/// update needs. The handle is a real SQLite session, so "closed" is observable.
async fn live_update_rig(
    host: &str,
) -> (
    std::sync::Mutex<Store>,
    crate::models::Connection,
    tokio::sync::Mutex<crate::db::pool::ConnectionPoolManager>,
    std::sync::Mutex<crate::commands::ssh::SshTunnelManager>,
    crate::cancel::CancelRegistry,
) {
    let st = test_state();
    let mut input = mariadb_input();
    input.host = host.into();
    let created = create_connection_inner(&st, input).unwrap();

    let mut manager = crate::db::pool::ConnectionPoolManager::new();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    manager.register(&created.id, crate::db::pool::DbHandle::sqlite(conn));

    (
        st,
        created,
        tokio::sync::Mutex::new(manager),
        std::sync::Mutex::new(crate::commands::ssh::SshTunnelManager::new(
            std::sync::Arc::new(NoTunnels),
        )),
        crate::cancel::CancelRegistry::new(),
    )
}

/// `update_connection` validated and stored one configuration while a live pool
/// handle kept talking to the previous one — so every write after the edit went
/// through a config the store no longer held. Retargeting must close that
/// session, and the next command reconnects from what was saved.
#[tokio::test]
async fn retargeting_a_connection_closes_the_session_opened_with_the_old_config() {
    let (st, created, pm, ssh, cancel) = live_update_rig("db1.example.com").await;
    assert!(pm.lock().await.contains(&created.id), "session starts live");

    let mut moved = mariadb_input();
    moved.host = "db2.example.com".into();
    let updated = update_connection_and_close_stale_session(
        &st,
        &pm,
        &ssh,
        &cancel,
        created.id.clone(),
        moved,
    )
    .await
    .expect("the edit is saved");

    assert_eq!(updated.host, "db2.example.com");
    assert_eq!(
        get_connections_inner(&st).unwrap()[0].host,
        "db2.example.com",
        "the store holds the validated configuration"
    );
    assert!(
        !pm.lock().await.contains(&created.id),
        "the session opened with the old target is closed, not reused"
    );
}

/// The mirror image: an edit that only relabels or refiles a connection is not a
/// retarget, so its working session must survive.
#[tokio::test]
async fn relabelling_a_connection_keeps_its_live_session() {
    let (st, created, pm, ssh, cancel) = live_update_rig("db1.example.com").await;

    let mut renamed = mariadb_input();
    renamed.host = "db1.example.com".into();
    renamed.name = "Renamed environment".into();
    renamed.environment = Some("production".into());
    update_connection_and_close_stale_session(&st, &pm, &ssh, &cancel, created.id.clone(), renamed)
        .await
        .expect("the edit is saved");

    assert!(
        pm.lock().await.contains(&created.id),
        "a metadata edit must not disconnect a working session"
    );
}
