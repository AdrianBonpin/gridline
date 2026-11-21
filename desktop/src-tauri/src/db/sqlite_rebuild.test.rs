use super::*;
use crate::db::object_ddl::{sqlite_create_table_sql, sqlite_rebuild_script, SqliteColumn};

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

fn shaped(
    ddl: &str,
    columns: Vec<SqliteColumn>,
    indexes: &[&str],
    triggers: &[&str],
) -> SqliteTableShape {
    SqliteTableShape {
        table: "t".into(),
        create_sql: ddl.into(),
        columns,
        indexes: indexes.iter().map(|s| s.to_string()).collect(),
        triggers: triggers.iter().map(|s| s.to_string()).collect(),
    }
}

/// A plain table: one integer primary key, no index/trigger/check/default.
const PLAIN_DDL: &str = "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT)";

fn plain_shape() -> SqliteTableShape {
    shaped(
        PLAIN_DDL,
        vec![
            SqliteColumn {
                is_pk: true,
                nullable: false,
                ..col("id", "INTEGER")
            },
            SqliteColumn {
                nullable: false,
                ..col("label", "TEXT")
            },
            col("note", "TEXT"),
        ],
        &[],
        &[],
    )
}

fn shape_of(conn: &Connection) -> SqliteTableShape {
    read_table_shape(conn, "t").unwrap()
}

// --- refusal: every blocker is named, and a plain table has none ---

#[test]
fn a_plain_table_has_no_blockers() {
    assert_eq!(plain_shape().blockers(), Vec::<String>::new());
    assert_eq!(plain_shape().refusal(), None);
    let conn = conn_with(PLAIN_DDL);
    assert_eq!(shape_of(&conn).blockers(), Vec::<String>::new());
}

#[test]
fn autoincrement_is_refused_by_name() {
    let shape = shaped(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)",
        vec![SqliteColumn {
            is_pk: true,
            auto_increment: true,
            nullable: false,
            ..col("id", "INTEGER")
        }],
        &[],
        &[],
    );
    let refusal = shape.refusal().expect("AUTOINCREMENT must be refused");
    assert!(refusal.contains("AUTOINCREMENT"), "{refusal}");
}

#[test]
fn a_live_autoincrement_table_is_detected_from_its_stored_ddl() {
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);
         INSERT INTO t (label) VALUES ('a');",
    );
    let shape = shape_of(&conn);
    assert!(shape.columns.iter().any(|c| c.auto_increment));
    let refusal = shape.refusal().expect("AUTOINCREMENT must be refused");
    assert!(refusal.contains("AUTOINCREMENT"), "{refusal}");
}

#[test]
fn an_explicit_index_is_refused_and_named() {
    let conn = conn_with(&format!(
        "{PLAIN_DDL}; CREATE INDEX idx_t_label ON t(label);"
    ));
    let shape = shape_of(&conn);
    assert_eq!(shape.indexes, vec!["idx_t_label".to_string()]);
    let refusal = shape.refusal().expect("an index must be refused");
    assert!(
        refusal.contains("indexes") && refusal.contains("idx_t_label"),
        "the refusal names the index: {refusal}"
    );
}

