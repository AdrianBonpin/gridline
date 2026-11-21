//! SQLite table rebuild: deciding whether a live table can be rebuilt
//! faithfully, and applying the rebuild script.
//!
//! Two invariants live here, and every caller routes through them:
//!
//! 1. **Refuse before mutating.** [`rebuild_blockers`] names, one by one, every
//!    feature of the *live* table that the current rebuild script cannot
//!    reproduce — AUTOINCREMENT, explicit indexes, triggers, keys, checks,
//!    uniques, generated columns, collations, expression defaults, and the
//!    `WITHOUT ROWID` / `STRICT` table options. A rebuild that ignored them
//!    would silently degrade the schema, so the answer is a refusal naming the
//!    blocker, raised before the script's first statement runs. Ticket 10 adds
//!    preservation for these features and lifts the matching refusal.
//! 2. **One transaction.** [`apply_rebuild`] runs the whole script (create temp
//!    table / copy rows / drop / rename) inside a single SQLite transaction with
//!    foreign-key enforcement suspended around it, so a failure leaves the
//!    database exactly as it was: no temporary table, no dropped rows, no
//!    half-rewritten schema.

use crate::db::object_ddl::SqliteColumn;
use rusqlite::{Connection, OptionalExtension};

/// Everything about a live SQLite table that decides whether a rebuild can be
/// faithful. Read once, before any mutation.
#[derive(Debug, Clone, PartialEq)]
pub struct SqliteTableShape {
    pub table: String,
    /// The stored `CREATE TABLE` text from `sqlite_master` (empty if the object
    /// is gone between the two reads).
    pub create_sql: String,
    /// Live columns in physical order (the same snapshot the editor diffs).
    pub columns: Vec<SqliteColumn>,
    /// Names of explicit `CREATE INDEX` indexes on the table. SQLite's implicit
    /// PK/UNIQUE autoindexes have no SQL and are therefore not listed.
    pub indexes: Vec<String>,
    /// Names of triggers attached to the table.
    pub triggers: Vec<String>,
}

impl SqliteTableShape {
    /// Every reason this shape cannot be rebuilt faithfully, in a stable order.
    /// An empty list means the rebuild script can reproduce the table.
    pub fn blockers(&self) -> Vec<String> {
        let ddl = self.create_sql.trim();
        let upper = ddl.to_ascii_uppercase();
        let mut out: Vec<String> = Vec::new();

        if self.columns.iter().any(|c| c.auto_increment) {
            out.push("AUTOINCREMENT would lose the table's rowid sequence".to_string());
        }
        if upper.starts_with("CREATE VIRTUAL TABLE") {
            out.push("the table is a virtual table and has no rows of its own".to_string());
        }
        if upper.contains("WITHOUT ROWID") {
            out.push("the table is WITHOUT ROWID, which a rebuild would not preserve".to_string());
        }
        if declares_table_option(&upper, "STRICT") {
            out.push("the table is STRICT, which a rebuild would not preserve".to_string());
        }
        if upper.contains("COLLATE") {
            out.push("a column declares COLLATE, which a rebuild would drop".to_string());
        }
        if upper.contains("GENERATED") {
            out.push("the table has generated columns, which a rebuild would lose".to_string());
        }
        if upper.contains("REFERENCES") {
            out.push("the table declares a FOREIGN KEY, which a rebuild would drop".to_string());
        }
        if upper.contains("CHECK") {
            out.push(
                "the table declares a CHECK constraint, which a rebuild would drop".to_string(),
            );
        }
        if upper.contains("UNIQUE") {
            out.push(
                "the table declares a UNIQUE constraint, which a rebuild would drop".to_string(),
            );
        }
        if !self.indexes.is_empty() {
            out.push(format!(
                "the table has indexes ({}) that a rebuild would drop",
                name_list(&self.indexes)
            ));
        }
        if !self.triggers.is_empty() {
            out.push(format!(
                "the table has triggers ({}) that a rebuild would drop",
                name_list(&self.triggers)
            ));
        }
        for c in &self.columns {
            if let Some(def) = &c.default {
                if !default_round_trips(def) {
                    out.push(format!(
                        "column \"{}\" has a DEFAULT expression ({def}) that a rebuild cannot \
                         re-emit faithfully",
                        c.name
                    ));
                }
            }
        }
        out
    }

    /// The refusal message for this shape, or `None` when a rebuild is safe.
    pub fn refusal(&self) -> Option<String> {
        let blockers = self.blockers();
        if blockers.is_empty() {
            None
        } else {
            Some(refusal_message(&self.table, &blockers))
        }
    }
}

/// One user-facing refusal sentence naming every blocker.
pub fn refusal_message(table: &str, blockers: &[String]) -> String {
    format!(
        "Cannot rebuild table \"{table}\": {}. Nothing was changed.",
        blockers.join("; ")
    )
}

