//! Ticket 11 — routine/trigger definitions must round-trip unchanged.
//!
//! A `CREATE FUNCTION` body is arbitrary text: it may contain single quotes,
//! semicolons, and — crucially — the very dollar-quote delimiter the builder
//! would otherwise choose. Wrapping such a body in `$$…$$` cuts it short at the
//! first inner `$$`, silently changing the routine's meaning. These tests pin
//! the contract: the body the user typed is the body the server stores,
//! byte for byte, or the DDL is rejected with a reason.

use super::*;

fn function_params(name: &str, body: &str) -> serde_json::Value {
    serde_json::json!({
        "schema": "public",
        "name": name,
        "is_procedure": false,
        "action": {
            "op": "create_or_replace",
            "args": [{ "mode": "in", "name": "a", "type": "int" }],
            "return_type": "text",
            "language": "plpgsql",
            "body": body,
            "volatility": null,
            "strict": false
        }
    })
}

fn procedure_params(name: &str, body: &str) -> serde_json::Value {
    let mut p = function_params(name, body);
    p["is_procedure"] = serde_json::json!(true);
    p["action"]["return_type"] = serde_json::json!(null);
    p
}

fn create_sql(kind: &str, p: serde_json::Value) -> Result<String, String> {
    build_ddl(kind, p).map(|v| v.join("\n"))
}

/// Pull the body back out of the generated `… AS <dollar-quoted>` tail exactly
/// the way PostgreSQL does: scanning stops at the *first* occurrence of the
/// opening delimiter, so anything left after it means the literal was cut short.
fn extract_body(sql: &str) -> String {
    let marker = " AS ";
    let at = sql.rfind(marker).expect("DDL has an AS clause") + marker.len();
    let quoted = &sql[at..];
    let after_open = quoted.strip_prefix('$').expect("body is dollar quoted");
    let (tag, rest) = after_open
        .split_once('$')
        .expect("body has a tag terminator");
    let close = format!("${tag}$");
    let (body, tail) = rest
        .split_once(&close)
        .unwrap_or_else(|| panic!("body must be closed by {close}: {quoted}"));
    assert!(
        tail.is_empty(),
        "nothing may follow the closing {close} — the literal was cut short: {quoted}"
    );
    body.to_string()
}

fn assert_round_trips(kind: &str, params: serde_json::Value, body: &str) {
    let sql = create_sql(kind, params).unwrap_or_else(|e| panic!("DDL must build: {e}"));
    assert_eq!(
        extract_body(&sql),
        body,
        "the stored definition must be the body verbatim: {sql}"
    );
}

#[test]
fn body_with_semicolons_and_quotes_round_trips() {
    assert_round_trips(
        "function",
        function_params(
            "quoted",
            "DECLARE x text := 'it''s; ok';\nBEGIN\n  RETURN x;\nEND;",
        ),
        "DECLARE x text := 'it''s; ok';\nBEGIN\n  RETURN x;\nEND;",
    );
}

#[test]
fn body_containing_the_anonymous_dollar_quote_round_trips() {
    let body = "BEGIN\n  RETURN 'pay $$ here';\nEND;";
    let sql = create_sql("function", function_params("dollar", body)).expect("DDL must build");
    assert!(
        !sql.contains("AS $$BEGIN"),
        "must not reuse a delimiter the body contains: {sql}"
    );
    assert_eq!(extract_body(&sql), body);
}

#[test]
fn body_containing_every_candidate_tag_round_trips() {
    let body = "$gridline0$ a $gridline1$ b $$ c;";
    assert_round_trips("function", function_params("tagged", body), body);
}

#[test]
fn procedure_bodies_round_trip_too() {
    let body = "BEGIN\n  PERFORM '$$; -- not a comment to us';\nEND;";
    assert_round_trips("procedure", procedure_params("do_it", body), body);
}

#[test]
fn unrepresentable_body_is_rejected_with_a_reason() {
    let err = create_sql("function", function_params("bad", "BEGIN\0END;"))
        .expect_err("a NUL byte cannot be represented in SQL text");
    assert!(
        err.contains("definition body") && err.contains("NUL"),
        "rejection must name the body and the reason: {err}"
    );
}

#[test]
fn language_must_be_a_plain_identifier() {
    for bad in ["plpgsql; DROP TABLE t", "pl pgsql", "plpgsql--", ""] {
        let mut p = function_params("f", "BEGIN END;");
        p["action"]["language"] = serde_json::json!(bad);
        let err = create_sql("function", p).expect_err("malformed language must be rejected");
        assert!(
            err.to_lowercase().contains("language"),
            "rejection must name the language for {bad:?}: {err}"
        );
    }
    // The values the UI offers stay accepted.
    for ok in ["plpgsql", "sql", "c"] {
        let mut p = function_params("f", "SELECT 1;");
        p["action"]["language"] = serde_json::json!(ok);
        create_sql("function", p).unwrap_or_else(|e| panic!("{ok} must be accepted: {e}"));
    }
}

/// Trigger DDL references identifiers that may need quoting (spaces, keywords,
/// mixed case). They are quoted — never dropped, lowercased, or mangled.
#[test]
fn trigger_create_quotes_awkward_identifiers() {
    let p = serde_json::json!({
        "schema": "my schema",
        "name": "tr weird",
        "action": {
            "op": "create",
            "table": "orders 2024",
            "timing": "BEFORE",
            "events": ["INSERT"],
            "orientation": "ROW",
            "function_schema": "select",
            "function_name": "fn Audit",
            "function_args": [],
            "when": null
        }
    });
    let sql = create_sql("trigger", p).expect("trigger DDL must build");
    assert_eq!(
        sql,
        "CREATE TRIGGER \"tr weird\" BEFORE INSERT ON \"my schema\".\"orders 2024\" FOR EACH ROW EXECUTE FUNCTION \"select\".\"fn Audit\"()"
    );
}

/// Argument names are identifiers too: a name needing quotes is quoted, and an
/// unnamed argument stays unnamed.
#[test]
fn function_argument_names_are_quoted() {
    let p = serde_json::json!({
        "schema": "public", "name": "f", "is_procedure": false,
        "action": {
            "op": "create_or_replace",
            "args": [
                { "mode": "in", "name": "we ird", "type": "int" },
                { "mode": "out", "name": "a\"b", "type": "text" },
                { "mode": "in", "name": "", "type": "numeric" }
            ],
            "return_type": null, "language": "sql", "body": "SELECT 1",
            "volatility": null, "strict": false
        }
    });
    let sql = create_sql("function", p).expect("DDL must build");
    assert!(
        sql.contains("(\"we ird\" int, OUT \"a\"\"b\" text, numeric)"),
        "argument names must be quoted identifiers: {sql}"
    );
}
