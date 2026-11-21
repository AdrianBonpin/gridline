//! One shared, tested place for turning legal database names into SQL.
//!
//! Database identifiers are user data, not templates: a table, schema, or
//! column may legally be named `select`, `we ird`, `o'brien`, or `a"b`. Every
//! place in this crate that builds SQL from an identifier must quote it here
//! rather than interpolating it with `format!`, so quoting has exactly one
//! implementation per engine to test and to fix.
//!
//! Two rules govern this module:
//!
//! 1. **Quote, never sanitize.** A legal name is emitted verbatim inside the
//!    engine's delimiters, with the delimiter itself doubled (`"` → `""` for
//!    PostgreSQL and SQLite, `` ` `` → ` `` ` for MySQL). No name is rewritten,
//!    truncated, or silently dropped.
//! 2. **Fail closed.** A name that cannot be represented safely (empty, or
//!    containing a NUL byte) is rejected with a reason by [`quote_checked`] /
//!    [`qualified`] so the caller can surface an error. Returning unfiltered or
//!    unsorted rows because a name was skipped is the failure mode this module
//!    exists to prevent.

/// The SQL dialect an identifier is being quoted for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// PostgreSQL: `"..."` with `""` for an embedded double quote.
    PostgreSql,
    /// SQLite: `"..."` with `""` for an embedded double quote.
    Sqlite,
    /// MySQL / MariaDB: `` `...` `` with ` `` ` for an embedded backtick.
    MySql,
}

impl Engine {
    /// The dialect family name, useful in error messages and diagnostics.
    pub fn as_str(self) -> &'static str {
        match self {
            Engine::PostgreSql => "PostgreSQL",
            Engine::Sqlite => "SQLite",
            Engine::MySql => "MySQL",
        }
    }
}

/// Quote an identifier for `engine`, doubling any embedded delimiter.
///
/// This performs no validation — use [`quote_checked`] at any seam where an
/// unrepresentable name must produce an error instead of odd SQL.
///
/// ```text
/// quote(PostgreSql, "we ird") -> "we ird"      (outer double quotes)
/// quote(PostgreSql, "a\"b")   -> "a""b"         (embedded quote doubled)
/// quote(MySql,      "a`b")    -> `a``b`          (embedded backtick doubled)
/// ```
pub fn quote(engine: Engine, name: &str) -> String {
    match engine {
        Engine::MySql => format!("`{}`", name.replace('`', "``")),
        Engine::PostgreSql | Engine::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

/// Reject identifiers that no amount of quoting can represent faithfully.
///
/// Legal-but-awkward names (quotes, spaces, keywords, semicolons, backslashes)
/// are accepted — quoting makes them safe. Only genuinely unrepresentable
/// names fail: the empty identifier and any name containing a NUL byte (SQL
/// text is NUL-terminated at the C boundary).
pub fn validate(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("identifier is empty and cannot be represented in SQL".to_string());
    }
    if name.contains('\0') {
        return Err("identifier contains a NUL byte and cannot be represented in SQL".to_string());
    }
    Ok(())
}

/// Validate then quote: the fail-closed form for a single identifier.
pub fn quote_checked(engine: Engine, name: &str) -> Result<String, String> {
    validate(name).map_err(|e| format!("{}: {e}", engine.as_str()))?;
    Ok(quote(engine, name))
}

/// Validate then quote a `schema.name` (or `database.table`) pair.
///
/// Both parts are quoted independently, so schema-qualified names with quotes
/// or spaces work and a name containing a `.` stays a single identifier rather
/// than turning into an extra qualifier.
pub fn qualified(engine: Engine, schema: &str, name: &str) -> Result<String, String> {
    Ok(format!(
        "{}.{}",
        quote_checked(engine, schema)?,
        quote_checked(engine, name)?
    ))
}

/// [`qualified`] without validation, for builders that must stay infallible.
///
/// The escaping is identical, so the statement can never target a different
/// object; an unrepresentable name produces SQL the server rejects loudly
/// instead of being silently rewritten.
pub fn qualified_unchecked(engine: Engine, schema: &str, name: &str) -> String {
    format!(
        "{}.{}",
        quote(engine, schema),
        quote(engine, name)
    )
}

/// Wrap a routine/trigger definition body in a PostgreSQL dollar-quoted
/// literal whose delimiter cannot collide with the body.
///
/// `$$` is used when the body does not contain it (the common case, matching
/// hand-written SQL). Otherwise the first `$gridline<N>$` tag that does not
/// appear in the body is used, so a definition containing `$$`, quotes, and
/// semicolons is saved byte-for-byte instead of being cut short. A body that
/// cannot be represented is rejected with a reason — never altered.
pub fn pg_dollar_quote(body: &str) -> Result<String, String> {
    validate(body).map_err(|e| format!("definition body: {e}"))?;
    if !body.contains("$$") {
        return Ok(format!("$${body}$$"));
    }
    // A collision-free tag always exists for a finite body: each candidate is
    // distinct, so at most body.len() candidates can collide.
    for n in 0..=body.len() {
        let tag = format!("$gridline{n}$");
        if !body.contains(&tag) {
            return Ok(format!("{tag}{body}{tag}"));
        }
    }
    Err("definition body contains every candidate dollar-quote tag and cannot be represented".into())
}

#[cfg(test)]
#[path = "ident.test.rs"]
mod tests;
