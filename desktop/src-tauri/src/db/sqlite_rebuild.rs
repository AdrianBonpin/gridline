//! SQLite table rebuild: deciding whether a live table can be rebuilt
//! faithfully, and applying the rebuild script.
//!
//! Three invariants live here, and every caller routes through them:
//!
//! 1. **Refuse before mutating.** [`SqliteTableShape::refusal`] names, one by
//!    one, every feature of the *live* table that a rebuild cannot reproduce. The
//!    rebuild script now carries indexes, triggers, keys, checks, uniques,
//!    generated columns, collations, expression defaults, table options, and the
//!    `AUTOINCREMENT` sequence, so what remains is what genuinely cannot be
//!    re-emitted: a virtual table, a stored definition that cannot be parsed, a
//!    name SQLite would not quote back, and — for a specific edit — a preserved
//!    object that depends on a column the edit drops.
//! 2. **One transaction.** [`apply_rebuild`] runs the whole script (create temp
//!    table / copy rows / drop / rename / recreate the preserved objects) inside a
//!    single SQLite transaction with foreign-key enforcement suspended around it,
//!    so a failure leaves the database exactly as it was: no temporary table, no
//!    dropped rows, no half-rewritten schema.
//! 3. **The script is checked against the live table first.** [`apply_rebuild`]
//!    reads the script back as a plan and proves, before its first statement runs,
//!    that every index, trigger, constraint, column clause, table option, and
//!    sequence the live table has is reproduced. A script that would silently
//!    degrade the schema is refused while the database is untouched — the
//!    round-trip check, not just "the rebuild succeeded".

use crate::db::object_ddl::SqliteColumn;
use crate::db::sqlite_ddl::{
    normalize_sql, parse_create_table, parse_rebuild_script, rewrite_identifiers, ClauseKind,
    ConstraintKind, ParsedTable, PreservedTable, RebuildScript,
};
use rusqlite::{Connection, OptionalExtension};
use std::collections::{BTreeMap, BTreeSet, HashSet};

/// Everything about a live SQLite table that decides whether a rebuild can be
/// faithful, and what the rebuild has to reproduce. Read once, before any
/// mutation.
#[derive(Debug, Clone, PartialEq)]
pub struct SqliteTableShape {
    pub table: String,
    /// The stored `CREATE TABLE` text from `sqlite_master`.
    pub create_sql: String,
    /// Live columns in physical order (the same snapshot the editor diffs).
    pub columns: Vec<SqliteColumn>,
    /// The stored text of every explicit index and trigger, the parsed
    /// `CREATE TABLE`, and the table's sequence — everything a rebuild must
    /// reproduce outside the column list.
    pub preserved: PreservedTable,
    /// Why the stored definition could not be read, when it could not. A shape
    /// whose definition cannot be parsed cannot be reproduced.
    pub parse_error: Option<String>,
    /// Live columns that are generated (`PRAGMA table_xinfo.hidden` 2 or 3).
    pub generated_columns: HashSet<String>,
}

impl SqliteTableShape {
    pub fn index_names(&self) -> Vec<String> {
        self.preserved
            .index_sql
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }

