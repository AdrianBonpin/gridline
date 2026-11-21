use super::*;

// ---------------------------------------------------------------------------
// Quoting per engine
// ---------------------------------------------------------------------------

#[test]
fn pg_and_sqlite_quote_with_doubled_embedded_quotes() {
    for engine in [Engine::PostgreSql, Engine::Sqlite] {
        assert_eq!(quote(engine, "users"), "\"users\"");
        assert_eq!(quote(engine, "select"), "\"select\"");
        assert_eq!(quote(engine, "we ird"), "\"we ird\"");
        assert_eq!(quote(engine, "o'brien"), "\"o'brien\"");
        assert_eq!(quote(engine, "a\"b"), "\"a\"\"b\"");
        assert_eq!(quote(engine, "a\"; DROP TABLE t; --"), "\"a\"\"; DROP TABLE t; --\"");
    }
}

#[test]
fn mysql_quotes_with_doubled_backticks() {
    assert_eq!(quote(Engine::MySql, "users"), "`users`");
    assert_eq!(quote(Engine::MySql, "we ird"), "`we ird`");
    assert_eq!(quote(Engine::MySql, "o`brien"), "`o``brien`");
    assert_eq!(quote(Engine::MySql, "a\"b"), "`a\"b`");
    assert_eq!(quote(Engine::MySql, "a`; DROP TABLE t; --"), "`a``; DROP TABLE t; --`");
    // A single quote is not special inside backticks.
    assert_eq!(quote(Engine::MySql, "o'brien"), "`o'brien`");
}

#[test]
fn quoted_identifier_round_trips_through_an_unquote() {
    for name in ["plain", "we ird", "a\"b", "o'brien", "select", "µñï"] {
        let quoted = quote(Engine::PostgreSql, name);
        assert_eq!(unquote(Engine::PostgreSql, &quoted).as_deref(), Some(name));
    }
    for name in ["plain", "we ird", "a`b", "o'brien", "select"] {
        let quoted = quote(Engine::MySql, name);
        assert_eq!(unquote(Engine::MySql, &quoted).as_deref(), Some(name));
    }
}

// ---------------------------------------------------------------------------
// Representability (fail closed, never silently degrade)
// ---------------------------------------------------------------------------

#[test]
fn empty_identifiers_cannot_be_represented() {
    for engine in [Engine::PostgreSql, Engine::MySql, Engine::Sqlite] {
        let err = quote_checked(engine, "").unwrap_err();
        assert!(err.contains("empty"), "unexpected reason: {err}");
    }
}

#[test]
fn nul_bytes_cannot_be_represented() {
    for engine in [Engine::PostgreSql, Engine::MySql, Engine::Sqlite] {
        let err = quote_checked(engine, "a\0b").unwrap_err();
        assert!(err.contains("NUL"), "unexpected reason: {err}");
    }
}

#[test]
fn legal_identifiers_are_accepted_verbatim() {
    for name in [
        "we ird",
        "a\"b",
        "o'brien",
        "select",
        "MixedCase",
        "a;b",
        "a--b",
        "a/*b*/",
        "a\\b",
        "$tag$",
    ] {
        assert_eq!(
            quote_checked(Engine::PostgreSql, name).unwrap(),
            quote(Engine::PostgreSql, name),
            "legal identifier {name:?} must not be rejected or altered"
        );
    }
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

#[test]
fn qualified_names_quote_each_part() {
    assert_eq!(
        qualified(Engine::PostgreSql, "my schema", "we\"ird").unwrap(),
        "\"my schema\".\"we\"\"ird\""
    );
    assert_eq!(
        qualified(Engine::MySql, "my schema", "we`ird").unwrap(),
        "`my schema`.`we``ird`"
    );
    assert_eq!(
        qualified(Engine::Sqlite, "main", "my table").unwrap(),
        "\"main\".\"my table\""
    );
}

#[test]
fn qualified_names_reject_unrepresentable_parts() {
    assert!(qualified(Engine::PostgreSql, "", "t").is_err());
    assert!(qualified(Engine::PostgreSql, "public", "").is_err());
    assert!(qualified(Engine::MySql, "s\0", "t").is_err());
}

// ---------------------------------------------------------------------------
// PostgreSQL dollar-quoted definition bodies
// ---------------------------------------------------------------------------

#[test]
fn plain_body_uses_an_anonymous_dollar_quote() {
    let q = pg_dollar_quote("BEGIN RETURN 1; END;").unwrap();
    assert_eq!(q, "$$BEGIN RETURN 1; END;$$");
    assert_eq!(pg_dollar_quote("SELECT 'quoted';").unwrap(), "$$SELECT 'quoted';$$");
}

#[test]
fn body_containing_double_dollar_gets_a_named_tag() {
    let body = "BEGIN RETURN '$$'; END;";
    let q = pg_dollar_quote(body).unwrap();
    assert!(!q.starts_with("$$"), "must not reuse a delimiter the body contains: {q}");
    assert_eq!(unquote_dollar(&q), body);
}

#[test]
fn body_containing_every_candidate_tag_still_round_trips() {
    // A body that mentions several tags verbatim — the helper must skip them
    // all instead of producing an ambiguous definition.
    let body = "$gridline0$ x $gridline1$ y $gridline2$ SELECT '$$';";
    let q = pg_dollar_quote(body).unwrap();
    assert_eq!(unquote_dollar(&q), body);
}

#[test]
fn dollar_quoted_body_keeps_semicolons_and_quotes_verbatim() {
    let body = "DECLARE x text := 'it''s; ok';\nBEGIN\n  RETURN x;\nEND;";
    let q = pg_dollar_quote(body).unwrap();
    assert_eq!(unquote_dollar(&q), body);
}

#[test]
fn unrepresentable_body_is_rejected_with_a_reason() {
    let err = pg_dollar_quote("BEGIN\0END").unwrap_err();
    assert!(err.contains("NUL"), "unexpected reason: {err}");
}

// ---------------------------------------------------------------------------
// Helpers used by the round-trip assertions above
// ---------------------------------------------------------------------------

/// Inverse of [`quote`] for assertions only: strip the delimiters and undo the
/// doubling. Returns `None` when the input is not correctly delimited.
fn unquote(engine: Engine, quoted: &str) -> Option<String> {
    let (open, close) = match engine {
        Engine::MySql => ('`', '`'),
        _ => ('"', '"'),
    };
    let inner = quoted.strip_prefix(open)?.strip_suffix(close)?;
    let doubled = match engine {
        Engine::MySql => "``",
        _ => "\"\"",
    };
    Some(inner.replace(doubled, &open.to_string()))
}

/// Extract the payload of a dollar-quoted literal (assertion helper only).
fn unquote_dollar(quoted: &str) -> String {
    let rest = quoted.strip_prefix('$').expect("starts with $");
    let (tag, body) = rest.split_once('$').expect("has a closing tag $");
    let close = format!("${}$", tag);
    let body = body
        .strip_suffix(&close)
        .expect("body ends with the same tag");
    body.to_string()
}