/// Render up to a handful of object names; a schema with hundreds of triggers
/// must not produce an unbounded error message.
fn name_list(names: &[String]) -> String {
    const SHOWN: usize = 5;
    if names.len() <= SHOWN {
        return names.join(", ");
    }
    format!(
        "{}, +{} more",
        names[..SHOWN].join(", "),
        names.len() - SHOWN
    )
}

/// `WITHOUT ROWID` / `STRICT` are table options written after the closing
/// parenthesis, so the check is anchored to the end of the statement instead of
/// matching a same-named column.
fn declares_table_option(ddl_upper: &str, option: &str) -> bool {
    let tail = ddl_upper.trim_end().trim_end_matches(';').trim_end();
    tail.ends_with(option)
}

/// True when a `PRAGMA table_info` default value can be emitted verbatim as a
/// SQLite `DEFAULT` clause.
///
/// SQLite reports `DEFAULT (datetime('now'))` as `datetime('now')`; re-emitting
/// that text is a syntax error, so an expression default cannot be reproduced
/// without knowing it was parenthesised. Literals (numbers, quoted strings,
/// blob literals, `NULL`, and the current-time keywords) round-trip exactly.
pub fn default_round_trips(default: &str) -> bool {
    let d = default.trim();
    if d.is_empty() {
        return false;
    }
    let upper = d.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "NULL" | "TRUE" | "FALSE" | "CURRENT_TIMESTAMP" | "CURRENT_DATE" | "CURRENT_TIME"
    ) {
        return true;
    }
    // Blob literal: X'00ff'
    if upper.starts_with("X'") && d.ends_with('\'') {
        return true;
    }
    // Quoted string literal, with SQLite's doubled-quote escape.
    if d.starts_with('\'') && d.ends_with('\'') && d.len() >= 2 {
        return true;
    }
    // Numeric literal: optional sign, decimal / hex / float / exponent.
    let body = d.trim_start_matches(['+', '-']);
    if body.is_empty() {
        return false;
    }
    if let Some(hex) = body.strip_prefix("0x").or_else(|| body.strip_prefix("0X")) {
        return !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    let mut seen_digit = false;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '0'..='9' => seen_digit = true,
            '.' | 'e' | 'E' | '+' | '-' => {}
            _ => return false,
        }
    }
    seen_digit
}

/// The live columns of a SQLite table, in physical order.
///
/// Mirrors `PRAGMA table_info` + `PRAGMA index_list`/`index_info`; an
/// `auto_increment` column is an INTEGER primary key whose stored DDL really
/// says AUTOINCREMENT, and `unique` means a single-column unique index other
/// than the PK autoindex.
pub fn live_columns(conn: &Connection, table: &str) -> Result<Vec<SqliteColumn>, String> {
    let pragma_query = crate::db::introspection::sqlite_columns_query(table);
    let mut stmt = conn.prepare(&pragma_query).map_err(|e| e.to_string())?;
    let col_meta: Vec<(String, String, bool, bool, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,         // name
                row.get::<_, String>(2)?,         // type
                row.get::<_, bool>(3)?,           // notnull
                row.get::<_, bool>(5)?,           // pk
                row.get::<_, Option<String>>(4)?, // dflt_value
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    // AUTOINCREMENT only appears in the stored DDL of an INTEGER PK table.
    let autoinc = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get::<_, String>(0),
        )
        .map(|sql| sql.to_uppercase().contains("AUTOINCREMENT"))
        .unwrap_or(false);
    // Columns covered by a single-column unique index (origin != 'pk').
    let mut unique_cols: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Ok(mut idx_stmt) =
        conn.prepare(&crate::db::introspection::sqlite_index_list_query(table))
    {
        let indexes: Vec<(String, bool, String)> = idx_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?, // name
                    row.get::<_, bool>(2)?,   // unique
                    row.get::<_, String>(3)?, // origin
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (idx_name, is_unique, origin) in indexes {
            if !is_unique || origin == "pk" {
                continue;
            }
            if let Ok(mut info_stmt) = conn.prepare(
                &crate::db::introspection::sqlite_index_info_query(&idx_name),
            ) {
                let cols: Vec<String> = info_stmt
                    .query_map([], |row| row.get::<_, String>(2))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                if cols.len() == 1 {
                    unique_cols.insert(cols[0].clone());
                }
            }
        }
    }
    Ok(col_meta
        .iter()
        .map(|(name, dtype, notnull, is_pk, default)| SqliteColumn {
            name: name.clone(),
            type_: dtype.clone(),
            nullable: !notnull,
            default: default.clone(),
            is_pk: *is_pk,
            auto_increment: autoinc && *is_pk && dtype.trim().eq_ignore_ascii_case("INTEGER"),
            unique: unique_cols.contains(name),
            renamed_from: None,
        })
        .collect())
}

