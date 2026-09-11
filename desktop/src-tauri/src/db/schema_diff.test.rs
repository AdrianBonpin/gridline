use super::*;

// ── Pure helpers (PG constraint row mapping) ────────────────────────

#[test]
fn pg_fk_action_maps_codes() {
    assert_eq!(pg_fk_action("a"), "NO ACTION");
    assert_eq!(pg_fk_action("r"), "RESTRICT");
    assert_eq!(pg_fk_action("c"), "CASCADE");
    assert_eq!(pg_fk_action("n"), "SET NULL");
    assert_eq!(pg_fk_action("d"), "SET DEFAULT");
    assert_eq!(pg_fk_action("x"), "NO ACTION");
}

#[test]
fn snapshot_cap_sets_truncated() {
    // 5,001 objects → truncated report, never silent (spec §2)
    let mut snap = SchemaSnapshot::default();
    snap.engine = "postgresql".into();
    snap.schema = "s".into();
    for i in 0..5_001 {
        snap.tables.push(SnapshotTable {
            schema: "s".into(),
            name: format!("t{i}"),
            columns: vec![],
            primary_key: vec![],
            uniques: vec![],
            checks: vec![],
            indexes: vec![],
            foreign_keys: vec![],
        });
    }
    apply_snapshot_cap(&mut snap);
    assert!(snap.truncated);
    assert!(snap.object_count <= 5_000);
    assert_eq!(snap.tables.len(), snap.object_count);
}

#[test]
fn query_builders_target_the_right_catalogs() {
    let cols = crate::db::introspection::pg_diff_columns_query();
    assert!(cols.contains("pg_attribute") && cols.contains("format_type"));
    let cons = crate::db::introspection::pg_diff_constraints_query();
    assert!(cons.contains("pg_constraint") && cons.contains("contype"));
    let idx = crate::db::introspection::pg_diff_indexes_query();
    assert!(idx.contains("pg_index") && idx.contains("indisunique"));
    let views = crate::db::introspection::pg_diff_views_query();
    assert!(views.contains("pg_views") && views.contains("pg_matviews"));
    let seqs = crate::db::introspection::pg_diff_sequences_query();
    assert!(seqs.contains("information_schema.sequences"));
    let enums = crate::db::introspection::pg_diff_enums_query();
    assert!(enums.contains("pg_type") && enums.contains("pg_enum"));
}

// ── SQLite capture (in-memory, real, NOT ignored) ──────────────────

#[test]
fn sqlite_capture_reads_pragmas() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x', email TEXT);
         CREATE UNIQUE INDEX idx_users_email ON users(email);
         CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
         CREATE VIEW v_users AS SELECT id, name FROM users;",
    )
    .unwrap();
    let snap = capture_sqlite(&conn).expect("capture");
    assert_eq!(snap.engine, "sqlite");
    assert_eq!(snap.tables.len(), 2);
    let users = snap.tables.iter().find(|t| t.name == "users").unwrap();
    assert_eq!(users.primary_key, vec!["id"]);
    assert_eq!(users.columns.len(), 3);
    assert!(users.columns.iter().any(|c| c.name == "name" && !c.nullable));
    assert!(users.columns.iter().any(|c| c.name == "email" && c.nullable));
    assert!(users.indexes.iter().any(|i| i.name == "idx_users_email" && i.unique));
    let orders = snap.tables.iter().find(|t| t.name == "orders").unwrap();
    assert_eq!(orders.foreign_keys.len(), 1);
    let fk = &orders.foreign_keys[0];
    assert!(fk.ref_table.contains("users"));
    assert_eq!(fk.on_delete, "CASCADE");
    assert_eq!(snap.views.len(), 1);
    assert!(snap.views[0].definition.contains("SELECT"));
}

