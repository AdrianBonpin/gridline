//! Single-row write safety (ticket 03).
//!
//! A queued row edit or delete must change **exactly the one intended row** or
//! change nothing. Three things make that true, and all three live here so the
//! engines cannot drift apart:
//!
//! 1. **The predicate.** The Row Identity (every primary-key column, or the
//!    backend physical locator) plus the original values the user saw. An
//!    update always carries the edited column's original value; a
//!    physical-locator write also carries the whole row's original values, so a
//!    row that moved — or a locator reused by a different row — is refused
//!    rather than modified.
//! 2. **The transaction.** Callers run the statement inside a transaction and
//!    commit only when it matched exactly one row; zero and multiple matches are
//!    rolled back before the failure is reported, so a reported failure can never
//!    conceal a durable write.
//! 3. **The outcome.** [`failure_message`] turns the affected-row count plus a
//!    Row-Identity probe into the error the viewer shows: stale row, ambiguous
//!    match, or a value conflict.
//!
//! Full-row optimistic versioning is deliberately **not** introduced: a
//! primary-key delete stays decided by its complete Row Identity, and an update
//! is guarded only by the column(s) the user edited.

use crate::db::ident::{self, Engine};
use serde_json::Value;

/// Which single-row write is being applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteKind {
    Update,
    Delete,
}

impl WriteKind {
    /// The verb used in messages ("cannot update/delete a row …").
    pub fn verb(self) -> &'static str {
        match self {
            WriteKind::Update => "update",
            WriteKind::Delete => "delete",
        }
    }
}

/// The physical row locator columns the backend appends to a no-PK table's data
/// SELECT (`ctid` for PostgreSQL, `rowid` for SQLite).
const PHYSICAL_LOCATORS: [&str; 2] = ["ctid", "rowid"];

/// True when this Row Identity is a backend physical locator rather than a
/// primary key. MySQL has no locator, so its identities are always primary keys.
pub fn is_physical_locator(identity: &[(String, Value)]) -> bool {
    identity.len() == 1 && PHYSICAL_LOCATORS.contains(&identity[0].0.as_str())
}

/// The original values that must guard this write, or an error when the write
/// cannot be guarded at all.
///
/// * **Update** — the edited column(s)' original values (the optimistic
///   predicate the spec requires), on every engine.
/// * **Delete with a physical locator** — the whole displayed row, because a
///   locator alone can address a different row once the row moves or its locator
///   is reused.
/// * **Delete with a primary key** — nothing: the complete Row Identity is the
///   predicate. Full-row versioning is intentionally out of scope.
///
/// Values for columns that are already part of the identity are dropped (they
/// are the same predicate twice). A physical-locator write with no original
/// values **fails closed**: there is no way to prove the locator still addresses
/// the row the user saw, so nothing may be written.
pub fn guards_for(
    kind: WriteKind,
    identity: &[(String, Value)],
    original: &[(String, Value)],
) -> Result<Vec<(String, Value)>, String> {
    let locator = is_physical_locator(identity);
    if !locator && kind == WriteKind::Delete {
        return Ok(Vec::new());
    }
    let guards: Vec<(String, Value)> = original
        .iter()
        .filter(|(col, _)| !identity.iter().any(|(identity_col, _)| identity_col == col))
        .cloned()
        .collect();
    if locator && guards.is_empty() {
        return Err(format!(
            "cannot {} a row addressed by its physical locator without the original row values: \
             a locator alone cannot prove it still addresses the displayed row, so nothing was written",
            kind.verb()
        ));
    }
    Ok(guards)
}

/// A single-row statement plus its bound values, in placeholder order.
#[derive(Debug, Clone, PartialEq)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
}

/// One single-row write, described independently of the engine that runs it.
pub struct RowWrite<'a> {
    pub engine: Engine,
    pub schema: &'a str,
    pub table: &'a str,
    pub kind: WriteKind,
    /// Row Identity: every primary-key column, or the physical locator.
    pub identity: &'a [(String, Value)],
    /// Columns to set (empty for a delete).
    pub new_data: &'a [(String, Value)],
    /// Original values from [`guards_for`]; owned because it is derived, not
    /// supplied.
    pub guard: Vec<(String, Value)>,
}

