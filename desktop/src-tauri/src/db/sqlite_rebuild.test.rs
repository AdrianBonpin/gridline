use super::*;
use crate::db::object_ddl::{sqlite_rebuild_script, SqliteColumn};

fn conn_with(sql: &str) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(sql)
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
    conn
}

fn col(name: &str, ty: &str) -> SqliteColumn {
    SqliteColumn {
        name: name.into(),
        type_: ty.into(),
        nullable: true,
        default: None,
        is_pk: false,
        auto_increment: false,
        unique: false,
        renamed_from: None,
    }
}

fn shape_of(conn: &Connection) -> SqliteTableShape {
    read_table_shape(conn, "t").unwrap()
}

/// The columns the editor would submit unchanged for the live table.
fn live(conn: &Connection, table: &str) -> Vec<SqliteColumn> {
    read_table_shape(conn, table).unwrap().columns
}

/// Rename one live column, the way the editor expresses explicit rename intent.
fn renamed(columns: &[SqliteColumn], from: &str, to: &str) -> Vec<SqliteColumn> {
    columns
        .iter()
        .map(|c| {
            if c.name == from {
                SqliteColumn {
                    name: to.into(),
                    renamed_from: Some(from.into()),
                    ..c.clone()
                }
            } else {
                c.clone()
            }
        })
        .collect()
}

/// Build and apply a rebuild the way the command layer does: guard, then script,
/// then the one-transaction apply.
fn rebuild(conn: &Connection, table: &str, new: &[SqliteColumn]) -> Result<(), String> {
    let shape = read_table_shape(conn, table)?;
    if let Some(refusal) = shape.refusal_for(new) {
        return Err(refusal);
    }
    let script = sqlite_rebuild_script(table, &shape.columns, new, &shape.preserved)?;
    apply_rebuild(conn, table, &script.join(";\n"))
}

fn script_for(conn: &Connection, table: &str, new: &[SqliteColumn]) -> String {
    let shape = read_table_shape(conn, table).unwrap();
    sqlite_rebuild_script(table, &shape.columns, new, &shape.preserved)
        .unwrap()
        .join(";\n")
}

/// Every `sqlite_master` row for the schema, the basis of the round-trip check.
fn schema_rows(conn: &Connection) -> Vec<(String, String, String)> {
    let mut stmt = conn
        .prepare("SELECT type, name, coalesce(sql, '') FROM sqlite_master ORDER BY type, name")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// The `sqlite_master` rows of one table's own schema objects (indexes and
/// triggers), which a rebuild must reproduce byte for byte.
fn object_rows(conn: &Connection, table: &str) -> Vec<(String, String, String)> {
    schema_rows(conn)
        .into_iter()
        .filter(|(kind, _, _)| kind == "index" || kind == "trigger")
        .filter(|(_, _, sql)| {
            sql.contains(&format!("\"{table}\"")) || sql.contains(&format!("ON {table}("))
        })
        .collect()
}

fn stored_ddl(conn: &Connection, table: &str) -> String {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get::<_, String>(0),
    )
    .unwrap()
}

fn values(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map([], |r| r.get::<_, rusqlite::types::Value>(0))
        .unwrap()
        .map(|r| match r.unwrap() {
            rusqlite::types::Value::Null => "NULL".to_string(),
            rusqlite::types::Value::Integer(i) => i.to_string(),
            rusqlite::types::Value::Real(f) => f.to_string(),
            rusqlite::types::Value::Text(t) => t,
            rusqlite::types::Value::Blob(_) => "<blob>".to_string(),
        })
        .collect()
}

/// A table with every metadata feature the editor does not model.
const RICH_DDL: &str = r#"
CREATE TABLE t (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    label TEXT COLLATE NOCASE DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    total INTEGER GENERATED ALWAYS AS (quantity * 2) STORED,
    parent_id INTEGER REFERENCES t(id) ON DELETE CASCADE,
    CONSTRAINT t_qty_label UNIQUE (quantity, label),
    CONSTRAINT t_parent_fk FOREIGN KEY (parent_id) REFERENCES t(id) ON UPDATE SET NULL
);
CREATE INDEX idx_t_qty ON t(quantity);
CREATE INDEX idx_t_label_live ON t(label) WHERE label IS NOT NULL;
CREATE TRIGGER trg_t_qty AFTER UPDATE OF quantity ON t BEGIN
    INSERT INTO audit (note) VALUES ('quantity changed');
