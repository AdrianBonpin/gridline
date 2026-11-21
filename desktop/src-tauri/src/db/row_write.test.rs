use super::*;
use serde_json::json;

fn pairs(v: serde_json::Value) -> Vec<(String, serde_json::Value)> {
    match v {
        serde_json::Value::Object(map) => map.into_iter().collect(),
        other => panic!("expected an object, got {other:?}"),
    }
}

fn names(pairs: &[(String, serde_json::Value)]) -> Vec<&str> {
    pairs.iter().map(|(c, _)| c.as_str()).collect()
}

// ── identity kind ────────────────────────────────────────────────────

#[test]
fn physical_locators_are_recognised_by_their_identity_column() {
    assert!(is_physical_locator(&pairs(json!({ "ctid": "(0,1)" }))));
    assert!(is_physical_locator(&pairs(json!({ "rowid": 3 }))));
    assert!(!is_physical_locator(&pairs(json!({ "id": 3 }))));
    // A composite key is never a locator.
    assert!(!is_physical_locator(&pairs(
        json!({ "order_id": 1, "product_id": 2 })
    )));
    assert!(!is_physical_locator(&[]));
}

// ── which original values guard the write ────────────────────────────

#[test]
fn update_is_guarded_by_the_edited_columns_original_value() {
    let identity = pairs(json!({ "id": 1 }));
    let original = pairs(json!({ "quantity": 2 }));
    let guards = guards_for(WriteKind::Update, &identity, &original).expect("guards");
    assert_eq!(names(&guards), vec!["quantity"]);
}

#[test]
fn primary_key_delete_is_guarded_by_identity_only() {
    // No full-row optimistic versioning: a concurrent change to another column
    // must not block a delete that still addresses exactly one row.
    let identity = pairs(json!({ "id": 1 }));
    let original = pairs(json!({ "id": 1, "name": "Alice", "age": 30 }));
    let guards = guards_for(WriteKind::Delete, &identity, &original).expect("guards");
    assert!(guards.is_empty(), "expected no guards, got {guards:?}");
}

#[test]
fn locator_delete_is_guarded_by_the_whole_displayed_row() {
    let identity = pairs(json!({ "rowid": 2 }));
    let original = pairs(json!({ "url": "/cart", "session_id": "s-2" }));
    let guards = guards_for(WriteKind::Delete, &identity, &original).expect("guards");
    // `serde_json::Map` is ordered by key, so the guard keeps that order.
    assert_eq!(names(&guards), vec!["session_id", "url"]);
}

#[test]
fn identity_columns_are_never_duplicated_in_the_guard() {
    let identity = pairs(json!({ "rowid": 2 }));
    let original = pairs(json!({ "rowid": 2, "url": "/cart" }));
    let guards = guards_for(WriteKind::Delete, &identity, &original).expect("guards");
    assert_eq!(names(&guards), vec!["url"]);
}

#[test]
fn locator_write_without_original_values_fails_closed() {
    for kind in [WriteKind::Update, WriteKind::Delete] {
        let identity = pairs(json!({ "ctid": "(0,1)" }));
        let err = guards_for(kind, &identity, &[]).expect_err("must be refused");
        assert!(
            err.contains("physical locator") && err.contains("original row values"),
            "error must explain the missing guard ({kind:?}): {err}"
        );
        assert!(err.contains("nothing was written"), "{err}");
    }
}

// ── statement shape ──────────────────────────────────────────────────

fn update_write<'a>(
    engine: Engine,
    identity: &'a [(String, serde_json::Value)],
    new_data: &'a [(String, serde_json::Value)],
    guard: &'a [(String, serde_json::Value)],
) -> Statement {
    RowWrite {
        engine,
        schema: "public",
        table: "items",
        kind: WriteKind::Update,
        identity,
        new_data,
        guard: guard.to_vec(),
    }
    .statement()
    .expect("statement")
}