/// Read the live shape of `table` in one pass.
pub fn read_table_shape(conn: &Connection, table: &str) -> Result<SqliteTableShape, String> {
    let create_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let create_sql = create_sql.ok_or_else(|| format!("table \"{table}\" does not exist"))?;

    let triggers = object_names(conn, "trigger", table)?;
    let indexes = object_names(conn, "index", table)?;
    Ok(SqliteTableShape {
        table: table.to_string(),
        create_sql,
        columns: live_columns(conn, table)?,
        indexes,
        triggers,
    })
}

fn object_names(conn: &Connection, kind: &str, table: &str) -> Result<Vec<String>, String> {
    let sql = match kind {
        // An explicit index carries its CREATE statement; the implicit
        // PK/UNIQUE autoindexes have none, and are part of the table definition.
        "index" => {
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 \
             AND sql IS NOT NULL ORDER BY name"
        }
        _ => {
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt
        .query_map([table], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Apply a machine-generated rebuild script as **one** transaction.
///
/// The table's live shape is re-checked here, so a rebuild staged against a
/// table that has since gained an index, trigger, or other unpreserved feature
/// is refused before its first statement instead of degrading the schema. The
/// script then runs in a single transaction; any failure — a copy that violates
/// a NOT NULL, a bad DDL statement, a foreign key left dangling — rolls the
/// entire rebuild back.
pub fn apply_rebuild(conn: &Connection, table: &str, script: &str) -> Result<(), String> {
    let shape = read_table_shape(conn, table)?;
    if let Some(refusal) = shape.refusal() {
        return Err(refusal);
    }

    // `PRAGMA foreign_keys` is a no-op inside a transaction, so enforcement has
    // to be suspended first. With it on, `DROP TABLE` would delete referencing
    // child rows (ON DELETE CASCADE) or fail on a violation, so the rebuild
    // would either destroy data or never run.
    let fk_was_on: bool = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map(|v| v != 0)
        .unwrap_or(false);
    if fk_was_on {
        conn.execute_batch("PRAGMA foreign_keys = OFF")
            .map_err(|e| format!("cannot suspend foreign key enforcement: {e}"))?;
    }

    let result = in_one_transaction(conn, || {
        conn.execute_batch(script).map_err(|e| e.to_string())?;
        verify_no_dangling_foreign_keys(conn)
    });

    if fk_was_on {
        // Restore the session's enforcement even when the rebuild failed: this
        // connection is shared with ordinary reads and writes.
        let restored = conn.execute_batch("PRAGMA foreign_keys = ON");
        if restored.is_err() && result.is_ok() {
            return Err(
                "rebuild applied but foreign key enforcement could not be restored".to_string(),
            );
        }
    }
    result
}

fn in_one_transaction<F>(conn: &Connection, body: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("cannot begin the rebuild transaction: {e}"))?;
    match body() {
        Ok(()) => match conn.execute_batch("COMMIT") {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(format!("rebuild commit failed: {e}"))
            }
        },
        Err(e) => {
            // Roll back before reporting: the caller must never see a failed
            // rebuild that is actually still pending on the shared connection.
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// The SQLite 12-step rebuild procedure's sanity check: every foreign key in
/// the database must still resolve before the rebuild becomes durable.
fn verify_no_dangling_foreign_keys(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT \"table\", parent FROM pragma_foreign_key_check")
        .map_err(|e| format!("cannot check foreign keys after the rebuild: {e}"))?;
    // A `foreign key mismatch` (the recreated parent lost the unique key its
    // children point at) surfaces as an error while stepping, so row errors are
    // propagated instead of dropped.
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("cannot check foreign keys after the rebuild: {e}"))?;
    let mut violations: Vec<(String, String)> = Vec::new();
    loop {
        let row = rows
            .next()
            .map_err(|e| format!("cannot check foreign keys after the rebuild: {e}"))?;
        let Some(row) = row else { break };
        let child: String = row.get(0).map_err(|e| e.to_string())?;
        let parent: Option<String> = row.get(1).map_err(|e| e.to_string())?;
        violations.push((child, parent.unwrap_or_default()));
    }
    if violations.is_empty() {
        return Ok(());
    }
    let (child, parent) = &violations[0];
    Err(format!(
        "the rebuild would leave {} foreign key row(s) without a parent \
         (first: {}{})",
        violations.len(),
        child,
        if parent.is_empty() {
            String::new()
        } else {
            format!(" → {parent}")
        }
    ))
}

#[cfg(test)]
#[path = "sqlite_rebuild.test.rs"]
mod tests;