END;
CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);
INSERT INTO t (id, email, quantity, label, parent_id) VALUES (1, 'a@x', 2, 'one', NULL);
INSERT INTO t (id, email, quantity, label, parent_id) VALUES (2, 'b@x', 3, 'two', 1);
"#;

// --- the guard: what is still refused, and what is no longer ---

#[test]
fn a_plain_table_has_no_blockers() {
    let conn = conn_with("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT)");
    let shape = shape_of(&conn);
    assert_eq!(shape.blockers(), Vec::<String>::new());
    assert_eq!(shape.refusal(), None);
    assert_eq!(shape.blockers_for(&shape.columns), Vec::<String>::new());
}

#[test]
fn every_preserved_feature_is_no_longer_a_blocker() {
    let conn = conn_with(RICH_DDL);
    let shape = shape_of(&conn);
    assert_eq!(
        shape.blockers(),
        Vec::<String>::new(),
        "AUTOINCREMENT, UNIQUE, CHECK, COLLATE, an expression default, a generated \
         column, foreign keys, a composite unique key, indexes, and triggers are all \
         reproduced by the rebuild script"
    );
    assert_eq!(shape.refusal(), None);
    assert_eq!(
        shape.blockers_for(&shape.columns),
        Vec::<String>::new(),
        "a plain reorder of this table is allowed"
    );
    // The shape really did see them.
    assert_eq!(shape.preserved.index_sql.len(), 2);
    assert_eq!(shape.preserved.trigger_sql.len(), 1);
    assert!(shape.preserved.sequence.is_some());
    assert!(shape.generated_columns.contains("total"));
}

#[test]
fn a_virtual_table_is_still_refused() {
    let conn = conn_with("CREATE VIRTUAL TABLE t USING fts5(body)");
    let refusal = shape_of(&conn)
        .refusal()
        .expect("a virtual table is refused");
    assert!(refusal.contains("virtual table"), "{refusal}");
}

#[test]
fn an_unreadable_definition_is_still_refused() {
    let shape = SqliteTableShape {
        table: "t".into(),
        create_sql: "CREATE TABLE t (".into(),
        columns: vec![col("a", "TEXT")],
        preserved: PreservedTable::default(),
        parse_error: Some("unbalanced column list".into()),
        generated_columns: HashSet::new(),
    };
    let refusal = shape
        .refusal()
        .expect("an unreadable definition is refused");
    assert!(refusal.contains("cannot be read"), "{refusal}");
}

#[test]
fn an_edit_that_drops_a_column_a_preserved_object_uses_is_refused_before_mutation() {
    let conn = conn_with(RICH_DDL);
    let before = schema_rows(&conn);
    let mut new = live(&conn, "t");
    new.retain(|c| c.name != "quantity");

    let err = rebuild(&conn, "t", &new).expect_err("the index would vanish");
    for name in ["idx_t_qty", "trg_t_qty", "t_qty_label"] {
        assert!(err.contains(name), "the refusal names {name}: {err}");
    }
    assert!(err.contains("Cannot rebuild"), "{err}");
    assert_eq!(schema_rows(&conn), before, "nothing was mutated");
}

#[test]
fn an_edit_that_drops_a_column_a_generated_column_computes_from_is_refused() {
    let conn = conn_with(
        "CREATE TABLE t (
            a INTEGER NOT NULL,
            b INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL
         );
         INSERT INTO t (a) VALUES (3);",
    );
    let before = schema_rows(&conn);
    let new: Vec<SqliteColumn> = live(&conn, "t")
        .into_iter()
        .filter(|c| c.name != "a")
        .collect();
    let err = rebuild(&conn, "t", &new).expect_err("the expression would dangle");
    assert!(
        err.contains("generated column \"b\"") && err.contains("\"a\""),
        "the refusal names the generated column and the dropped one: {err}"
    );
    assert_eq!(schema_rows(&conn), before, "nothing was mutated");
}