#[test]
fn a_pk_autoindex_is_not_an_explicit_index() {
    // SQLite creates an implicit index for a TEXT primary key; it is part of the
    // table definition and must not be reported as a rebuild blocker.
    let conn = conn_with("CREATE TABLE t (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    let shape = shape_of(&conn);
    assert!(shape.indexes.is_empty(), "{:?}", shape.indexes);
    assert_eq!(shape.blockers(), Vec::<String>::new());
}

#[test]
fn a_trigger_is_refused_and_named() {
    let conn = conn_with(&format!(
        "{PLAIN_DDL};
         CREATE TRIGGER trg_t_note AFTER UPDATE ON t BEGIN SELECT 1; END;"
    ));
    let shape = shape_of(&conn);
    assert_eq!(shape.triggers, vec!["trg_t_note".to_string()]);
    let refusal = shape.refusal().expect("a trigger must be refused");
    assert!(
        refusal.contains("triggers") && refusal.contains("trg_t_note"),
        "the refusal names the trigger: {refusal}"
    );
}

#[test]
fn keys_checks_and_uniques_are_refused_from_the_stored_ddl() {
    for (ddl, blocker) in [
        (
            "CREATE TABLE t (id INTEGER PRIMARY KEY, ref INTEGER REFERENCES t(id))",
            "FOREIGN KEY",
        ),
        (
            "CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER CHECK (n > 0))",
            "CHECK",
        ),
        (
            "CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT UNIQUE)",
            "UNIQUE",
        ),
    ] {
        let shape = shaped(ddl, vec![col("id", "INTEGER")], &[], &[]);
        let refusal = shape
            .refusal()
            .unwrap_or_else(|| panic!("{ddl} must be refused"));
        assert!(refusal.contains(blocker), "{ddl} -> {refusal}");
    }
}

#[test]
fn unsupported_table_options_and_columns_are_refused() {
    for (ddl, blocker) in [
        ("CREATE TABLE t (id INTEGER PRIMARY KEY) WITHOUT ROWID", "WITHOUT ROWID"),
        ("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT", "STRICT"),
        (
            "CREATE VIRTUAL TABLE t USING fts5(body)",
            "virtual table",
        ),
        (
            "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT COLLATE NOCASE)",
            "COLLATE",
        ),
        (
            "CREATE TABLE t (id INTEGER PRIMARY KEY, total INTEGER GENERATED ALWAYS AS (id * 2) VIRTUAL)",
            "generated columns",
        ),
    ] {
        let shape = shaped(ddl, vec![col("id", "INTEGER")], &[], &[]);
        let refusal = shape.refusal().unwrap_or_else(|| panic!("{ddl} must be refused"));
        assert!(refusal.contains(blocker), "{ddl} -> {refusal}");
    }
}

#[test]
fn an_expression_default_is_refused_while_literals_round_trip() {
    // SQLite reports `DEFAULT (datetime('now'))` as `datetime('now')`; emitting
    // that text again is a syntax error, so the rebuild cannot be faithful.
    let conn = conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    let shape = shape_of(&conn);
    let refusal = shape
        .refusal()
        .expect("an expression default must be refused");
    assert!(
        refusal.contains("created_at") && refusal.contains("DEFAULT"),
        "the refusal names the column and the default: {refusal}"
    );

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
    ] {
        assert!(
            default_round_trips(literal),
            "{literal} is a literal and must round-trip"
        );
    }
    for expression in ["datetime('now')", "(1 + 2)", "lower('A')", ""] {
        assert!(
            !default_round_trips(expression),
            "{expression} cannot be emitted as a DEFAULT clause"
        );
    }
}

// --- one transaction: a rebuild either completes or changes nothing ---

/// Original table with two rows, plus a child table pointing at it.
fn seeded_plain_table() -> Connection {
    conn_with(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL, note TEXT);
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');",
    )
}