#[test]
fn postgres_update_binds_set_identity_then_guard_in_placeholder_order() {
    let identity = pairs(json!({ "id": 1 }));
    let new_data = pairs(json!({ "name": "bob" }));
    let guard = pairs(json!({ "name": "alice" }));
    let stmt = update_write(Engine::PostgreSql, &identity, &new_data, &guard);
    assert_eq!(
        stmt.sql,
        "UPDATE \"public\".\"items\" SET \"name\" = $1 WHERE \"id\" = $2 AND \"name\" = $3"
    );
    assert_eq!(stmt.params, vec![json!("bob"), json!(1), json!("alice")]);
}

#[test]
fn sqlite_and_mysql_use_question_placeholders() {
    let identity = pairs(json!({ "id": 1 }));
    let new_data = pairs(json!({ "name": "bob" }));
    let guard = pairs(json!({ "name": "alice" }));
    for engine in [Engine::Sqlite, Engine::MySql] {
        let stmt = update_write(engine, &identity, &new_data, &guard);
        assert_eq!(
            stmt.params,
            vec![json!("bob"), json!(1), json!("alice")],
            "params must follow placeholder order for {engine:?}"
        );
    }
}

#[test]
fn no_engine_emits_a_row_limit_on_a_single_row_write() {
    // A `LIMIT 1` would cap an ambiguous match at one row and hide it.
    let identity = pairs(json!({ "order_id": 1 }));
    let new_data = pairs(json!({ "quantity": 9 }));
    for engine in [Engine::PostgreSql, Engine::Sqlite, Engine::MySql] {
        let stmt = update_write(engine, &identity, &new_data, &[]);
        assert!(
            !stmt.sql.to_uppercase().contains("LIMIT"),
            "{engine:?} must not limit a single-row write: {}",
            stmt.sql
        );
        let delete = RowWrite {
            engine,
            schema: "public",
            table: "items",
            kind: WriteKind::Delete,
            identity: &identity,
            new_data: &[],
            guard: Vec::new(),
        }
        .statement()
        .expect("delete statement");
        assert!(
            !delete.sql.to_uppercase().contains("LIMIT"),
            "{engine:?} must not limit a single-row delete: {}",
            delete.sql
        );
    }
}

#[test]
fn null_original_value_guards_with_is_null_and_binds_nothing() {
    let identity = pairs(json!({ "id": 1 }));
    let new_data = pairs(json!({ "note": "filled in" }));
    let guard = pairs(json!({ "note": null }));
    let stmt = update_write(Engine::PostgreSql, &identity, &new_data, &guard);
    assert!(
        stmt.sql.ends_with("AND \"note\" IS NULL"),
        "a NULL the user saw must guard with IS NULL: {}",
        stmt.sql
    );
    // `= NULL` never matches, and no parameter may be bound for it.
    assert_eq!(stmt.params, vec![json!("filled in"), json!(1)]);
}

#[test]
fn awkward_column_and_table_names_are_quoted_not_dropped() {
    let identity = pairs(json!({ "we ird": 1 }));
    let new_data = pairs(json!({ "a\"b": "x" }));
    let stmt = update_write(Engine::PostgreSql, &identity, &new_data, &[]);
    assert!(stmt.sql.contains("\"a\"\"b\""), "{}", stmt.sql);
    assert!(stmt.sql.contains("\"we ird\""), "{}", stmt.sql);

    let mysql = RowWrite {
        engine: Engine::MySql,
        schema: "shop",
        table: "or`ders",
        kind: WriteKind::Delete,
        identity: &pairs(json!({ "id`x": 1 })),
        new_data: &[],
        guard: Vec::new(),
    }
    .statement()
    .expect("delete statement");
    assert!(mysql.sql.contains("`shop`.`or``ders`"), "{}", mysql.sql);
    assert!(mysql.sql.contains("`id``x`"), "{}", mysql.sql);
}