#[test]
fn an_edit_that_alters_a_generated_column_is_refused() {
    let conn = conn_with(RICH_DDL);
    let mut new = live(&conn, "t");
    let generated = new.iter_mut().find(|c| c.name == "total").unwrap();
    generated.type_ = "REAL".into();
    let err = rebuild(&conn, "t", &new).expect_err("a generated expression is not editable");
    assert!(err.contains("generated column \"total\""), "{err}");
}

#[test]
fn an_expression_default_is_refused_only_when_it_cannot_be_emitted() {
    let conn = conn_with("CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT)");
    let mut new = live(&conn, "t");
    new[1].default = Some("datetime('now')".into());
    let err = rebuild(&conn, "t", &new).expect_err("unparenthesised is not emittable");
    assert!(err.contains("datetime('now')"), "{err}");

    // Written the way SQLite stores it — parenthesised — it is accepted.
    new[1].default = Some("(datetime('now'))".into());
    let script = script_for(&conn, "t", &new);
    assert!(script.contains("DEFAULT (datetime('now'))"), "{script}");
}

#[test]
fn an_expression_default_round_trips_and_literals_still_do() {
    for literal in [
        "'draft'",
        "0",
        "-1",
        "1.5",
        "0x1F",
        "NULL",
        "TRUE",
        "CURRENT_TIMESTAMP",
        "X'00ff'",
        "(datetime('now'))",
        "(1 + 2)",
        "(lower('A') || 'x')",
    ] {
        assert!(
            default_round_trips(literal),
            "{literal} is a literal or a parenthesised expression and must round-trip"
        );
    }
    for expression in ["datetime('now')", "1 + 2", "lower('A')", "", "(1 + 2"] {
        assert!(
            !default_round_trips(expression),
            "{expression} cannot be emitted as a DEFAULT clause"
        );
    }
}

// --- value mapping by Column Identity ---

#[test]
fn a_reorder_moves_each_value_to_its_own_column() {
    let conn = conn_with(
        "CREATE TABLE t (a TEXT, b TEXT, c TEXT);
         INSERT INTO t VALUES ('a1', 'b1', 'c1'), ('a2', 'b2', 'c2');",
    );
    let cols = live(&conn, "t");
    // Reorder c, a, b. Position is never the identity: the copy names sources.
    let new = vec![cols[2].clone(), cols[0].clone(), cols[1].clone()];
    rebuild(&conn, "t", &new).expect("a reorder is a faithful rebuild");

    assert_eq!(
        values(&conn, "SELECT c || '|' || a || '|' || b FROM t ORDER BY a"),
        vec!["c1|a1|b1".to_string(), "c2|a2|b2".to_string()],
        "every value stayed in the column it came from"
    );
    assert_eq!(
        values(
            &conn,
            "SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_table_info('t') ORDER BY cid)"
        ),
        vec!["c,a,b".to_string()],
        "the columns really were reordered"
    );
}

#[test]
fn a_rename_carries_values_and_the_objects_that_name_the_column() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 1);
         CREATE INDEX idx_t_qty ON t(quantity);
         CREATE TRIGGER trg_t_qty AFTER UPDATE OF quantity ON t BEGIN
             INSERT INTO audit (note) VALUES ('q=' || NEW.quantity);
         END;
         CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);
         INSERT INTO t (id, quantity) VALUES (1, 7), (2, 8);",
    );
    let new = renamed(&live(&conn, "t"), "quantity", "qty");
    rebuild(&conn, "t", &new).expect("a rename is carried by Column Identity");

    assert_eq!(
        values(&conn, "SELECT qty FROM t ORDER BY id"),
        vec!["7", "8"]
    );
    let index_sql = values(
        &conn,
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_t_qty'",
    );
    assert_eq!(
        index_sql,
        vec!["CREATE INDEX idx_t_qty ON t(\"qty\")".to_string()],
        "the index follows the column it indexed"
    );
    let trigger_sql = values(
        &conn,
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_t_qty'",
    );
    assert!(
        trigger_sql[0].contains("OF \"qty\""),
        "the trigger follows the column: {trigger_sql:?}"
    );

    // The recreated trigger still works against the renamed column.
    conn.execute("UPDATE t SET qty = 9 WHERE id = 1", [])
        .unwrap();
    assert_eq!(
        values(&conn, "SELECT note FROM audit"),
        vec!["q=9".to_string()],
        "the trigger body reads the new column"
    );
}

