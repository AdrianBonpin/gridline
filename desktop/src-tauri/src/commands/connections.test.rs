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
    std::sync::Mutex::new(Store::from_connection(conn))
}