    pub fn trigger_names(&self) -> Vec<String> {
        self.preserved
            .trigger_sql
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// Every reason the live table cannot be rebuilt as it stands, in a stable
    /// order. An empty list means the rebuild script can reproduce it.
    ///
    /// The edit is not known here: use [`Self::blockers_for`] to add the refusals
    /// that depend on which columns the submission drops or alters.
    pub fn blockers(&self) -> Vec<String> {
        let is_virtual = self
            .create_sql
            .trim()
            .to_ascii_uppercase()
            .starts_with("CREATE VIRTUAL TABLE");
        let mut out: Vec<String> = Vec::new();

        if is_virtual {
            out.push("the table is a virtual table and has no rows of its own".to_string());
        } else if let Some(err) = &self.parse_error {
            out.push(format!(
                "its stored definition cannot be read, so a rebuild cannot reproduce it ({err})"
            ));
        }
        for c in &self.columns {
            if crate::db::object_ddl::validate_object_name(&c.name).is_err() {
                out.push(format!(
                    "column \"{}\" has a name SQLite cannot be quoted back into a definition",
                    c.name
                ));
            }
        }
        out
    }

    /// The shape's own blockers plus the ones this particular edit creates: a
    /// preserved index, trigger, constraint, or generated expression that names a
    /// column the edit drops, or a generated column the edit rewrites (its
    /// expression is not editable, so a silent change would be a silent loss).
    pub fn blockers_for(&self, new: &[SqliteColumn]) -> Vec<String> {
        let mut out = self.blockers();
        if self.parse_error.is_some() {
            return out;
        }
        let parsed = &self.preserved.parsed;

        // Carried names: the submitted names and the live names they replace.
        let mut carried: HashSet<String> = HashSet::new();
        for c in new {
            carried.insert(c.name.to_ascii_lowercase());
            if let Some(from) = c.renamed_from.as_deref().filter(|f| *f != c.name) {
                carried.insert(from.to_ascii_lowercase());
            }
        }
        let dropped: Vec<&SqliteColumn> = self
            .columns
            .iter()
            .filter(|c| !carried.contains(&c.name.to_ascii_lowercase()))
            .collect();
        let dropped_names: Vec<String> = dropped.iter().map(|c| c.name.clone()).collect();

        for c in new {
            let source = new_source(&self.columns, c);
            let Some(source) = source else { continue };
            let Some(parsed_column) = parsed.column(&source.name) else {
                continue;
            };
            if !parsed_column.is_generated() || self.generated_columns.is_empty() {
                // The editor owns these attributes; a change is explicit intent.
                continue;
            }
            // A generated column's expression is carried verbatim, so a change to
            // its declared attributes would be silently ignored.
            let changed = source.type_.trim() != c.type_.trim()
                || source.nullable != c.nullable
                || source.default != c.default
                || source.is_pk != c.is_pk
                || source.unique != c.unique
                || source.auto_increment != c.auto_increment;
            if changed {
                out.push(format!(
                    "generated column \"{}\" cannot be altered: its expression is preserved \
                     verbatim, so a type, default, nullability, key, or uniqueness change would \
                     be silently ignored",
                    c.name
                ));
            }
        }

        // A generated column's expression is carried verbatim, so a column it
        // computes from cannot go away: refuse before the CREATE would fail.
        for column in &parsed.columns {
            let Some(generated) = column.clause(ClauseKind::Generated) else {
                continue;
            };
            let identifiers: Vec<String> = crate::db::sqlite_ddl::tokenize(&generated.text)
                .iter()
                .filter_map(|t| t.ident_value())
                .collect();
            for dropped in &dropped_names {
                if identifiers.iter().any(|i| i.eq_ignore_ascii_case(dropped)) {
                    out.push(format!(
                        "generated column \"{}\" computes from column \"{dropped}\", which this \
                         rebuild drops",
                        column.name
                    ));
                }
            }
        }

        for (name, sql) in &self.preserved.index_sql {
            if let Some(column) = names_dropped_column(sql, &dropped_names) {
                out.push(format!(
                    "index \"{name}\" uses column \"{column}\", which this rebuild drops"
                ));
            }
        }
        for (name, sql) in &self.preserved.trigger_sql {
            if let Some(column) = names_dropped_column(sql, &dropped_names) {
                out.push(format!(
                    "trigger \"{name}\" uses column \"{column}\", which this rebuild drops"
                ));
            }
        }
        for constraint in &parsed.constraints {
            if constraint.kind == ConstraintKind::PrimaryKey {
                continue;
            }
            for column in constraint.dependent_columns() {
                if let Some(dropped) = dropped_names
                    .iter()
                    .find(|d| d.eq_ignore_ascii_case(&column))
                {
                    out.push(format!(
                        "the {} {} uses column \"{dropped}\", which this rebuild drops",
                        match constraint.kind {
                            ConstraintKind::Check => "CHECK constraint",
                            ConstraintKind::Unique => "UNIQUE constraint",
                            ConstraintKind::ForeignKey => "FOREIGN KEY constraint",
                            ConstraintKind::PrimaryKey => "PRIMARY KEY constraint",
                        },
                        constraint
                            .name
                            .clone()
                            .map(|n| format!("\"{n}\""))
                            .unwrap_or_else(|| format!("\"{}\"", constraint.text))
                    ));
                }
            }
        }
        out
    }

    /// The refusal message for the live table as it stands, or `None` when a
    /// rebuild is safe.
    pub fn refusal(&self) -> Option<String> {
        let blockers = self.blockers();
        if blockers.is_empty() {
            None
        } else {
            Some(refusal_message(&self.table, &blockers))
        }
    }

    /// The refusal message for this shape *and* this edit, or `None`.
    pub fn refusal_for(&self, new: &[SqliteColumn]) -> Option<String> {
        let blockers = self.blockers_for(new);
        if blockers.is_empty() {
            None
        } else {
            Some(refusal_message(&self.table, &blockers))
        }
    }
}

/// The live column an edit entry draws its values from (Column Identity: the
/// explicit `renamed_from`, else the same name).
fn new_source<'a>(old: &'a [SqliteColumn], entry: &SqliteColumn) -> Option<&'a SqliteColumn> {
    let from = entry.renamed_from.as_deref().filter(|f| *f != entry.name);
    old.iter()
        .find(|o| from.map_or(o.name == entry.name, |f| o.name == f))
}