#[test]
fn a_rename_carries_every_constraint_that_names_the_column() {
    // The whole metadata set at once: renaming a column that is checked,
    // uniquely keyed, and indexed has to move every one of those definitions.
    let conn = conn_with(RICH_DDL);
    let before_triggers = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_t_qty'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(before_triggers, 1);

    let new = renamed(&live(&conn, "t"), "quantity", "qty");
    rebuild(&conn, "t", &new).expect("a rename is carried with its constraints");

    let ddl = stored_ddl(&conn, "t");
    assert!(ddl.contains("CHECK (\"qty\" > 0)"), "{ddl}");
    assert!(
        // The surviving columns keep the text they were written with; only the
        // renamed one is quoted, because only it had to be substituted.
        ddl.contains("UNIQUE (\"qty\", label)"),
        "the composite unique key follows the rename: {ddl}"
    );
    assert!(
        !ddl.contains("\"quantity\""),
        "no clause still names the old column: {ddl}"
    );
    let index_sql = values(
        &conn,
        "SELECT sql FROM sqlite_master WHERE name = 'idx_t_qty'",
    );
    assert_eq!(
        index_sql,
        vec!["CREATE INDEX idx_t_qty ON t(\"qty\")".to_string()]
    );
    assert_eq!(
        values(&conn, "SELECT qty FROM t ORDER BY id"),
        vec!["2", "3"]
    );
    // The generated column recomputes from the renamed source and the trigger
    // still runs.
    assert_eq!(
        values(&conn, "SELECT total FROM t ORDER BY id"),
        vec!["4", "6"]
    );
    conn.execute("UPDATE t SET qty = 5 WHERE id = 1", [])
        .unwrap();
    assert!(conn
        .execute("UPDATE t SET qty = 0 WHERE id = 1", [])
        .is_err());
}

// --- metadata survives, proven by a before/after sqlite_master comparison ---

