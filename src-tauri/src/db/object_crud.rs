//! Pure SQL builders for PostgreSQL object CRUD. No DB I/O.

use crate::db::object_ddl::{quote_ident, validate_object_name};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SequenceParams {
    pub schema: String,
    pub name: String,
    pub action: SequenceAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum SequenceAction {
    Create { increment: Option<String>, min_value: Option<String>, max_value: Option<String>, start: Option<String>, cycle: bool },
    Alter { increment: Option<String>, min_value: Option<String>, max_value: Option<String>, cycle: Option<bool> },
    Restart { with: Option<String> },
    Drop,
}

fn qual(schema: &str, name: &str) -> Result<String, String> {
    validate_object_name(schema)?;
    validate_object_name(name)?;
    Ok(format!("{}.{}", quote_ident(schema), quote_ident(name)))
}

pub fn sequence_ddl(p: &SequenceParams) -> Result<Vec<String>, String> {
    let q = qual(&p.schema, &p.name)?;
    Ok(vec![match &p.action {
        SequenceAction::Create { increment, min_value, max_value, start, cycle } => {
            let mut s = format!("CREATE SEQUENCE {}", q);
            if let Some(v) = increment { s.push_str(&format!("\n  INCREMENT BY {}", v)); }
            if let Some(v) = min_value { s.push_str(&format!("\n  MINVALUE {}", v)); }
            if let Some(v) = max_value { s.push_str(&format!("\n  MAXVALUE {}", v)); }
            if let Some(v) = start { s.push_str(&format!("\n  START WITH {}", v)); }
            s.push_str(if *cycle { "\n  CYCLE" } else { "\n  NO CYCLE" });
            s
        }
        SequenceAction::Alter { increment, min_value, max_value, cycle } => {
            let mut s = format!("ALTER SEQUENCE {}", q);
            if let Some(v) = increment { s.push_str(&format!("\n  INCREMENT BY {}", v)); }
            if let Some(v) = min_value { s.push_str(&format!("\n  MINVALUE {}", v)); }
            if let Some(v) = max_value { s.push_str(&format!("\n  MAXVALUE {}", v)); }
            if let Some(c) = cycle { s.push_str(if *c { "\n  CYCLE" } else { "\n  NO CYCLE" }); }
            s
        }
        SequenceAction::Restart { with } => match with {
            Some(v) => format!("ALTER SEQUENCE {} RESTART WITH {}", q, v),
            None => format!("ALTER SEQUENCE {} RESTART", q),
        },
        SequenceAction::Drop => format!("DROP SEQUENCE {}", q),
    }])
}

/// Escape an enum label as a single-quoted SQL literal (empty rejected).
pub fn validate_enum_label(label: &str) -> Result<String, String> {
    let t = label.trim();
    if t.is_empty() {
        return Err("Enum label must not be empty".into());
    }
    Ok(format!("'{}'", t.replace('\'', "''")))
}

#[derive(Deserialize)]
pub struct EnumParams {
    pub schema: String,
    pub name: String,
    pub action: EnumAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EnumAction {
    Create { labels: Vec<String> },
    RenameType { new_name: String },
    AddValue { value: String, if_not_exists: bool, before: Option<String>, after: Option<String> },
    RenameValue { from: String, to: String },
    Drop,
}

pub fn enum_ddl(p: &EnumParams) -> Result<Vec<String>, String> {
    let q = qual(&p.schema, &p.name)?;
    Ok(vec![match &p.action {
        EnumAction::Create { labels } => {
            let mut out = String::new();
            for l in labels {
                if !out.is_empty() { out.push_str(", "); }
                out.push_str(&validate_enum_label(l)?);
            }
            format!("CREATE TYPE {} AS ENUM ({})", q, out)
        }
        EnumAction::RenameType { new_name } => {
            validate_object_name(new_name)?;
            format!("ALTER TYPE {} RENAME TO {}", q, quote_ident(new_name))
        }
        EnumAction::AddValue { value, if_not_exists, before, after } => {
            let v = format!(" {}", validate_enum_label(value)?);
            let ine = if *if_not_exists { " IF NOT EXISTS" } else { "" };
            let pos = match (before, after) {
                (Some(b), None) => format!(" BEFORE {}", validate_enum_label(b)?),
                (None, Some(a)) => format!(" AFTER {}", validate_enum_label(a)?),
                _ => String::new(),
            };
            format!("ALTER TYPE {} ADD VALUE{}{}{}", q, ine, v, pos)
        }
        EnumAction::RenameValue { from, to } => {
            format!("ALTER TYPE {} RENAME VALUE {} TO {}", q, validate_enum_label(from)?, validate_enum_label(to)?)
        }
        EnumAction::Drop => format!("DROP TYPE {}", q),
    }])
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
pub fn build_ddl(kind: &str, params: serde_json::Value) -> Result<Vec<String>, String> {
    match kind {
        "sequence" => {
            let p: SequenceParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            sequence_ddl(&p)
        }
        "enum" => {
            let p: EnumParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            enum_ddl(&p)
        }
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

    #[test]
    fn sequence_create_full() {
        let p = serde_json::json!({
            "schema": "public", "name": "users_id_seq",
            "action": { "op": "create", "increment": "1", "min_value": "1", "max_value": "9223372036854775807", "start": "1", "cycle": false }
        });
        let sql = build_ddl("sequence", p).unwrap();
        assert_eq!(sql, vec!["CREATE SEQUENCE \"public\".\"users_id_seq\"\n  INCREMENT BY 1\n  MINVALUE 1\n  MAXVALUE 9223372036854775807\n  START WITH 1\n  NO CYCLE"]);
    }

    #[test]
    fn sequence_alter_partial_and_cycle_option() {
        let p = serde_json::json!({
            "schema": "public", "name": "s",
            "action": { "op": "alter", "increment": "2", "cycle": true }
        });
        let sql = build_ddl("sequence", p).unwrap();
        assert_eq!(sql, vec!["ALTER SEQUENCE \"public\".\"s\"\n  INCREMENT BY 2\n  CYCLE"]);
    }

    #[test]
    fn sequence_restart_with_value() {
        let p = serde_json::json!({ "schema": "public", "name": "s", "action": { "op": "restart", "with": "100" } });
        assert_eq!(build_ddl("sequence", p).unwrap(), vec!["ALTER SEQUENCE \"public\".\"s\" RESTART WITH 100"]);
    }

    #[test]
    fn sequence_drop() {
        let p = serde_json::json!({ "schema": "public", "name": "s", "action": { "op": "drop" } });
        assert_eq!(build_ddl("sequence", p).unwrap(), vec!["DROP SEQUENCE \"public\".\"s\""]);
    }

    #[test]
    fn sequence_rejects_bad_name() {
        let p = serde_json::json!({ "schema": "public", "name": "a; DROP", "action": { "op": "drop" } });
        assert!(build_ddl("sequence", p).is_err());
    }

    #[test]
    fn enum_create_quotes_labels() {
        let p = serde_json::json!({ "schema": "public", "name": "role", "action": { "op": "create", "labels": ["admin", "user's"] } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["CREATE TYPE \"public\".\"role\" AS ENUM ('admin', 'user''s')"]);
    }

    #[test]
    fn enum_rename_type() {
        let p = serde_json::json!({ "schema": "public", "name": "role", "action": { "op": "rename_type", "new_name": "user_role" } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["ALTER TYPE \"public\".\"role\" RENAME TO \"user_role\""]);
    }

    #[test]
    fn enum_add_value_with_position() {
        let p = serde_json::json!({ "schema": "public", "name": "color", "action": { "op": "add_value", "value": "orange", "if_not_exists": true, "before": "red", "after": null } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["ALTER TYPE \"public\".\"color\" ADD VALUE IF NOT EXISTS 'orange' BEFORE 'red'"]);
    }

    #[test]
    fn enum_add_value_plain() {
        let p = serde_json::json!({ "schema": "public", "name": "color", "action": { "op": "add_value", "value": "green", "if_not_exists": false, "before": null, "after": null } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["ALTER TYPE \"public\".\"color\" ADD VALUE 'green'"]);
    }

    #[test]
    fn enum_rename_value() {
        let p = serde_json::json!({ "schema": "public", "name": "color", "action": { "op": "rename_value", "from": "purple", "to": "mauve" } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["ALTER TYPE \"public\".\"color\" RENAME VALUE 'purple' TO 'mauve'"]);
    }

    #[test]
    fn enum_drop() {
        let p = serde_json::json!({ "schema": "public", "name": "role", "action": { "op": "drop" } });
        assert_eq!(build_ddl("enum", p).unwrap(), vec!["DROP TYPE \"public\".\"role\""]);
    }

    #[test]
    fn enum_add_value_rejects_empty_label() {
        let p = serde_json::json!({ "schema": "public", "name": "color", "action": { "op": "add_value", "value": "", "if_not_exists": false, "before": null, "after": null } });
        assert!(build_ddl("enum", p).is_err());
    }
}