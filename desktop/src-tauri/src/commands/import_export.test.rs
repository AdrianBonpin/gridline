use super::*;
use crate::models::{Connection, ConnectionInput, FolderInput, TagInput};
use crate::store::Store;

fn store() -> Mutex<Store> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    Mutex::new(Store::from_connection(conn))
}

/// A unique on-disk store (the production shape) so the test can inspect the
/// bytes the store actually wrote.
fn temp_store(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "gridline_import_export_{tag}_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("gridline.db");
    (dir, db)
}

/// Every non-secret setting a saved connection can carry.
fn full_input(name: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        db_type: "mysql".into(),
        host: "db.example.com".into(),
        port: Some(3307),
        username: Some("admin".into()),
        database: Some("app".into()),
        environment: Some("staging".into()),
        folder_id: None,
        tag_ids: vec![],
        password: None,
        ssh_host: Some("jump.example.com".into()),
        ssh_port: Some(2222),
        ssh_user: Some("tunnel".into()),
        ssh_auth_method: Some("Key".into()),
        ssh_private_key_path: Some("/home/me/.ssh/id_ed25519".into()),
        ssh_password: None,
        ssh_passphrase: None,
        ssl_mode: Some("verify-full".into()),
        ssl_ca_path: Some("/certs/ca.pem".into()),
        ssl_cert_path: Some("/certs/client.pem".into()),
        ssl_key_path: Some("/certs/client-key.pem".into()),
        use_keychain: false,
    }
}

/// Assert every non-secret, non-identity setting survived, one field at a time.
fn assert_settings_equal(expected: &Connection, actual: &Connection) {
    assert_eq!(actual.name, expected.name, "name");
    assert_eq!(actual.db_type, expected.db_type, "db_type");
    assert_eq!(actual.host, expected.host, "host");
    assert_eq!(actual.port, expected.port, "port");
    assert_eq!(actual.username, expected.username, "username");
    assert_eq!(actual.database, expected.database, "database");
    assert_eq!(actual.environment, expected.environment, "environment");
    assert_eq!(actual.favorite, expected.favorite, "favorite");
    assert_eq!(actual.ssh_host, expected.ssh_host, "ssh_host");
    assert_eq!(actual.ssh_port, expected.ssh_port, "ssh_port");
    assert_eq!(actual.ssh_user, expected.ssh_user, "ssh_user");
    assert_eq!(
        actual.ssh_auth_method, expected.ssh_auth_method,
        "ssh_auth_method"
    );
    assert_eq!(
        actual.ssh_private_key_path, expected.ssh_private_key_path,
        "ssh_private_key_path"
    );
    assert_eq!(actual.ssl_mode, expected.ssl_mode, "ssl_mode");
    assert_eq!(actual.ssl_ca_path, expected.ssl_ca_path, "ssl_ca_path");
    assert_eq!(actual.ssl_cert_path, expected.ssl_cert_path, "ssl_cert_path");
    assert_eq!(actual.ssl_key_path, expected.ssl_key_path, "ssl_key_path");
    assert_eq!(actual.use_keychain, expected.use_keychain, "use_keychain");
    assert_eq!(actual.folder_id, expected.folder_id, "folder_id");
    assert_eq!(actual.tag_ids, expected.tag_ids, "tag_ids");
}

fn only_connection(store: &Mutex<Store>) -> Connection {
    let conns = store.lock().unwrap().get_connections().unwrap();
    assert_eq!(conns.len(), 1, "expected exactly one imported connection");
    conns.into_iter().next().unwrap()
}

#[test]
fn an_export_from_the_app_imports_into_a_clean_store() {
    let source = store();
    let created = source.lock().unwrap().create_connection(full_input("Prod")).unwrap();
    source
        .lock()
        .unwrap()
        .set_connection_favorite(&created.id, true)
        .unwrap();
    let exported = export_connections_inner(&source).unwrap();
    let envelope: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(envelope["version"], 1, "the export is a versioned envelope");
    assert_eq!(
        envelope["connections"].as_array().map(|c| c.len()),
        Some(1),
        "the envelope carries the saved connections"
    );

    let target = store();
    let result = import_connections_inner(&target, exported).unwrap();

    assert_eq!(result.imported, 1, "the app's own export must import");
    assert_eq!(result.skipped, 0);
    assert!(
        result.warnings.is_empty(),
        "a connection with no organization links needs no warning: {:?}",
        result.warnings
    );
    let expected = only_connection(&source);
    let actual = only_connection(&target);
    assert_settings_equal(&expected, &actual);
    assert!(actual.favorite, "favorite survives the round trip");
}