#[test]
fn a_rich_table_rebuilds_and_keeps_every_schema_object() {
    let conn = conn_with(RICH_DDL);
    let before_objects = object_rows(&conn, "t");
    let before_columns: Vec<String> = values(
        &conn,
        "SELECT name || ':' || type FROM pragma_table_xinfo('t') ORDER BY cid",
    );
    let before_fks: Vec<String> = values(
        &conn,
        "SELECT \"table\" || '.' || \"from\" || '->' || \"to\" || ':' || on_delete || ':' || on_update \
         FROM pragma_foreign_key_list('t') ORDER BY id, seq",
    );
    let before_indexes: Vec<String> = values(
        &conn,
        "SELECT name || ':' || \"unique\" || ':' || origin FROM pragma_index_list('t') ORDER BY name",
    );
    let before_seq = shape_of(&conn).preserved.sequence;

    // A pure reorder: every value, column, key, check, index, and trigger must
    // come back exactly as it was.
    let cols = live(&conn, "t");
    let mut new = cols.clone();
    new.rotate_left(1);
    rebuild(&conn, "t", &new).expect("a rich table is rebuildable now");

    assert_eq!(
        object_rows(&conn, "t"),
        before_objects,
        "every index and trigger came back with the text SQLite stored"
    );
    assert_eq!(
        values(
            &conn,
            "SELECT name || ':' || type FROM pragma_table_xinfo('t') ORDER BY cid"
        )
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>(),
        before_columns
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        "no column was lost or retyped"
    );
    assert_eq!(
        values(
            &conn,
            "SELECT \"table\" || '.' || \"from\" || '->' || \"to\" || ':' || on_delete || ':' || on_update \
             FROM pragma_foreign_key_list('t') ORDER BY id, seq"
        ),
        before_fks,
        "both foreign keys kept their actions"
    );
    assert_eq!(
        values(
            &conn,
            "SELECT name || ':' || \"unique\" || ':' || origin FROM pragma_index_list('t') ORDER BY name"
        ),
        before_indexes,
        "the unique keys and their kinds survived"
    );
    assert_eq!(
        shape_of(&conn).preserved.sequence,
        before_seq,
        "the AUTOINCREMENT sequence survived"
    );

    let ddl = stored_ddl(&conn, "t");
    for clause in [
        "CHECK (quantity > 0)",
        "COLLATE NOCASE",
        "DEFAULT (datetime('now'))",
        "GENERATED ALWAYS AS (quantity * 2) STORED",
        "ON DELETE CASCADE",
        "ON UPDATE SET NULL",
        "UNIQUE (quantity, label)",
        "AUTOINCREMENT",
    ] {
        assert!(ddl.contains(clause), "the rebuild kept {clause}: {ddl}");
    }
    assert!(
        values(&conn, "SELECT count(*) FROM t") == vec!["2".to_string()],
        "both rows survived"
    );
    // The generated column still computes from the renamed... reordered column.
    assert_eq!(
        values(&conn, "SELECT total FROM t ORDER BY id"),
        vec!["4".to_string(), "6".to_string()]
    );
    // And the CHECK still bites.
    assert!(
        conn.execute("UPDATE t SET quantity = 0 WHERE id = 1", [])
            .is_err(),
        "the recreated CHECK constraint still rejects bad data"
    );
}

#[test]
fn a_round_trip_comparison_shows_the_schema_is_unchanged() {
    // The check the ticket asks for: compare `sqlite_master` before and after.
    let conn = conn_with(RICH_DDL);
    let before = schema_rows(&conn);
    let cols = live(&conn, "t");
    // An edit that changes no metadata at all: add a nullable column, which the
    // rebuild is only used for because a reorder is also requested.
    let mut new = vec![SqliteColumn {
        nullable: true,
        ..col("extra", "TEXT")
    }];
    new.extend(cols.iter().cloned());
    rebuild(&conn, "t", &new).unwrap();

    let after = schema_rows(&conn);
    // Every schema object that existed still exists, with the same stored text,
    // except the table itself (which now declares the added column).
    for row in &before {
        let found = after
            .iter()
            .find(|other| other.0 == row.0 && other.1 == row.1)
            .unwrap_or_else(|| panic!("{} {} disappeared", row.0, row.1));
        if row.0 == "table" && row.1 == "t" {
            continue;
        }
        assert_eq!(found.2, row.2, "{} {} changed", row.0, row.1);
    }
    assert_eq!(
        after.len(),
        before.len(),
        "no schema object was added or lost: {after:?}"
    );
}

#[test]
fn generated_columns_survive_and_are_never_copied_into() {
    let conn = conn_with(
        "CREATE TABLE t (
            a INTEGER NOT NULL,
            doubled INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL,
            tripled INTEGER AS (a * 3) STORED
         );
         INSERT INTO t (a) VALUES (2), (5);",
    );
    let cols = live(&conn, "t");
    assert!(
        cols.iter().any(|c| c.name == "doubled"),
        "a generated column is part of the live shape: {cols:?}"
    );
    // Reorder to put the generated columns first.
    let mut new = cols.clone();
    new.rotate_right(1);
    let script = script_for(&conn, "t", &new);
    assert!(
        !script.contains("(\"doubled\")") && !script.contains("\"doubled\", "),
        "a generated column is never an INSERT target: {script}"
    );
    rebuild(&conn, "t", &new).expect("generated columns are preserved");

    let ddl = stored_ddl(&conn, "t");
    assert!(ddl.contains("GENERATED ALWAYS AS (a * 2) VIRTUAL"), "{ddl}");
    assert!(ddl.contains("AS (a * 3) STORED"), "{ddl}");
    assert_eq!(
        values(&conn, "SELECT doubled || '|' || tripled FROM t ORDER BY a"),
        vec!["4|6".to_string(), "10|15".to_string()],
        "the generated values are recomputed, not copied"
    );
}