#[test]
fn missing_identity_is_rejected_per_engine() {
    let empty: Vec<(String, serde_json::Value)> = Vec::new();
    let err = RowWrite {
        engine: Engine::MySql,
        schema: "shop",
        table: "t",
        kind: WriteKind::Update,
        identity: &empty,
        new_data: &pairs(json!({ "a": 1 })),
        guard: Vec::new(),
    }
    .statement()
    .expect_err("empty identity must be rejected");
    assert!(err.contains("MySQL has no ctid"), "{err}");

    let err = RowWrite {
        engine: Engine::Sqlite,
        schema: "main",
        table: "t",
        kind: WriteKind::Update,
        identity: &empty,
        new_data: &pairs(json!({ "a": 1 })),
        guard: Vec::new(),
    }
    .statement()
    .expect_err("empty identity must be rejected");
    assert!(err.contains("row locator"), "{err}");
}

#[test]
fn identity_probe_reads_one_row_by_identity_only() {
    let identity = pairs(json!({ "order_id": 1, "product_id": 2 }));
    let stmt = RowWrite {
        engine: Engine::PostgreSql,
        schema: "public",
        table: "order_items",
        kind: WriteKind::Delete,
        identity: &identity,
        new_data: &[],
        guard: Vec::new(),
    }
    .identity_probe()
    .expect("probe");
    assert_eq!(
        stmt.sql,
        "SELECT 1 FROM \"public\".\"order_items\" WHERE \"order_id\" = $1 AND \"product_id\" = $2 LIMIT 1"
    );
    assert_eq!(stmt.params, vec![json!(1), json!(2)]);
}

// ── outcome ──────────────────────────────────────────────────────────

#[test]
fn exactly_one_match_is_committable() {
    assert_eq!(failure_message(1, None, false, &[]), None);
    assert_eq!(failure_message(1, Some(1), true, &[]), None);
}

#[test]
fn zero_matches_with_no_guard_is_a_stale_row() {
    let msg = failure_message(0, None, false, &[]).expect("stale message");
    assert_eq!(msg, STALE_ROW);
    assert!(msg.contains("row was modified or removed by another session"));
}

#[test]
fn zero_matches_where_the_identity_is_gone_is_a_stale_row() {
    let msg = failure_message(0, Some(0), false, &["quantity".to_string()]).expect("stale message");
    assert_eq!(msg, STALE_ROW);
}

#[test]
fn more_than_one_match_is_ambiguous_and_names_the_count() {
    let msg = failure_message(3, None, false, &[]).expect("ambiguous message");
    assert!(msg.contains("ambiguous row match"), "{msg}");
    assert!(msg.contains('3'), "{msg}");
    assert!(msg.contains("nothing was written"), "{msg}");
}

#[test]
fn zero_matches_with_the_row_present_is_a_value_conflict() {
    let msg = failure_message(0, Some(1), false, &["quantity".to_string()]).expect("conflict");
    assert!(msg.contains("row conflict"), "{msg}");
    assert!(msg.contains("\"quantity\""), "{msg}");
    assert!(msg.contains("nothing was written"), "{msg}");
}

#[test]
fn locator_conflict_says_the_row_at_that_locator_changed() {
    let msg = failure_message(0, Some(1), true, &["url".to_string()]).expect("conflict");
    assert!(msg.contains("row conflict"), "{msg}");
    assert!(msg.contains("physical locator"), "{msg}");
    assert!(msg.contains("nothing was written"), "{msg}");
}

#[test]
fn multiple_guarded_columns_are_all_named() {
    let msg = failure_message(
        0,
        Some(1),
        false,
        &["a".to_string(), "b".to_string(), "c".to_string()],
    )
    .expect("conflict");
    for col in ["\"a\"", "\"b\"", "\"c\""] {
        assert!(msg.contains(col), "missing {col}: {msg}");
    }
}