/// Live PG capture — mirror the env/client conventions of the live PG tests in
/// `commands/objects.test.rs`. Create two diverged tables in a temp schema,
/// assert capture shape (columns with defaults, PK, FK with actions, indexes,
/// views, a sequence, an enum).
#[tokio::test]
#[ignore]
async fn pg_capture_live() {
    let h = std::env::var("GRIDLINE_TEST_PG_HOST").expect("set GRIDLINE_TEST_PG_HOST");
    let p: u16 = std::env::var("GRIDLINE_TEST_PG_PORT").unwrap_or_else(|_| "5432".into()).parse().unwrap();
    let u = std::env::var("GRIDLINE_TEST_PG_USER").expect("set GRIDLINE_TEST_PG_USER");
    let d = std::env::var("GRIDLINE_TEST_PG_DB").expect("set GRIDLINE_TEST_PG_DB");
    let pw = std::env::var("GRIDLINE_TEST_PG_PASSWORD").unwrap_or_default();
    let (client, conn) = tokio_postgres::connect(
        &format!("host={h} port={p} user={u} dbname={d} password={pw}"),
        tokio_postgres::NoTls,
    )
    .await
    .expect("connect to test PG");
    let handle = tokio::spawn(async move { let _ = conn.await; });

    let schema = "gridline_diff_test";
    client
        .batch_execute(&format!(
            "DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema};"
        ))
        .await
        .expect("create temp schema");

    // Two diverged tables: one with PK/FK/index/default, one plain.
    client
        .batch_execute(&format!(
            "CREATE TABLE {schema}.parent (id serial PRIMARY KEY, code text UNIQUE);
             CREATE TABLE {schema}.child (
                id serial PRIMARY KEY,
                parent_id integer REFERENCES {schema}.parent(id) ON DELETE CASCADE ON UPDATE RESTRICT,
                name text NOT NULL DEFAULT 'x',
                email text
             );
             CREATE INDEX idx_child_email ON {schema}.child(email);
             CREATE VIEW {schema}.v_child AS SELECT id, name FROM {schema}.child;
             CREATE SEQUENCE {schema}.seq_test START 5 INCREMENT 2;
             CREATE TYPE {schema}.mood AS ENUM ('happy', 'sad');"
        ))
        .await
        .expect("create objects");

    let snap = capture_pg(&client, "postgresql", schema).await.expect("capture");
    assert_eq!(snap.engine, "postgresql");
    assert_eq!(snap.schema, schema);
    assert_eq!(snap.tables.len(), 2);

    let child = snap.tables.iter().find(|t| t.name == "child").expect("child table");
    assert_eq!(child.primary_key, vec!["id"]);
    assert!(child.columns.iter().any(|c| c.name == "name" && !c.nullable && c.default_value.is_some()));
    assert!(child.columns.iter().any(|c| c.name == "email" && c.nullable));
    assert!(child.indexes.iter().any(|i| i.name == "idx_child_email"));
    assert_eq!(child.foreign_keys.len(), 1);
    let fk = &child.foreign_keys[0];
    assert!(fk.ref_table.contains("parent"));
    assert_eq!(fk.on_delete, "CASCADE");
    assert_eq!(fk.on_update, "RESTRICT");

    let parent = snap.tables.iter().find(|t| t.name == "parent").expect("parent table");
    assert!(parent.uniques.iter().any(|u| u.kind == "unique"));

    assert!(snap.views.iter().any(|v| v.name == "v_child"));
    assert!(snap.sequences.iter().any(|s| s.name == "seq_test" && s.start == "5"));
    assert!(snap.enums.iter().any(|e| e.name == "mood" && e.labels == vec!["happy", "sad"]));

    client
        .batch_execute(&format!("DROP SCHEMA {schema} CASCADE;"))
        .await
        .expect("drop temp schema");
    let _ = handle;
}

// ── Task 14: pure diff engine + sync-SQL generation ─────────────────

fn col(name: &str, ty: &str, nullable: bool, default: Option<&str>) -> SnapshotColumn {
    SnapshotColumn {
        name: name.into(),
        data_type: ty.into(),
        nullable,
        default_value: default.map(|d| d.into()),
    }
}

fn table(name: &str, columns: Vec<SnapshotColumn>) -> SnapshotTable {
    SnapshotTable {
        schema: "s".into(),
        name: name.into(),
        columns,
        primary_key: vec![],
        uniques: vec![],
        checks: vec![],
        indexes: vec![],
        foreign_keys: vec![],
    }
}

fn pg_snap(tables: Vec<SnapshotTable>) -> SchemaSnapshot {
    let object_count = tables.len();
    SchemaSnapshot {
        engine: "postgresql".into(),
        schema: "s".into(),
        tables,
        views: vec![],
        sequences: vec![],
        enums: vec![],
        object_count,
        truncated: false,
    }
}