#[test]
fn a_legacy_bare_array_file_still_imports() {
    let target = store();
    // The pre-envelope shape: a bare array, no `version`/`connections` wrapper.
    let legacy = r#"[
        {
            "name": "Legacy",
            "db_type": "mysql",
            "host": "db.example.com",
            "port": 3307,
            "username": "admin",
            "database": "app",
            "environment": "staging",
            "favorite": true,
            "ssh_host": "jump.example.com",
            "ssh_port": 2222,
            "ssh_user": "tunnel",
            "ssh_auth_method": "Key",
            "ssh_private_key_path": "/home/me/.ssh/id_ed25519",
            "ssl_mode": "verify-full",
            "ssl_ca_path": "/certs/ca.pem",
            "ssl_cert_path": "/certs/client.pem",
            "ssl_key_path": "/certs/client-key.pem",
            "tag_ids": [],
            "folder_id": null
        }
    ]"#;

    let result = import_connections_inner(&target, legacy.to_string()).unwrap();

    assert_eq!(result.imported, 1, "a legacy bare-array file must import");
    assert_eq!(result.skipped, 0);
    let actual = only_connection(&target);
    assert_eq!(actual.name, "Legacy");
    assert_eq!(actual.db_type, "mysql");
    assert_eq!(actual.host, "db.example.com");
    assert_eq!(actual.port, Some(3307));
    assert_eq!(actual.username.as_deref(), Some("admin"));
    assert_eq!(actual.database.as_deref(), Some("app"));
    assert_eq!(actual.environment.as_deref(), Some("staging"));
    assert!(actual.favorite, "favorite survives a legacy import");
    assert_eq!(actual.ssh_host.as_deref(), Some("jump.example.com"));
    assert_eq!(actual.ssh_port, Some(2222));
    assert_eq!(actual.ssh_user.as_deref(), Some("tunnel"));
    assert_eq!(actual.ssh_auth_method.as_deref(), Some("Key"));
    assert_eq!(
        actual.ssh_private_key_path.as_deref(),
        Some("/home/me/.ssh/id_ed25519")
    );
    assert_eq!(actual.ssl_mode.as_deref(), Some("verify-full"));
    assert_eq!(actual.ssl_ca_path.as_deref(), Some("/certs/ca.pem"));
    assert_eq!(actual.ssl_cert_path.as_deref(), Some("/certs/client.pem"));
    assert_eq!(actual.ssl_key_path.as_deref(), Some("/certs/client-key.pem"));
    // A legacy file predates the opt-out flag; absent means the default.
    assert!(actual.use_keychain);
    assert_eq!(actual.folder_id, None);
    assert!(actual.tag_ids.is_empty());
}

#[test]
fn resolvable_folder_and_tag_links_are_preserved() {
    let target = store();
    let folder = target
        .lock()
        .unwrap()
        .create_folder(FolderInput {
            name: "Work".into(),
            parent_id: None,
            tag_ids: None,
        })
        .unwrap();
    let tag = target
        .lock()
        .unwrap()
        .create_tag(TagInput {
            name: "env:prod".into(),
            color: "#ef4444".into(),
        })
        .unwrap();
    let file = format!(
        r#"{{"version": 1, "connections": [
            {{"name": "Linked", "db_type": "postgresql", "host": "h", "port": 5432,
              "folder_id": "{}", "tag_ids": ["{}"]}}
        ]}}"#,
        folder.id, tag.id
    );

    let result = import_connections_inner(&target, file).unwrap();

    assert_eq!(result.imported, 1);
    assert!(
        result.warnings.is_empty(),
        "links that resolve locally must not warn: {:?}",
        result.warnings
    );
    let actual = only_connection(&target);
    assert_eq!(actual.folder_id, Some(folder.id));
    assert_eq!(actual.tag_ids, vec![tag.id]);
}