#[test]
fn table_options_survive_a_rebuild() {
    let strict = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, n INT NOT NULL) STRICT;
         INSERT INTO t (id, n) VALUES (1, 2);",
    );
    let cols = live(&strict, "t");
    let mut new = cols.clone();
    new.rotate_left(1);
    rebuild(&strict, "t", &new).expect("a STRICT table is rebuildable");
    assert!(stored_ddl(&strict, "t").contains("STRICT"));

    let without_rowid = conn_with(
        "CREATE TABLE t (code TEXT PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID;
         INSERT INTO t VALUES ('a', 1);",
    );
    let cols = live(&without_rowid, "t");
    let mut new = cols.clone();
    new.rotate_left(1);
    rebuild(&without_rowid, "t", &new).expect("a WITHOUT ROWID table is rebuildable");
    assert!(stored_ddl(&without_rowid, "t").contains("WITHOUT ROWID"));
    assert_eq!(
        values(&without_rowid, "SELECT code || ':' || n FROM t"),
        vec!["a:1".to_string()]
    );
}

#[test]
fn the_autoincrement_sequence_survives_a_rebuild() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL);
         INSERT INTO t (label) VALUES ('a'), ('b'), ('c');
         DELETE FROM t WHERE label = 'c';",
    );
    // The sequence is ahead of the largest surviving id: a rebuild that let it
    // fall back would hand out id 3 again.
    assert_eq!(shape_of(&conn).preserved.sequence, Some(3));

    let cols = live(&conn, "t");
    let mut new = cols.clone();
    new.rotate_left(1);
    rebuild(&conn, "t", &new).expect("an AUTOINCREMENT table is rebuildable");

    assert_eq!(
        shape_of(&conn).preserved.sequence,
        Some(3),
        "the rowid sequence did not fall back to the surviving maximum"
    );
    conn.execute("INSERT INTO t (label) VALUES ('d')", [])
        .unwrap();
    assert_eq!(
        values(&conn, "SELECT id FROM t WHERE label = 'd'"),
        vec!["4".to_string()],
        "the next id continues from where the table had got to"
    );
}

#[test]
fn an_empty_autoincrement_table_keeps_its_sequence() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);
         INSERT INTO t (label) VALUES ('a'), ('b');
         DELETE FROM t;",
    );
    assert_eq!(shape_of(&conn).preserved.sequence, Some(2));
    let cols = live(&conn, "t");
    let mut new = cols.clone();
    new.rotate_left(1);
    rebuild(&conn, "t", &new).unwrap();
    assert_eq!(
        shape_of(&conn).preserved.sequence,
        Some(2),
        "an empty table still remembers the ids it handed out"
    );
}

// --- one transaction: a rebuild either completes or changes nothing ---

#[test]
fn a_rebuild_completes_as_one_transaction() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT);
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');",
    );
    let old = live(&conn, "t");
    // Drop `note`: SQLite's ALTER TABLE cannot express that, so it is a rebuild.
    let new = vec![old[0].clone(), old[1].clone()];
    rebuild(&conn, "t", &new).unwrap();

    assert_eq!(
        values(&conn, "SELECT id || ':' || label FROM t ORDER BY id"),
        vec!["1:alpha".to_string(), "2:beta".to_string()],
        "every row survived and values stayed in their columns"
    );
    let cols: Vec<String> = live(&conn, "t").into_iter().map(|c| c.name).collect();
    assert_eq!(cols, vec!["id", "label"]);
    let tmp: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = '_gl_t_tmp'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tmp, 0, "the temporary table is gone");
}