#[test]
fn added_table_generates_create_with_pk_and_is_stageable() {
    let mut src = pg_snap(vec![]);
    let mut t = table("users", vec![col("id", "integer", false, None), col("email", "text", true, Some("''"))]);
    t.primary_key = vec!["id".into()];
    src.tables.push(t);
    let tgt = pg_snap(vec![]);
    let r = diff_snapshots(&src, &tgt);
    let item = r.items.iter().find(|i| i.object_type == "table" && i.name == "users").unwrap();
    assert_eq!(item.kind, "added");
    assert!(!item.destructive);
    assert_eq!(item.sync_sql.len(), 1);
    let sql = &item.sync_sql[0];
    assert!(sql.starts_with("CREATE TABLE \"s\".\"users\""), "got: {sql}");
    assert!(sql.contains("\"id\" integer NOT NULL"));
    assert!(sql.contains("\"email\" text DEFAULT ''"));
    assert!(sql.contains("PRIMARY KEY (\"id\")"));
}

#[test]
fn removed_table_is_destructive_copy_only() {
    let tgt = pg_snap(vec![table("old", vec![col("id", "integer", false, None)])]);
    let src = pg_snap(vec![]);
    let r = diff_snapshots(&src, &tgt);
    let item = r.items.iter().find(|i| i.name == "old").unwrap();
    assert_eq!(item.kind, "removed");
    assert!(item.destructive);
    assert_eq!(item.sync_sql, vec!["DROP TABLE \"s\".\"old\";"]);
}

#[test]
fn column_diffs_classify_exactly_per_spec() {
    let mut src = pg_snap(vec![table(
        "t",
        vec![
            col("kept", "int", true, None),
            col("added", "int", true, None),
            col("retyped", "bigint", true, None),
            col("tightened", "int", false, None),
            col("defchanged", "int", true, Some("2")),
        ],
    )]);
    src.tables[0].name = "t".into();
    let tgt = pg_snap(vec![table(
        "t",
        vec![
            col("kept", "int", true, None),
            col("gone", "int", true, None),
            col("retyped", "int", true, None),
            col("tightened", "int", true, None),
            col("defchanged", "int", true, Some("1")),
        ],
    )]);

    let r = diff_snapshots(&src, &tgt);

    let add = r.items.iter().find(|i| i.name == "t.added").unwrap();
    assert_eq!((add.kind.as_str(), add.destructive), ("added", false));
    assert_eq!(add.sync_sql[0], "ALTER TABLE \"s\".\"t\" ADD COLUMN \"added\" int;");

    let gone = r.items.iter().find(|i| i.name == "t.gone").unwrap();
    assert_eq!((gone.kind.as_str(), gone.destructive), ("removed", true));
    assert_eq!(gone.sync_sql[0], "ALTER TABLE \"s\".\"t\" DROP COLUMN \"gone\";");

    let retyped = r.items.iter().find(|i| i.name == "t.retyped").unwrap();
    assert!(retyped.destructive, "ALTER COLUMN TYPE is destructive per spec");
    assert!(retyped.sync_sql[0].contains("ALTER COLUMN \"retyped\" TYPE bigint"));

    let tight = r.items.iter().find(|i| i.name == "t.tightened").unwrap();
    assert!(!tight.destructive);
    assert!(tight.sync_sql[0].contains("SET NOT NULL"));

    let def = r.items.iter().find(|i| i.name == "t.defchanged").unwrap();
    assert!(!def.destructive);
    assert!(def.sync_sql[0].contains("SET DEFAULT 2"));
}

