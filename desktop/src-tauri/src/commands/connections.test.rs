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
    assert!(validate(&input).is_err(), "mariadb requires a port like mysql");
}

#[test]
fn validate_rejects_unknown_db_type() {
    let mut input = mariadb_input();
    input.db_type = "oracle".into();
    assert!(validate(&input).is_err());
}