#[test]
fn a_failure_mid_rebuild_leaves_the_original_table_intact() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT);
         CREATE INDEX idx_t_label ON t(label);
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');",
    );
    let before_schema = schema_rows(&conn);
    let old = live(&conn, "t");
    // `added` is NOT NULL with no default, so the copy step cannot backfill it:
    // the failure lands *after* the temporary table has been created.
    let new = vec![
        old[0].clone(),
        old[1].clone(),
        old[2].clone(),
        SqliteColumn {
            nullable: false,
            ..col("added", "TEXT")
        },
    ];
    let script = script_for(&conn, "t", &new);

    let err = apply_rebuild(&conn, "t", &script)
        .expect_err("the copy step cannot satisfy the new NOT NULL column");
    assert!(
        err.to_uppercase().contains("NOT NULL"),
        "the failure is the injected one: {err}"
    );

    assert_eq!(
        values(&conn, "SELECT id || ':' || label FROM t ORDER BY id"),
        vec!["1:alpha".to_string(), "2:beta".to_string()],
        "no data was lost"
    );
    assert_eq!(
        schema_rows(&conn),
        before_schema,
        "no temporary table, no dropped table, no partially rewritten schema"
    );
    // The rollback really closed the transaction: an ordinary write still works.
    conn.execute(
        "INSERT INTO t (id, label, note) VALUES (3, 'gamma', NULL)",
        [],
    )
    .expect("the connection is not left inside a failed transaction");
}

#[test]
fn a_failed_rebuild_never_cascades_into_child_rows() {
    let conn = conn_with(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT);
         CREATE TABLE child (
             id INTEGER PRIMARY KEY,
             t_id INTEGER REFERENCES t(id) ON DELETE CASCADE
         );
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');
         INSERT INTO child (id, t_id) VALUES (10, 1), (11, 2);",
    );
    let fk_on: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk_on, 1, "precondition: enforcement is on");

    let old = live(&conn, "t");
    let new = vec![
        old[0].clone(),
        old[1].clone(),
        old[2].clone(),
        SqliteColumn {
            nullable: false,
            ..col("added", "TEXT")
        },
    ];
    let script = script_for(&conn, "t", &new);
    assert!(
        apply_rebuild(&conn, "t", &script).is_err(),
        "the injected failure must roll the rebuild back"
    );

    assert_eq!(
        values(&conn, "SELECT count(*) FROM child"),
        vec!["2".to_string()],
        "DROP TABLE must not cascade-delete referencing rows"
    );
    let fk_after: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        fk_after, 1,
        "the session's foreign key enforcement is restored after the failure"
    );
}

#[test]
fn a_rebuild_that_would_orphan_child_rows_is_rolled_back() {
    let conn = conn_with(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
         CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER REFERENCES t(id));
         INSERT INTO t (id, label) VALUES (1, 'alpha'), (2, 'beta');
         INSERT INTO child (id, t_id) VALUES (10, 1), (11, 2);",
    );
    // A hand-written script that only carries row 1 leaves child 11 orphaned.
    // The recreated parent keeps its unique key, so the check reports the
    // dangling row instead of a key mismatch.
    let script = "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER NOT NULL, \"label\" TEXT, PRIMARY KEY (\"id\"));\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\" WHERE \"id\" = 1;\n\
                  DROP TABLE \"main\".\"t\";\n\
                  ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\"";
    let err = apply_rebuild(&conn, "t", script).expect_err("a dangling foreign key must fail");
    assert!(err.contains("foreign key"), "{err}");

    assert_eq!(
        (
            values(&conn, "SELECT count(*) FROM t"),
            values(&conn, "SELECT count(*) FROM child")
        ),
        (vec!["2".to_string()], vec!["2".to_string()]),
        "the original tables are intact"
    );
    assert_eq!(
        values(
            &conn,
            "SELECT count(*) FROM sqlite_master WHERE name = '_gl_t_tmp'"
        ),
        vec!["0".to_string()],
        "no temporary table left behind"
    );
}