#[test]
fn constraint_index_fk_view_sequence_enum_diffs() {
    let mut src = pg_snap(vec![table("t", vec![col("id", "int", false, None)])]);
    let mut tgt = pg_snap(vec![table("t", vec![col("id", "int", false, None)])]);

    src.tables[0].foreign_keys.push(SnapshotFk {
        name: "fk_t_ref".into(),
        columns: vec!["id".into()],
        ref_schema: "s".into(),
        ref_table: "other".into(),
        ref_columns: vec!["id".into()],
        on_delete: "CASCADE".into(),
        on_update: "NO ACTION".into(),
    });
    src.tables[0].indexes.push(SnapshotIndex { name: "ix_t".into(), columns: vec!["id".into()], unique: false });
    src.views.push(SnapshotView { schema: "s".into(), name: "v".into(), definition: "SELECT 1".into(), materialized: false });
    src.sequences.push(SnapshotSequence { schema: "s".into(), name: "seq".into(), start: "1".into(), increment: "1".into(), minimum: "1".into(), maximum: "100".into(), cycle: false });
    src.enums.push(SnapshotEnum { schema: "s".into(), name: "color".into(), labels: vec!["red".into(), "green".into()] });
    tgt.enums.push(SnapshotEnum { schema: "s".into(), name: "color".into(), labels: vec!["red".into()] });

    let r = diff_snapshots(&src, &tgt);

    let fk = r.items.iter().find(|i| i.object_type == "constraint" && i.name == "t.fk_t_ref").unwrap();
    assert!(!fk.destructive);
    assert!(fk.sync_sql[0].contains("ADD CONSTRAINT \"fk_t_ref\" FOREIGN KEY (\"id\")"));
    assert!(fk.sync_sql[0].contains("REFERENCES \"s\".\"other\" (\"id\")"));
    assert!(fk.sync_sql[0].contains("ON DELETE CASCADE"));

    let ix = r.items.iter().find(|i| i.object_type == "index" && i.name == "t.ix_t").unwrap();
    assert_eq!(ix.sync_sql[0], "CREATE INDEX \"s\".\"ix_t\" ON \"s\".\"t\" (\"id\");");

    let view = r.items.iter().find(|i| i.object_type == "view" && i.name == "v").unwrap();
    assert!(view.sync_sql[0].starts_with("CREATE VIEW \"s\".\"v\" AS"));

    let seq = r.items.iter().find(|i| i.object_type == "sequence" && i.name == "seq").unwrap();
    assert!(seq.sync_sql[0].starts_with("CREATE SEQUENCE \"s\".\"seq\""));

    let en = r.items.iter().find(|i| i.object_type == "enum" && i.name == "color").unwrap();
    assert!(!en.destructive);
    assert!(en.sync_sql[0].contains("ALTER TYPE \"s\".\"color\" ADD VALUE 'green'"));
}

#[test]
fn mysql_family_uses_backticks() {
    let mut src = SchemaSnapshot { engine: "mariadb".into(), schema: "app".into(), ..Default::default() };
    src.tables.push(SnapshotTable {
        schema: "app".into(),
        name: "users".into(),
        columns: vec![SnapshotColumn { name: "id".into(), data_type: "int".into(), nullable: false, default_value: None }],
        primary_key: vec!["id".into()],
        uniques: vec![],
        checks: vec![],
        indexes: vec![],
        foreign_keys: vec![],
    });
    let tgt = SchemaSnapshot { engine: "mysql".into(), schema: "app".into(), ..Default::default() };
    let r = diff_snapshots(&src, &tgt);
    let item = r.items.iter().find(|i| i.name == "users").unwrap();
    assert!(item.sync_sql[0].starts_with("CREATE TABLE `app`.`users`"), "got: {}", item.sync_sql[0]);
}

#[test]
fn sqlite_changed_view_is_destructive_note_only() {
    let mut src = SchemaSnapshot { engine: "sqlite".into(), schema: "main".into(), ..Default::default() };
    src.views.push(SnapshotView { schema: "main".into(), name: "v".into(), definition: "SELECT 2".into(), materialized: false });
    let mut tgt = SchemaSnapshot { engine: "sqlite".into(), schema: "main".into(), ..Default::default() };
    tgt.views.push(SnapshotView { schema: "main".into(), name: "v".into(), definition: "SELECT 1".into(), materialized: false });
    let r = diff_snapshots(&src, &tgt);
    let item = r.items.iter().find(|i| i.object_type == "view").unwrap();
    assert_eq!(item.kind, "changed");
    assert!(item.destructive);
    assert!(item.sync_sql.is_empty(), "SQLite cannot CREATE OR REPLACE a view");
}

#[test]
fn identical_snapshots_diff_empty_and_stageable_filter() {
    let snap = pg_snap(vec![table("t", vec![col("id", "int", false, None)])]);
    let r = diff_snapshots(&snap, &snap);
    assert!(r.items.is_empty());
    assert!(stageable_items(&r).is_empty());

    let mut src2 = pg_snap(vec![]);
    src2.tables.push(table("new", vec![col("id", "int", false, None)]));
    src2.tables.push(table("dropme", vec![col("id", "int", false, None)]));
    let r2 = diff_snapshots(&src2, &snap);
    assert!(stageable_items(&r2).iter().all(|i| !i.destructive && !i.sync_sql.is_empty()));
}