#[test]
fn unresolvable_links_are_dropped_with_a_per_record_warning() {
    let target = store();
    let folder = target
        .lock()
        .unwrap()
        .create_folder(FolderInput {
            name: "Work".into(),
            parent_id: None,
            tag_ids: None,
        })
        .unwrap();
    let tag = target
        .lock()
        .unwrap()
        .create_tag(TagInput {
            name: "env:prod".into(),
            color: "#ef4444".into(),
        })
        .unwrap();
    let file = format!(
        r#"[{{"name": "Partly linked", "db_type": "postgresql", "host": "h", "port": 5432,
             "folder_id": "{}", "tag_ids": ["{}", "ghost-tag"]}},
            {{"name": "Nowhere", "db_type": "postgresql", "host": "h", "port": 5432,
             "folder_id": "ghost-folder", "tag_ids": ["ghost-tag-2"]}}]"#,
        folder.id, tag.id
    );

    let result = import_connections_inner(&target, file).unwrap();

    // Unresolved links never block the record itself.
    assert_eq!(result.imported, 2);
    assert_eq!(result.skipped, 0);

    let conns = target.lock().unwrap().get_connections().unwrap();
    let partly = conns.iter().find(|c| c.name == "Partly linked").unwrap();
    assert_eq!(partly.folder_id, Some(folder.id), "valid folder kept");
    assert_eq!(partly.tag_ids, vec![tag.id.clone()], "valid tag kept");
    let nowhere = conns.iter().find(|c| c.name == "Nowhere").unwrap();
    assert_eq!(nowhere.folder_id, None, "unresolved folder dropped");
    assert!(nowhere.tag_ids.is_empty(), "unresolved tag dropped");

    assert_eq!(
        result.warnings.len(),
        3,
        "one warning per dropped link: {:?}",
        result.warnings
    );
    let dropped: Vec<(usize, &str)> = result
        .warnings
        .iter()
        .map(|w| (w.index, w.name.as_str()))
        .collect();
    assert_eq!(
        dropped,
        vec![(0, "Partly linked"), (1, "Nowhere"), (1, "Nowhere")],
        "warnings name the record they belong to"
    );
    assert!(result
        .warnings
        .iter()
        .any(|w| w.index == 0 && w.message.contains("ghost-tag")));
    assert!(result
        .warnings
        .iter()
        .any(|w| w.index == 1 && w.message.contains("ghost-folder")));
    assert!(result
        .warnings
        .iter()
        .any(|w| w.index == 1 && w.message.contains("ghost-tag-2")));
}

#[test]
fn secrets_never_reach_the_export_or_the_local_store() {
    const DB_SECRET: &str = "db-secret-value-1c9f";
    const SSH_SECRET: &str = "ssh-secret-value-4a71";
    const PASSPHRASE_SECRET: &str = "passphrase-secret-value-8b20";

    let (dir, db_path) = temp_store("secrets");
    let target = Mutex::new(Store::open(db_path.to_str().unwrap()).unwrap());
    let file = format!(
        r#"[{{"name": "With secrets", "db_type": "postgresql", "host": "h", "port": 5432,
             "username": "admin", "password": "{DB_SECRET}",
             "ssh_host": "jump.example.com", "ssh_user": "tunnel",
             "ssh_password": "{SSH_SECRET}", "ssh_passphrase": "{PASSPHRASE_SECRET}",
             "tag_ids": []}}]"#
    );

    let result = import_connections_inner(&target, file).unwrap();
    assert_eq!(result.imported, 1);

    let exported = export_connections_inner(&target).unwrap();
    for (label, secret) in [
        ("database password", DB_SECRET),
        ("ssh password", SSH_SECRET),
        ("ssh passphrase", PASSPHRASE_SECRET),
    ] {
        assert!(
            !exported.contains(secret),
            "the {label} must never be written to the export"
        );
    }
    for key in ["\"password\"", "\"ssh_password\"", "\"ssh_passphrase\""] {
        assert!(
            !exported.contains(key),
            "the export must not carry a {key} field"
        );
    }

    let store_bytes = std::fs::read(&db_path).unwrap();
    let store_text = String::from_utf8_lossy(&store_bytes);
    for (label, secret) in [
        ("database password", DB_SECRET),
        ("ssh password", SSH_SECRET),
        ("ssh passphrase", PASSPHRASE_SECRET),
    ] {
        assert!(
            !store_text.contains(secret),
            "the {label} must never be written to the local store"
        );
    }

    drop(target);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn one_bad_record_does_not_block_the_rest_of_the_file() {
    let target = store();
    let file = r#"{"version": 1, "connections": [
        {"name": "Good", "db_type": "postgresql", "host": "h", "port": 5432},
        {"db_type": "postgresql", "host": "h", "port": 5432},
        {"name": "Wrong type", "db_type": "mongodb", "host": "h", "port": 27017},
        {"name": "No host", "db_type": "redis", "host": "", "port": 6379}
    ]}"#;

    let result = import_connections_inner(&target, file.to_string()).unwrap();

    assert_eq!(result.imported, 1);
    assert_eq!(result.skipped, 3);
    let reasons: Vec<&str> = result
        .skipped_records
        .iter()
        .map(|r| r.reason.as_str())
        .collect();
    assert_eq!(result.skipped_records[0].index, 1);
    assert!(reasons[0].contains("name"), "got {}", reasons[0]);
    assert!(reasons[1].contains("db_type"), "got {}", reasons[1]);
    assert!(reasons[2].contains("host"), "got {}", reasons[2]);
}

#[test]
fn an_unreadable_file_reports_a_parse_error() {
    let target = store();
    assert!(import_connections_inner(&target, "{ not json".into()).is_err());
    assert!(import_connections_inner(&target, r#"{"version": 1}"#.into()).is_err());
}
