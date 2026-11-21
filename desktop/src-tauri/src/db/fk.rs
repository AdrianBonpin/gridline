//! Foreign-key targets and option search (ticket 12).
//!
//! A foreign key names a *relation*, and that relation can live in another
//! schema. Resolving it needs two separate guarantees, both implemented here so
//! they are tested once instead of per call site:
//!
//! 1. **The referenced schema is metadata, not a guess.** [`target_from_catalog`]
//!    takes the schema the catalog reported. A same-named table in the source
//!    schema is never substituted for the referenced one — that substitution is
//!    a silent wrong-row bug, not a fallback.
//! 2. **Search happens in the engine.** [`search_sql`] asks the referenced
//!    table for one page of *matches* (`LIMIT`/`OFFSET` with a bound substring
//!    predicate), so rows past an initial small page are reachable. Filtering a
//!    first page in the client cannot find them.
//!
//! Every identifier is emitted through [`crate::db::ident`]; nothing here
//! interpolates a name that has not been quoted.

use crate::db::ident::{self, Engine};

/// The largest page an FK option search will ask for.
pub const MAX_FK_OPTION_PAGE_SIZE: i64 = 200;

/// A resolved foreign-key target: the referenced relation and key column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FkTarget {
    pub schema: String,
    pub table: String,
    pub column: String,
}

impl FkTarget {
    pub fn new(schema: &str, table: &str, column: &str) -> Self {
        Self {
            schema: schema.to_string(),
            table: table.to_string(),
            column: column.to_string(),
        }
    }

    /// `schema.table`, the label shown next to the FK affordance.
    pub fn relation(&self) -> String {
        format!("{}.{}", self.schema, self.table)
    }
}

/// Build a target from catalog metadata.
///
/// `ref_schema` is what the engine reported. It is used verbatim (trimmed);
/// the source schema is only a fallback for engines/metadata that carry no
/// schema at all, so a same-named local table can never displace the referenced
/// one.
pub fn target_from_catalog(
    source_schema: &str,
    ref_schema: Option<&str>,
    ref_table: &str,
    ref_column: &str,
) -> Result<FkTarget, String> {
    ident::validate(ref_column).map_err(|e| format!("referenced column {ref_column:?}: {e}"))?;
    ident::validate(ref_table).map_err(|e| format!("referenced table {ref_table:?}: {e}"))?;
    let schema = match ref_schema.map(str::trim) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => source_schema.to_string(),
    };
    ident::validate(&schema).map_err(|e| format!("referenced schema {schema:?}: {e}"))?;
    Ok(FkTarget {
        schema,
        table: ref_table.to_string(),
        column: ref_column.to_string(),
    })
}

/// Whether a declared type is text-like enough to be part of FK option search.
///
/// Numbers, dates, JSON and binary values are matched through the key column's
/// text form; only character types are searched as display text so a dropdown
/// search does not match on an unrelated counter or a JSON blob.
pub fn is_text_like(data_type: &str) -> bool {
    let t = data_type.trim().to_ascii_lowercase();
    ["char", "text", "uuid", "citext", "clob"]
        .iter()
        .any(|k| t.contains(k))
}

/// The columns an option search matches: the referenced key column first, then
/// every text-like column of the referenced table, without duplicates.
pub fn search_columns(target: &FkTarget, table_columns: &[(String, String)]) -> Vec<String> {
    let mut columns = vec![target.column.clone()];
    for (name, data_type) in table_columns {
        if name == &target.column {
            continue;
        }
        if is_text_like(data_type) && !columns.contains(name) {
            columns.push(name.clone());
        }
    }
    columns
}

/// `SELECT * FROM <referenced relation> WHERE <key column> = <bound value>` for
/// the FK preview popover.
pub fn preview_sql(engine: Engine, target: &FkTarget) -> Result<String, String> {
    let relation = ident::qualified(engine, &target.schema, &target.table)
        .map_err(|e| format!("cannot address the referenced table: {e}"))?;
    let column = ident::quote_checked(engine, &target.column)
        .map_err(|e| format!("cannot address the referenced column: {e}"))?;
    let predicate = match engine {
        // The value arrives as text from the grid; cast the column so any
        // comparable type (bigint, uuid, enum, …) matches by its text form.
        Engine::PostgreSql => format!("{column}::text = $1"),
        Engine::Sqlite => format!("CAST({column} AS TEXT) = ?"),
        Engine::MySql => format!("CAST({column} AS CHAR) = ?"),
    };
    Ok(format!(
        "SELECT * FROM {relation} WHERE {predicate} LIMIT 1"
    ))
}

/// One page of FK option search, plus the matching count for that same
/// predicate.
///
/// The search term is always a bound value, so it can never become SQL — and it
/// is matched with `strpos`/`instr`/`LOCATE` rather than `LIKE`, so `%` and `_`
/// in a search term stay literal.
///
/// `binds` is how many times the caller binds the term to each statement:
/// PostgreSQL (`$1`) and SQLite (`?1`) reuse one numbered parameter for every
/// matched column, while MySQL placeholders are positional and repeat once per
/// column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FkSearchSql {
    pub rows: String,
    pub count: String,
    pub binds: usize,
}

