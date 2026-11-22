use super::*;
use crate::models::{Connection, ConnectionInput, FolderInput, TagInput};
use crate::store::Store;

fn store() -> Mutex<Store> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    Mutex::new(Store::from_connection(conn).expect("test store"))
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
    assert_eq!(
        actual.ssl_cert_path, expected.ssl_cert_path,
        "ssl_cert_path"
    );
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

/// Drop the fields every transfer regenerates, so two exports of the same
/// settings can be compared as payloads.
fn without_regenerated_fields(export: &str) -> serde_json::Value {
    let mut payload: serde_json::Value = serde_json::from_str(export).unwrap();
    for conn in payload["connections"]
        .as_array_mut()
        .expect("the export carries a connections array")
    {
        let object = conn.as_object_mut().unwrap();
        for regenerated in ["id", "created_at", "updated_at"] {
            object.remove(regenerated);
        }
    }
    payload
}

#[test]
fn an_export_from_the_app_imports_into_a_clean_store() {
    let source = store();
    let created = source
        .lock()
        .unwrap()
        .create_connection(full_input("Prod"))
        .unwrap();
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
fn a_transfer_round_trips_in_both_directions() {
    let source = store();
    let created = source
        .lock()
        .unwrap()
        .create_connection(full_input("Prod"))
        .unwrap();
    source
        .lock()
        .unwrap()
        .set_connection_favorite(&created.id, true)
        .unwrap();

    // Direction 1: this machine's export lands on a clean store.
    let first_export = export_connections_inner(&source).unwrap();
    let middle = store();
    let forward = import_connections_inner(&middle, first_export.clone()).unwrap();
    assert_eq!(forward.imported, 1);

    // Direction 2: the store that received the transfer exports again, and
    // that second export lands somewhere else with the same settings.
    let second_export = export_connections_inner(&middle).unwrap();
    let target = store();
    let backward = import_connections_inner(&target, second_export.clone()).unwrap();
    assert_eq!(backward.imported, 1);

    let expected = only_connection(&source);
    assert_settings_equal(&expected, &only_connection(&middle));
    assert_settings_equal(&expected, &only_connection(&target));

    let first: serde_json::Value = serde_json::from_str(&first_export).unwrap();
    let second: serde_json::Value = serde_json::from_str(&second_export).unwrap();
    assert_eq!(first["version"], 1);
    assert_eq!(second["version"], 1);
    assert_eq!(
        without_regenerated_fields(&first_export),
        without_regenerated_fields(&second_export),
        "re-exporting a transferred connection must not lose or invent a setting"
    );
}

#[test]
fn an_app_export_reimported_on_the_same_machine_keeps_its_links() {
    let local = store();
    let folder = local
        .lock()
        .unwrap()
        .create_folder(FolderInput {
            name: "Work".into(),
            parent_id: None,
            tag_ids: None,
        })
        .unwrap();
    let tag = local
        .lock()
        .unwrap()
        .create_tag(TagInput {
            name: "env:prod".into(),
            color: "#ef4444".into(),
        })
        .unwrap();
    let mut input = full_input("Prod");
    input.folder_id = Some(folder.id.clone());
    input.tag_ids = vec![tag.id.clone()];
    let created = local.lock().unwrap().create_connection(input).unwrap();
    local
        .lock()
        .unwrap()
        .set_connection_favorite(&created.id, true)
        .unwrap();

    let exported = export_connections_inner(&local).unwrap();
    // The keys the export writes are the keys the importer reads, so an
    // organization link cannot drop out between the two halves.
    let payload: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        payload["connections"][0]["folder_id"].as_str(),
        Some(folder.id.as_str())
    );
    assert_eq!(
        payload["connections"][0]["tag_ids"][0].as_str(),
        Some(tag.id.as_str())
    );

    // Re-importing here is the case where the ids do resolve: this machine
    // already knows that folder and tag.
    let result = import_connections_inner(&local, exported).unwrap();

    assert_eq!(result.imported, 1);
    assert!(
        result.warnings.is_empty(),
        "resolvable links must not warn: {:?}",
        result.warnings
    );
    let connections = local.lock().unwrap().get_connections().unwrap();
    let reimported = connections
        .iter()
        .find(|c| c.id != created.id)
        .expect("the export was imported as a second connection");
    assert_eq!(reimported.folder_id, Some(folder.id));
    assert_eq!(reimported.tag_ids, vec![tag.id]);
    assert!(reimported.favorite, "favorite survives the transfer");
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
    assert_eq!(
        actual.ssl_key_path.as_deref(),
        Some("/certs/client-key.pem")
    );
    // A legacy file predates the opt-out flag; absent means the default.
    assert!(actual.use_keychain);
    assert_eq!(actual.folder_id, None);
    assert!(actual.tag_ids.is_empty());
}

