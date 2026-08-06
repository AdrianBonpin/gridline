//! Pure SQL builders for PostgreSQL object CRUD. No DB I/O.

/// Escape an enum label as a single-quoted SQL literal (empty rejected).
pub fn validate_enum_label(label: &str) -> Result<String, String> {
    let t = label.trim();
    if t.is_empty() {
        return Err("Enum label must not be empty".into());
    }
    Ok(format!("'{}'", t.replace('\'', "''")))
}

/// Validate a SQL expression body: non-empty, no trailing semicolon.
pub fn validate_expression(expr: &str) -> Result<String, String> {
    let t = expr.trim();
    if t.is_empty() {
        return Err("Expression must not be empty".into());
    }
    if t.ends_with(';') {
        return Err("Expression must not end with ';'".into());
    }
    Ok(t.to_string())
}

/// Dispatch a DDL build by kind. `params` is the JSON payload from the frontend.
/// Returns one or more single SQL statements.
/// `params` is unused until object-kind arms are added (Tasks 2.2+).
#[allow(unused_variables)]
pub fn build_ddl(kind: &str, params: serde_json::Value) -> Result<Vec<String>, String> {
    match kind {
        other => Err(format!("Unsupported object kind: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_enum_label_quotes_and_doubles() {
        assert_eq!(validate_enum_label("admin").unwrap(), "'admin'");
        assert_eq!(validate_enum_label("user's").unwrap(), "'user''s'");
        assert!(validate_enum_label("").is_err());
        assert!(validate_enum_label("   ").is_err());
    }

    #[test]
    fn validate_expression_rejects_empty_and_trailing_semicolon() {
        assert_eq!(validate_expression("amount > 0").unwrap(), "amount > 0");
        assert!(validate_expression("").is_err());
        assert!(validate_expression("amount > 0;").is_err());
    }

    #[test]
    fn build_ddl_rejects_unknown_kind() {
        let res = build_ddl("bogus", serde_json::json!({}));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Unsupported object kind: bogus"));
    }
}