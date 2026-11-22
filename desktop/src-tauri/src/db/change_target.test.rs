use super::*;

fn connection(overrides: impl FnOnce(&mut Connection)) -> Connection {
    let mut conn = Connection {
        id: "c1".to_string(),
        name: "Local dev".to_string(),
        db_type: "postgresql".to_string(),
        host: "localhost".to_string(),
        port: Some(5432),
        username: Some("dev".to_string()),
        database: Some("appdb".to_string()),
        folder_id: None,
        keychain_ref: None,
        environment: None,
        favorite: false,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        tag_ids: Vec::new(),
        use_keychain: true,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    };
    overrides(&mut conn);
    conn
}

fn origin_for(conn: &Connection) -> ChangeOrigin {
    ChangeOrigin {
        connection_id: conn.id.clone(),
        database: "appdb".to_string(),
        target: connection_target_fingerprint(conn),
        target_label: describe_connection_target(conn),
    }
}

/// The fingerprint is a plain canonical string, so the renderer can produce the
/// same value. Pinning the exact text here is what keeps
/// `desktop/src/lib/changeOrigin.ts` and this module in step.
#[test]
fn fingerprint_is_the_canonical_field_list_the_renderer_produces() {
    assert_eq!(
        connection_target_fingerprint(&connection(|_| {})),
        "db_type=postgresql|host=localhost|port=5432|username=dev|database=appdb|\
         ssh_host=|ssh_port=|ssh_user=|ssh_auth_method=|ssh_private_key_path=|\
         ssl_mode=|ssl_ca_path=|ssl_cert_path=|ssl_key_path="
            .replace(char::is_whitespace, "")
    );
}

#[test]
fn fingerprint_ignores_metadata_but_tracks_the_target() {
    let base = connection_target_fingerprint(&connection(|_| {}));
    let cosmetic = connection_target_fingerprint(&connection(|c| {
        c.name = "Renamed environment".into();
        c.folder_id = Some("f1".into());
        c.tag_ids = vec!["t1".into()];
        c.environment = Some("production".into());
        c.favorite = true;
        c.keychain_ref = Some("gridline:c1".into());
        c.updated_at = "2026-02-02T00:00:00Z".into();
    }));
    assert_eq!(base, cosmetic, "metadata must not invalidate staged work");

    for change in [
        |c: &mut Connection| c.host = "db.example.com".into(),
        |c: &mut Connection| c.port = Some(6543),
        |c: &mut Connection| c.username = Some("other".into()),
        |c: &mut Connection| c.database = Some("otherdb".into()),
        |c: &mut Connection| c.ssh_host = Some("bastion.example.com".into()),
        |c: &mut Connection| c.ssl_mode = Some("verify-full".into()),
        |c: &mut Connection| c.ssl_ca_path = Some("/tmp/ca.pem".into()),
    ] {
        let moved = connection_target_fingerprint(&connection(change));
        assert_ne!(base, moved, "a changed target must change the fingerprint");
    }
}

#[test]
fn a_matching_origin_is_accepted() {
    let conn = connection(|_| {});
    let origin = origin_for(&conn);
    assert_eq!(validate_change_origin(&conn, "c1", &origin), Ok(()));
}

#[test]
fn a_retargeted_connection_refuses_the_staged_work() {
    let staged = connection(|_| {});
    let origin = origin_for(&staged);
    let retargeted = connection(|c| c.host = "prod.example.com".into());

    let err = validate_change_origin(&retargeted, "c1", &origin)
        .expect_err("a retargeted connection must refuse the work");
    assert!(
        err.starts_with(CHANGE_ORIGIN_RETARGETED),
        "the refusal carries a stable code: {err}"
    );
    assert!(
        err.contains("Nothing was written"),
        "the refusal says nothing happened: {err}"
    );
    assert!(
        err.contains("prod.example.com") && err.contains("localhost"),
        "the refusal names both targets: {err}"
    );
}

#[test]
fn an_origin_for_another_connection_is_refused() {
    let conn = connection(|_| {});
    let mut origin = origin_for(&conn);
    origin.connection_id = "c2".to_string();
    let err = validate_change_origin(&conn, "c1", &origin).expect_err("wrong connection");
    assert!(err.starts_with(CHANGE_ORIGIN_RETARGETED), "{err}");
}

/// A change staged before origins existed (or one whose target the renderer
/// omitted) cannot be proven to belong to this connection, so it fails closed.
#[test]
fn an_origin_without_a_target_is_refused() {
    let conn = connection(|_| {});
    let mut origin = origin_for(&conn);
    origin.target = String::new();
    assert!(validate_change_origin(&conn, "c1", &origin).is_err());
}