#[test]
fn a_rebuild_that_breaks_the_parent_key_is_rolled_back() {
    // The recreated table must still carry the unique key its children point at;
    // SQLite reports that as a `foreign key mismatch` while checking.
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
         CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER REFERENCES t(id));
         INSERT INTO t (id, label) VALUES (1, 'alpha');
         INSERT INTO child (id, t_id) VALUES (10, 1);",
    );
    let script = "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER, \"label\" TEXT);\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\";\n\
                  DROP TABLE \"main\".\"t\";\n\
                  ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\"";
    let err = apply_rebuild(&conn, "t", script).expect_err("a broken parent key must fail");
    assert!(err.contains("foreign key"), "{err}");
    assert_eq!(
        values(&conn, "SELECT count(*) FROM t"),
        vec!["1".to_string()],
        "the original table is intact"
    );
    assert!(
        stored_ddl(&conn, "t").contains("PRIMARY KEY"),
        "the original DDL is restored"
    );
}

#[test]
fn a_table_that_gained_an_index_after_staging_is_refused_before_mutation() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT);
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first');",
    );
    let old = live(&conn, "t");
    let new = vec![old[0].clone(), old[1].clone(), old[2].clone()];
    // The script is built while the table has no index...
    let script = script_for(&conn, "t", &new);
    // ...and the table gains one before the change is committed.
    conn.execute_batch("CREATE INDEX idx_t_late ON t(note)")
        .unwrap();
    let before_schema = schema_rows(&conn);

    let err = apply_rebuild(&conn, "t", &script).expect_err("the index would be dropped");
    assert!(err.contains("idx_t_late"), "{err}");
    assert!(err.contains("Cannot rebuild"), "{err}");
    assert_eq!(
        schema_rows(&conn),
        before_schema,
        "refused before the first mutating statement: the index is still there"
    );
    assert_eq!(
        values(&conn, "SELECT count(*) FROM t"),
        vec!["1".to_string()]
    );
}

#[test]
fn a_script_that_omits_preserved_metadata_is_refused_before_mutation() {
    // The round-trip check, isolated: a script that "looks fine" but drops the
    // trigger is refused while the database is untouched.
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
         CREATE TRIGGER trg_t_late AFTER UPDATE ON t BEGIN SELECT 1; END;
         INSERT INTO t (id, label) VALUES (1, 'alpha');",
    );
    let before_schema = schema_rows(&conn);
    let script = "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER NOT NULL, \"label\" TEXT NOT NULL, PRIMARY KEY (\"id\"));\n\
                  INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\";\n\
                  DROP TABLE \"main\".\"t\";\n\
                  ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\"";
    let err = apply_rebuild(&conn, "t", script).expect_err("the trigger would be dropped");
    assert!(err.contains("trg_t_late"), "{err}");
    assert_eq!(schema_rows(&conn), before_schema, "nothing was mutated");
}

#[test]
fn a_rebuild_of_a_missing_table_is_refused() {
    let conn = conn_with("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    let err = apply_rebuild(&conn, "nope", "SELECT 1").expect_err("no such table");
    assert!(err.contains("does not exist"), "{err}");
}

#[test]
fn the_rebuild_script_declares_the_requested_columns() {
    // Guard against the copy step and the create step drifting apart: the
    // rebuild script's CREATE must declare exactly the requested columns.
    let conn = conn_with("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)");
    let old = live(&conn, "t");
    let new = vec![old[1].clone(), old[0].clone()];
    let script = sqlite_rebuild_script("t", &old, &new, &shape_of(&conn).preserved).unwrap();
    assert!(
        script[0].contains("\"label\" TEXT") && script[0].contains("\"id\" INTEGER"),
        "{}",
        script[0]
    );
    assert!(
        script[0].starts_with("CREATE TABLE \"main\".\"_gl_t_tmp\" ("),
        "{}",
        script[0]
    );
    assert!(
        script[1].contains("(\"label\", \"id\") SELECT \"label\", \"id\""),
        "the copy names its sources: {}",
        script[1]
    );
}