/// The dropped column a stored index or trigger definition names, if any.
fn names_dropped_column(sql: &str, dropped: &[String]) -> Option<String> {
    let identifiers: Vec<String> = crate::db::sqlite_ddl::tokenize(sql)
        .iter()
        .filter_map(|t| t.ident_value())
        .collect();
    dropped
        .iter()
        .find(|d| identifiers.iter().any(|i| i.eq_ignore_ascii_case(d)))
        .cloned()
}

/// One user-facing refusal sentence naming every blocker.
pub fn refusal_message(table: &str, blockers: &[String]) -> String {
    format!(
        "Cannot rebuild table \"{table}\": {}. Nothing was changed.",
        blockers.join("; ")
    )
}

/// True when a `PRAGMA table_info` default value can be emitted verbatim as a
/// SQLite `DEFAULT` clause.
///
/// SQLite reports `DEFAULT (datetime('now'))` as `datetime('now')`; re-emitting
/// that text is a syntax error, so an expression default cannot be reproduced
/// without knowing it was parenthesised. Literals (numbers, quoted strings, blob
/// literals, `NULL`, and the current-time keywords) round-trip exactly, and so
/// does a fully parenthesised expression, which is how an expression default has
/// to be written by hand.
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
    for c in body.chars() {
        match c {
            '0'..='9' => seen_digit = true,
            '.' | 'e' | 'E' | '+' | '-' => {}
            _ => {
                // Not a numeric literal; fall through to the parenthesised form.
                seen_digit = false;
                break;
            }
        }
    }
    if seen_digit {
        return true;
    }
    // A parenthesised expression: `(datetime('now'))`, `(1 + 2)`.
    if !d.starts_with('(') || !d.ends_with(')') {
        return false;
    }
    let mut depth = 0i32;
    for t in crate::db::sqlite_ddl::tokenize(d) {
        if t.text == "(" {
            depth += 1;
        } else if t.text == ")" {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        } else if depth == 0 && t.kind != crate::db::sqlite_ddl::TokenKind::Space {
            // Text after the closing parenthesis: not a single expression.
            return false;
        }
    }
    depth == 0
}