#[test]
fn a_legacy_bare_array_file_upgrades_into_a_reimportable_envelope() {
    let legacy = r#"[{
        "name": "Legacy",
        "db_type": "postgresql",
        "host": "db.example.com",
        "port": 5432,
        "username": "admin",
        "database": "app",
        "environment": "production",
        "favorite": true,
        "ssh_host": "jump.example.com",
        "ssh_port": 22,
        "ssh_user": "tunnel",
        "ssh_auth_method": "Password",
        "ssl_mode": "verify-ca",
        "ssl_ca_path": "/certs/ca.pem"
    }]"#;

    let upgraded = store();
    assert_eq!(
        import_connections_inner(&upgraded, legacy.to_string())
            .unwrap()
            .imported,
        1
    );

    // Exporting the upgraded record writes today's envelope, which must import
    // again with nothing lost: the legacy path and the current path meet.
    let exported = export_connections_inner(&upgraded).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        payload["version"], 1,
        "a re-export uses the current envelope"
    );

    let target = store();
    let result = import_connections_inner(&target, exported).unwrap();
    assert_eq!(result.imported, 1);
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);

    let original = only_connection(&upgraded);
    let actual = only_connection(&target);
    assert_settings_equal(&original, &actual);
    assert_eq!(actual.environment.as_deref(), Some("production"));
    assert_eq!(actual.ssh_auth_method.as_deref(), Some("Password"));
    assert_eq!(actual.ssl_mode.as_deref(), Some("verify-ca"));
    assert!(actual.favorite, "a legacy favorite survives the upgrade");
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

    let result = import_connections_inner(&target, file.clone()).unwrap();
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

    // A transfer file that arrives with credentials must not become a
    // credential store: the secret is absent from every byte the app writes.
    assert!(
        file.contains(DB_SECRET) && file.contains(SSH_SECRET) && file.contains(PASSPHRASE_SECRET),
        "sanity: the fixture itself carries the credentials"
    );
    let mut store_files = 0usize;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let store_text = String::from_utf8_lossy(&std::fs::read(&path).unwrap()).to_string();
        store_files += 1;
        for (label, secret) in [
            ("database password", DB_SECRET),
            ("ssh password", SSH_SECRET),
            ("ssh passphrase", PASSPHRASE_SECRET),
        ] {
            assert!(
                !store_text.contains(secret),
                "the {label} must never be written to {}",
                path.display()
            );
        }
    }
    assert!(store_files >= 1, "the store file was inspected");

    // Structural: the connections table has no column that could hold a
    // credential at all.
    let raw = rusqlite::Connection::open(&db_path).unwrap();
    let mut stmt = raw.prepare("PRAGMA table_info(connections)").unwrap();
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert!(!columns.is_empty(), "the connections table exists");
    for column in &columns {
        let lower = column.to_lowercase();
        assert!(
            !lower.contains("password")
                && !lower.contains("passphrase")
                && !lower.contains("secret"),
            "the connections table must not persist credentials, found column {column}"
        );
    }

    drop(stmt);
    drop(raw);
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

    let not_json = import_connections_inner(&target, "{ not json".into()).unwrap_err();
    assert!(
        not_json.starts_with("invalid connection file:"),
        "got {not_json}"
    );

    // A file with the wrong shape is reported as that shape, not as a
    // generic unmatched-variant failure.
    let no_records = import_connections_inner(&target, r#"{"version": 1}"#.into()).unwrap_err();
    assert!(no_records.contains("connections"), "got {no_records}");

    let scalar = import_connections_inner(&target, "5".into()).unwrap_err();
    assert!(
        scalar.contains("expected a versioned export or a list of connections"),
        "got {scalar}"
    );
    assert_eq!(
        target.lock().unwrap().get_connections().unwrap().len(),
        0,
        "a rejected file imports nothing"
    );
}

#[test]
fn a_legacy_file_with_null_optional_fields_still_imports() {
    // The pre-envelope importer typed every optional field as `Option`, so a
    // file that spelled an absent value as `null` imported before and must
    // keep importing now.
    let legacy = r#"[{"name": "Sparse", "db_type": "postgresql", "host": "h",
                     "port": null, "username": null, "database": null,
                     "environment": null, "folder_id": null, "tag_ids": null,
                     "favorite": null, "ssh_host": null, "ssh_port": null,
                     "ssh_user": null, "ssh_auth_method": null,
                     "ssh_private_key_path": null, "ssl_mode": null,
                     "ssl_ca_path": null, "ssl_cert_path": null,
                     "ssl_key_path": null, "use_keychain": null}]"#;
    let target = store();

    let result = import_connections_inner(&target, legacy.to_string()).unwrap();

    assert_eq!(
        result.imported, 1,
        "skipped records: {:?}",
        result.skipped_records
    );
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    let actual = only_connection(&target);
    assert_eq!(actual.name, "Sparse");
    assert_eq!(actual.port, None);
    assert!(actual.tag_ids.is_empty());
    assert!(!actual.favorite);
    assert!(
        actual.use_keychain,
        "an absent opt-out flag means the default"
    );
}

/// A transfer file with an unrecognized TLS mode is refused record by record,
/// naming the valid set: an import must never quietly downgrade the mode the
/// file asked for (nor land a mode no connect path can resolve).
#[test]
fn an_import_with_an_unknown_ssl_mode_is_skipped_with_the_valid_set_named() {
    let file = r#"{"version": 1, "connections": [
        {"name": "Bogus TLS", "db_type": "postgresql", "host": "h", "port": 5432,
         "ssl_mode": "prefer", "use_keychain": false},
        {"name": "Good TLS", "db_type": "postgresql", "host": "h", "port": 5432,
         "ssl_mode": "verify-full", "use_keychain": false}
    ]}"#;
    let target = store();

    let result = import_connections_inner(&target, file.to_string()).unwrap();

    assert_eq!(result.imported, 1, "the valid record still imports");
    assert_eq!(result.skipped, 1);
    let reason = &result.skipped_records[0].reason;
    assert!(reason.contains("prefer"), "got: {reason}");
    for valid in crate::db::tls::VALID_SSL_MODES {
        assert!(reason.contains(valid), "reason {reason} must name {valid}");
    }
    let actual = only_connection(&target);
    assert_eq!(actual.name, "Good TLS");
    assert_eq!(actual.ssl_mode.as_deref(), Some("verify-full"));
}