impl RowWrite<'_> {
    /// The UPDATE/DELETE that addresses one row.
    ///
    /// Note there is deliberately **no** `LIMIT 1` on any engine: a limited
    /// statement would cap a multiple match at one row, hiding the ambiguity
    /// this module exists to report. The caller's transaction rolls back a
    /// non-single match, so an ambiguous write is never durable.
    pub fn statement(&self) -> Result<Statement, String> {
        if self.identity.is_empty() {
            return Err(self.missing_identity());
        }
        if self.kind == WriteKind::Update && self.new_data.is_empty() {
            return Err("cannot update a row without any changed columns".to_string());
        }
        let target = ident::qualified(self.engine, self.schema, self.table)?;
        let mut params: Vec<Value> = Vec::new();

        let set_clause: Vec<String> = self
            .new_data
            .iter()
            .map(|(col, val)| {
                let sql = self.placeholder(&mut params, val);
                format!("{} = {sql}", ident::quote(self.engine, col))
            })
            .collect();

        let mut where_clause: Vec<String> = Vec::new();
        for (col, val) in self.identity.iter() {
            let sql = self.placeholder(&mut params, val);
            where_clause.push(format!("{} = {sql}", ident::quote(self.engine, col)));
        }
        for (col, val) in self.guard.iter() {
            let named = ident::quote(self.engine, col);
            if val.is_null() {
                // The cell the user saw was NULL; `= NULL` never matches, so
                // the guard must be `IS NULL`.
                where_clause.push(format!("{named} IS NULL"));
            } else {
                let sql = self.placeholder(&mut params, val);
                where_clause.push(format!("{named} = {sql}"));
            }
        }
        let where_sql = where_clause.join(" AND ");

        let sql = match self.kind {
            WriteKind::Update => format!(
                "UPDATE {target} SET {} WHERE {where_sql}",
                set_clause.join(", ")
            ),
            WriteKind::Delete => format!("DELETE FROM {target} WHERE {where_sql}"),
        };
        Ok(Statement { sql, params })
    }

    /// The probe that settles *why* a write matched no row: is the row still
    /// there under its Row Identity (a value conflict), or is it gone (a stale
    /// row)? It runs inside the same transaction the failed write rolled back,
    /// and reads nothing but existence.
    pub fn identity_probe(&self) -> Result<Statement, String> {
        if self.identity.is_empty() {
            return Err(self.missing_identity());
        }
        let target = ident::qualified(self.engine, self.schema, self.table)?;
        let mut params: Vec<Value> = Vec::new();
        let mut where_clause: Vec<String> = Vec::new();
        for (col, val) in self.identity.iter() {
            let sql = self.placeholder(&mut params, val);
            where_clause.push(format!("{} = {sql}", ident::quote(self.engine, col)));
        }
        Ok(Statement {
            sql: format!(
                "SELECT 1 FROM {target} WHERE {} LIMIT 1",
                where_clause.join(" AND ")
            ),
            params,
        })
    }

    fn placeholder(&self, params: &mut Vec<Value>, val: &Value) -> String {
        params.push(val.clone());
        match self.engine {
            Engine::PostgreSql => format!("${}", params.len()),
            Engine::MySql | Engine::Sqlite => "?".to_string(),
        }
    }

    fn missing_identity(&self) -> String {
        match self.engine {
            // MySQL has no physical locator, so a no-PK row cannot be addressed
            // at all — say so, rather than implying a locator might exist.
            Engine::MySql => format!(
                "cannot {} a row without a primary key (MySQL has no ctid)",
                self.kind.verb()
            ),
            _ => format!(
                "cannot {} a row without a primary key or row locator",
                self.kind.verb()
            ),
        }
    }
}

/// The user-facing error for a single-row write that matched `affected` rows.
///
/// `identity_rows` is the probe result ([`RowWrite::identity_probe`]): `None`
/// when no probe was needed (no original-value guard), `Some(n)` otherwise.
/// Returns `None` when the write matched exactly one row and is therefore
/// committable.
pub fn failure_message(
    affected: u64,
    identity_rows: Option<u64>,
    locator: bool,
    guarded_columns: &[String],
) -> Option<String> {
    if affected == 1 {
        return None;
    }
    if affected > 1 {
        return Some(format!(
            "ambiguous row match: {affected} rows matched the row identity; nothing was written"
        ));
    }
    match identity_rows {
        // No row carries this Row Identity any more.
        Some(0) | None => Some(STALE_ROW.to_string()),
        // The row is still there, so one of the values the user saw is not.
        Some(_) => Some(if locator {
            "row conflict: the row at the recorded physical locator changed in another session; \
             nothing was written"
                .to_string()
        } else {
            format!(
                "row conflict: {} changed in another session; nothing was written",
                column_phrase(guarded_columns)
            )
        }),
    }
}

/// The stale-row message (the row is gone, so there is nothing to write).
pub const STALE_ROW: &str = "row was modified or removed by another session; nothing was written";

fn column_phrase(columns: &[String]) -> String {
    match columns {
        [] => "a column value".to_string(),
        [one] => format!("column \"{one}\""),
        [first, rest @ ..] => {
            let mut names = format!("\"{first}\"");
            for c in rest {
                names.push_str(&format!(", \"{c}\""));
            }
            format!("columns {names}")
        }
    }
}

#[cfg(test)]
#[path = "row_write.test.rs"]
mod tests;