/// The live columns of a SQLite table, in physical order.
///
/// Mirrors `PRAGMA table_xinfo` (so a generated column is part of the shape
/// instead of invisible to it) plus `PRAGMA index_list`/`index_info`; an
/// `auto_increment` column is an INTEGER primary key whose stored DDL really
/// says AUTOINCREMENT, and `unique` means a single-column unique index other
/// than the PK autoindex.
pub fn live_columns(conn: &Connection, table: &str) -> Result<Vec<SqliteColumn>, String> {
    let pragma_query = crate::db::introspection::sqlite_columns_xinfo_query(table);
    let mut stmt = conn.prepare(&pragma_query).map_err(|e| e.to_string())?;
    // `hidden` is 0 for an ordinary column, 2 for VIRTUAL and 3 for STORED
    // generated columns, and 1 for a virtual table's hidden column.
    let col_meta: Vec<(String, String, bool, bool, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,         // name
                row.get::<_, String>(2)?,         // type
                row.get::<_, bool>(3)?,           // notnull
                row.get::<_, bool>(5)?,           // pk
                row.get::<_, Option<String>>(4)?, // dflt_value
                row.get::<_, i64>(6)?,            // hidden
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|(_, _, _, _, _, hidden)| *hidden != 1)
        .map(|(name, ty, notnull, pk, default, _)| (name, ty, notnull, pk, default))
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
    let mut unique_cols: HashSet<String> = HashSet::new();
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

/// Read the live shape of `table` in one pass: the `CREATE TABLE` text, the
/// columns, the indexes and triggers with their stored SQL, and the sequence.
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

    let (parsed, parse_error) = match parse_create_table(&create_sql) {
        Ok(parsed) => (parsed, None),
        Err(err) => (ParsedTable::default(), Some(err)),
    };
    let generated_columns = conn
        .prepare(&crate::db::introspection::sqlite_columns_xinfo_query(table))
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(6)?))
            })?
            .collect::<rusqlite::Result<Vec<(String, i64)>>>()
        })
        .map(|rows| {
            rows.into_iter()
                .filter(|(_, hidden)| *hidden == 2 || *hidden == 3)
                .map(|(name, _)| name)
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    Ok(SqliteTableShape {
        table: table.to_string(),
        preserved: PreservedTable {
            parsed,
            index_sql: object_sql(conn, "index", table)?,
            trigger_sql: object_sql(conn, "trigger", table)?,
            sequence: sequence_value(conn, table)?,
        },
        create_sql,
        columns: live_columns(conn, table)?,
        parse_error,
        generated_columns,
    })
}

/// The `(name, stored CREATE statement)` of every explicit index (`sql` is
/// non-null: the implicit PK/UNIQUE autoindexes have none) or trigger.
fn object_sql(conn: &Connection, kind: &str, table: &str) -> Result<Vec<(String, String)>, String> {
    let sql = match kind {
        "index" => {
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 \
             AND sql IS NOT NULL ORDER BY name"
        }
        _ => {
            "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1 \
             AND sql IS NOT NULL ORDER BY name"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([table], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// `sqlite_sequence.seq` for `table`, if this database has ever had an
/// AUTOINCREMENT row for it.
fn sequence_value(conn: &Connection, table: &str) -> Result<Option<i64>, String> {
    let has_sequence_table: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);
    if !has_sequence_table {
        return Ok(None);
    }
    conn.query_row(
        "SELECT seq FROM sqlite_sequence WHERE name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The round-trip check
// ---------------------------------------------------------------------------

/// What a rebuild must carry over, in a comparable form.
///
/// A rebuild may legitimately *add* schema (a new column, a new unique key from
/// the editor), so the check is containment: everything the live table had and
/// the editor does not own must still be there afterwards.
#[derive(Debug, Default, PartialEq, Eq)]
struct PreservedInventory {
    /// Table options (`WITHOUT ROWID`, `STRICT`), normalised.
    options: BTreeSet<String>,
    /// Column name -> the clause texts the editor does not model.
    column_clauses: BTreeMap<String, BTreeSet<String>>,
    /// Generated columns by name.
    generated: BTreeSet<String>,
    /// Table-level `CHECK`, multi-column `UNIQUE`, and `FOREIGN KEY` texts.
    constraints: BTreeSet<String>,
    /// Index definitions, normalised.
    indexes: BTreeSet<String>,
    /// Trigger definitions, normalised.
    triggers: BTreeSet<String>,
}

/// Lowercased column name -> the name it becomes after the rebuild.
type Renames = BTreeMap<String, String>;

fn rename_of(renames: &Renames, name: &str) -> String {
    renames
        .get(&name.to_ascii_lowercase())
        .cloned()
        .unwrap_or_else(|| name.to_string())
}

/// The preserved inventory of a live table, with the edit's renames applied so it
/// can be compared against the rebuilt table.
fn preserved_inventory(
    parsed: &ParsedTable,
    index_sql: &[(String, String)],
    trigger_sql: &[(String, String)],
    renames: &Renames,
    table: &str,
) -> PreservedInventory {
    let pairs: Vec<(String, String)> = renames
        .iter()
        .map(|(from, to)| (from.clone(), to.clone()))
        .collect();
    let rewrite = |text: &str| normalize_sql(&rewrite_identifiers(text, &pairs, table));

    let mut options = BTreeSet::new();
    for option in &parsed.options {
        options.insert(normalize_sql(option).to_ascii_uppercase());
    }

    let mut column_clauses: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut generated = BTreeSet::new();
    for column in &parsed.columns {
        let target = rename_of(renames, &column.name);
        if column.is_generated() {
            generated.insert(target.to_ascii_lowercase());
        }
        let clauses: BTreeSet<String> = column
            .preserved_clauses()
            .into_iter()
            .map(|c| rewrite(&c.text))
            .collect();
        if !clauses.is_empty() {
            column_clauses.insert(target.to_ascii_lowercase(), clauses);
        }
    }

    let mut constraints = BTreeSet::new();
    for constraint in &parsed.constraints {
        match constraint.kind {
            // Primary-key membership and a single-column UNIQUE are the column
            // editor's own attributes; the rest is not.
            ConstraintKind::PrimaryKey => {}
            ConstraintKind::Unique if constraint.columns.len() <= 1 => {}
            _ => {
                constraints.insert(rewrite(&constraint.text));
            }
        }
    }

    PreservedInventory {
        options,
        column_clauses,
        generated,
        constraints,
        indexes: index_sql.iter().map(|(_, sql)| rewrite(sql)).collect(),
        triggers: trigger_sql.iter().map(|(_, sql)| rewrite(sql)).collect(),
    }
}

/// Prove, from the script's own text, that the rebuild reproduces everything the
/// live table has. Runs before the first mutating statement.
fn verify_preserved(
    shape: &SqliteTableShape,
    plan: &RebuildScript,
    renames: &Renames,
) -> Result<(), String> {
    let parsed = &shape.preserved.parsed;
    let expected = preserved_inventory(
        parsed,
        &shape.preserved.index_sql,
        &shape.preserved.trigger_sql,
        renames,
        &shape.table,
    );
    let produced = preserved_inventory(&plan.create, &[], &[], &Renames::new(), &plan.tmp_table);

    let mut blockers: Vec<String> = Vec::new();

    for option in &expected.options {
        if !produced.options.contains(option) {
            blockers.push(format!("the table option {option} would be lost"));
        }
    }

    let declared: HashSet<String> = plan
        .columns
        .iter()
        .map(|c| c.to_ascii_lowercase())
        .collect();
    for (column, clauses) in &expected.column_clauses {
        if !declared.contains(column) {
            // The edit drops or renames this column; the guard has already had its
            // say on whether that is allowed.
            continue;
        }
        let actual = produced.column_clauses.get(column);
        for clause in clauses {
            if !actual.is_some_and(|a| a.contains(clause)) {
                blockers.push(format!(
                    "the rebuild would lose the clause {clause} of column \"{column}\""
                ));
            }
        }
    }
    for column in &expected.generated {
        if !declared.contains(column) {
            continue;
        }
        let produced_generated = plan
            .create
            .columns
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(column) && c.is_generated());
        if !produced_generated {
            blockers.push(format!(
                "the rebuild would lose the definition of generated column \"{column}\""
            ));
        }
    }
    for constraint in &expected.constraints {
        if !produced.constraints.contains(constraint) {
            blockers.push(format!(
                "the rebuild would drop the constraint {constraint}"
            ));
        }
    }
    // Indexes and triggers are recreated by their own statements, so the script's
    // statements are what has to match.
    let produced_indexes: BTreeSet<String> =
        plan.index_sql.iter().map(|s| normalize_sql(s)).collect();
    for sql in &expected.indexes {
        if !produced_indexes.contains(sql) {
            blockers.push(format!("the rebuild would drop the index {sql}"));
        }
    }
    let produced_triggers: BTreeSet<String> =
        plan.trigger_sql.iter().map(|s| normalize_sql(s)).collect();
    for sql in &expected.triggers {
        if !produced_triggers.contains(sql) {
            blockers.push(format!("the rebuild would drop the trigger {sql}"));
        }
    }

    if shape.preserved.sequence.is_some()
        && plan.declares_autoincrement()
        && !plan.restores_sequence
    {
        blockers.push(
            "the rebuild would reset the AUTOINCREMENT sequence, losing ids the table has \
             already handed out"
                .to_string(),
        );
    }

    if blockers.is_empty() {
        Ok(())
    } else {
        Err(refusal_message(&shape.table, &blockers))
    }
}

/// Apply a machine-generated rebuild script as **one** transaction.
///
/// The script is checked against the table's live shape first, so a rebuild
/// staged against a table that has since gained an index, trigger, constraint, or
/// sequence — or one that simply omits part of the shape — is refused before its
/// first statement instead of degrading the schema. The script then runs in a
/// single transaction; any failure — a copy that violates a NOT NULL, a bad DDL
/// statement, a foreign key left dangling — rolls the entire rebuild back.
pub fn apply_rebuild(conn: &Connection, table: &str, script: &str) -> Result<(), String> {
    let shape = read_table_shape(conn, table)?;
    if let Some(refusal) = shape.refusal() {
        return Err(refusal);
    }

    // The round-trip check: read the script's own plan back and prove it
    // reproduces the live table's preserved metadata.
    let plan = parse_rebuild_script(script)?;
    let live_names: Vec<String> = shape.columns.iter().map(|c| c.name.clone()).collect();
    let renames: Renames = plan
        .renamed_columns(&live_names)?
        .into_iter()
        .map(|(from, to)| (from.to_ascii_lowercase(), to))
        .collect();
    verify_preserved(&shape, &plan, &renames)?;

    // `PRAGMA foreign_keys` is a no-op inside a transaction, so enforcement has
    // to be suspended first. With it on, `DROP TABLE` would delete referencing
    // child rows (ON DELETE CASCADE) or fail on a violation, so the rebuild
    // would either destroy data or never run.
    let fk_was_on = pragma_is_on(conn, "foreign_keys");
    if fk_was_on {
        conn.execute_batch("PRAGMA foreign_keys = OFF")
            .map_err(|e| format!("cannot suspend foreign key enforcement: {e}"))?;
    }
    // `ALTER TABLE … RENAME TO` normally reparses the whole schema so it can
    // rewrite every reference to the renamed table. A rebuild runs it while the
    // original table is dropped, so any view that reads the table is momentarily
    // dangling and that reparse fails ("error in view …: no such table"). The
    // rename only has to rename the rebuild's own temporary table, which nothing
    // references, and the indexes and triggers are recreated explicitly — so the
    // legacy rename is exactly the behavior a rebuild wants.
    let legacy_alter_was_on = pragma_is_on(conn, "legacy_alter_table");
    if !legacy_alter_was_on {
        conn.execute_batch("PRAGMA legacy_alter_table = ON")
            .map_err(|e| format!("cannot prepare the rebuild's rename: {e}"))?;
    }

    let result = in_one_transaction(conn, || {
        conn.execute_batch(script).map_err(|e| e.to_string())?;
        verify_no_dangling_foreign_keys(conn)
    });

    // Restore the session's settings even when the rebuild failed: this
    // connection is shared with ordinary reads and writes.
    let mut restore_error: Option<String> = None;
    if fk_was_on && conn.execute_batch("PRAGMA foreign_keys = ON").is_err() {
        restore_error =
            Some("rebuild applied but foreign key enforcement could not be restored".to_string());
    }
    if !legacy_alter_was_on {
        let _ = conn.execute_batch("PRAGMA legacy_alter_table = OFF");
    }
    if result.is_ok() {
        if let Some(err) = restore_error {
            return Err(err);
        }
    }
    result
}

/// A boolean connection pragma, defaulting to off when it cannot be read.
fn pragma_is_on(conn: &Connection, pragma: &str) -> bool {
    conn.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get::<_, i64>(0))
        .map(|v| v != 0)
        .unwrap_or(false)
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