pub fn search_sql(
    engine: Engine,
    target: &FkTarget,
    columns: &[String],
    limit: i64,
    offset: i64,
) -> Result<FkSearchSql, String> {
    if !(1..=MAX_FK_OPTION_PAGE_SIZE).contains(&limit) {
        return Err(format!(
            "foreign-key option search page size {limit} is outside 1..={MAX_FK_OPTION_PAGE_SIZE}"
        ));
    }
    if offset < 0 {
        return Err(format!(
            "foreign-key option search page offset {offset} cannot be negative"
        ));
    }
    if columns.is_empty() {
        return Err("foreign-key option search has no columns to match".to_string());
    }

    let relation = ident::qualified(engine, &target.schema, &target.table)
        .map_err(|e| format!("cannot address the referenced table: {e}"))?;
    let order = ident::quote_checked(engine, &target.column)
        .map_err(|e| format!("cannot order by the referenced column: {e}"))?;

    let mut parts = Vec::with_capacity(columns.len());
    for column in columns {
        let quoted = ident::quote_checked(engine, column)
            .map_err(|e| format!("cannot search referenced column {column:?}: {e}"))?;
        parts.push(match engine {
            Engine::PostgreSql => {
                format!("strpos(lower(CAST({quoted} AS TEXT)), lower($1)) > 0")
            }
            // `?1` (not a bare `?`) so one bound term serves every column.
            Engine::Sqlite => format!("instr(lower(CAST({quoted} AS TEXT)), lower(?1)) > 0"),
            Engine::MySql => {
                format!("LOCATE(LOWER(?), LOWER(CAST({quoted} AS CHAR))) > 0")
            }
        });
    }
    let predicate = format!("({})", parts.join(" OR "));
    let binds = match engine {
        Engine::MySql => columns.len(),
        Engine::PostgreSql | Engine::Sqlite => 1,
    };

    Ok(FkSearchSql {
        rows: format!(
            "SELECT * FROM {relation} WHERE {predicate} ORDER BY {order} ASC LIMIT {limit} OFFSET {offset}"
        ),
        count: format!("SELECT COUNT(*) FROM {relation} WHERE {predicate}"),
        binds,
    })
}

// ---------------------------------------------------------------------------
// Catalog lookups
// ---------------------------------------------------------------------------

/// Resolve a FK target from PostgreSQL's catalog. Binds `$1` = source schema,
/// `$2` = source table, `$3` = source column.
///
/// `pg_constraint`/`unnest(conkey, confkey)` pairs each referencing attribute
/// with exactly the referenced one, so a composite FK cannot resolve to the
/// wrong referenced column (the `information_schema` join would).
pub fn pg_fk_target_query() -> &'static str {
    "SELECT rn.nspname, rc.relname, ra.attname \
     FROM pg_constraint con \
     JOIN pg_class c ON c.oid = con.conrelid \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     JOIN pg_class rc ON rc.oid = con.confrelid \
     JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
     JOIN LATERAL unnest(con.conkey, con.confkey) AS k(attnum, refattnum) ON true \
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum \
     JOIN pg_attribute ra ON ra.attrelid = rc.oid AND ra.attnum = k.refattnum \
     WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2 AND a.attname = $3 \
     LIMIT 1"
}

/// Resolve a FK target from MySQL's catalog. Binds `?` = schema, table, column.
pub fn mysql_fk_target_query() -> &'static str {
    "SELECT referenced_table_schema, referenced_table_name, referenced_column_name \
     FROM information_schema.key_column_usage \
     WHERE table_schema = ? AND table_name = ? AND column_name = ? \
       AND referenced_table_name IS NOT NULL \
     LIMIT 1"
}

/// `PRAGMA foreign_key_list(<quoted table>)`, whose rows are
/// `(id, seq, referenced_table, from_column, to_column, …)`. SQLite has no
/// schemas, so the table name is an identifier and is quoted here.
pub fn sqlite_fk_target_query(table: &str) -> String {
    format!(
        "PRAGMA foreign_key_list({})",
        ident::quote(Engine::Sqlite, table)
    )
}

/// Pick the referenced target for `column` out of `PRAGMA foreign_key_list`
/// rows shaped `(referenced_table, from_column, to_column)`.
///
/// A table can carry several foreign keys; the one declared on the requested
/// column is the only correct answer, so an unknown column is an error rather
/// than a guess at the first FK.
pub fn sqlite_fk_target(
    rows: &[(String, String, String)],
    column: &str,
) -> Result<FkTarget, String> {
    let (table, _, to) = rows
        .iter()
        .find(|(_, from, _)| from == column)
        .ok_or_else(|| format!("column {column:?} is not a foreign key on this table"))?;
    target_from_catalog("main", Some("main"), table, to)
}

#[cfg(test)]
#[path = "fk.test.rs"]
mod tests;