fn schema_snapshot(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare("SELECT type, name FROM sqlite_master ORDER BY type, name")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

fn rows(conn: &Connection) -> Vec<(i64, String, Option<String>)> {
    let mut stmt = conn
        .prepare("SELECT id, label, note FROM t ORDER BY id")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// `(id, label)` pairs of the rebuilt table, which no longer has `note`.
fn labels_after_rebuild(conn: &Connection) -> Vec<(i64, String)> {
    let mut stmt = conn.prepare("SELECT id, label FROM t ORDER BY id").unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

#[test]
fn a_rebuild_completes_as_one_transaction() {
    let conn = seeded_plain_table();
    let old = live_columns(&conn, "t").unwrap();
    // Drop `note`: SQLite's ALTER TABLE cannot express that, so it is a rebuild.
    let new = vec![old[0].clone(), old[1].clone()];
    let script = sqlite_rebuild_script("t", &old, &new).unwrap().join(";\n");

    apply_rebuild(&conn, "t", &script).unwrap();

    assert_eq!(
        labels_after_rebuild(&conn),
        vec![(1, "alpha".to_string()), (2, "beta".to_string())],
        "every row survived and values stayed in their columns"
    );
    let cols: Vec<String> = live_columns(&conn, "t")
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
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
    let conn = seeded_plain_table();
    let before_schema = schema_snapshot(&conn);
    let before_rows = rows(&conn);
    let old = live_columns(&conn, "t").unwrap();
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
    let script = sqlite_rebuild_script("t", &old, &new).unwrap().join(";\n");

    let err = apply_rebuild(&conn, "t", &script)
        .expect_err("the copy step cannot satisfy the new NOT NULL column");
    assert!(
        err.to_uppercase().contains("NOT NULL"),
        "the failure is the injected one: {err}"
    );

    assert_eq!(rows(&conn), before_rows, "no data was lost");
    assert_eq!(
        schema_snapshot(&conn),
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

    let old = live_columns(&conn, "t").unwrap();
    let new = vec![
        old[0].clone(),
        old[1].clone(),
        old[2].clone(),
        SqliteColumn {
            nullable: false,
            ..col("added", "TEXT")
        },
    ];
    let script = sqlite_rebuild_script("t", &old, &new).unwrap().join(";\n");
    assert!(
        apply_rebuild(&conn, "t", &script).is_err(),
        "the injected failure must roll the rebuild back"
    );

    let child_rows: i64 = conn
        .query_row("SELECT count(*) FROM child", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        child_rows, 2,
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

    let parents: i64 = conn
        .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
        .unwrap();
    let children: i64 = conn
        .query_row("SELECT count(*) FROM child", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        (parents, children),
        (2, 2),
        "the original tables are intact"
    );
    let tmp: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = '_gl_t_tmp'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tmp, 0, "no temporary table left behind");
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
    let parents: i64 = conn
        .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
        .unwrap();
    assert_eq!(parents, 1, "the original table is intact");
    let has_pk: String = conn
        .query_row("SELECT sql FROM sqlite_master WHERE name = 't'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        has_pk.contains("PRIMARY KEY"),
        "the original DDL is restored: {has_pk}"
    );
}

#[test]
fn a_shape_that_became_unsupported_after_staging_is_refused_before_mutation() {
    let conn = conn_with(&format!(
        "{PLAIN_DDL};
         INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first');
         CREATE TRIGGER trg_t_late AFTER UPDATE ON t BEGIN SELECT 1; END;"
    ));
    let before_schema = schema_snapshot(&conn);
    let old = live_columns(&conn, "t").unwrap();
    let new = vec![old[0].clone(), old[1].clone(), old[2].clone()];
    let script = sqlite_rebuild_script("t", &old, &new).unwrap().join(";\n");

    let err = apply_rebuild(&conn, "t", &script).expect_err("a late trigger must be refused");
    assert!(err.contains("trg_t_late"), "{err}");
    assert_eq!(
        schema_snapshot(&conn),
        before_schema,
        "refused before the first mutating statement: the trigger is still there"
    );
    assert_eq!(rows(&conn).len(), 1);
}

#[test]
fn a_rebuild_of_a_missing_table_is_refused() {
    let conn = conn_with(PLAIN_DDL);
    let err = apply_rebuild(&conn, "nope", "SELECT 1").expect_err("no such table");
    assert!(err.contains("does not exist"), "{err}");
}

#[test]
fn create_table_sql_for_a_rebuilt_table_uses_the_same_columns() {
    // Guard against the copy step and the create step drifting apart: the
    // rebuild script's CREATE must declare exactly the requested columns.
    let old = vec![col("id", "INTEGER"), col("label", "TEXT")];
    let new = vec![col("label", "TEXT"), col("id", "INTEGER")];
    let create = sqlite_create_table_sql("_gl_t_tmp", &new, &[]).unwrap();
    assert!(create.contains("\"label\" TEXT"), "{create}");
    assert!(create.contains("\"id\" INTEGER"), "{create}");
    let script = sqlite_rebuild_script("t", &old, &new).unwrap();
    assert_eq!(
        script[0], create,
        "the script's first statement is that CREATE"
    );
}
