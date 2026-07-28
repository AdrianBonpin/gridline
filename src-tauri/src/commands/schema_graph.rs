#[allow(unused_imports)]
use crate::models::db_viewer::{SchemaGraph, TableNode, GraphColumn, Relationship};
use tauri::State;

/// Validate a schema name for safe use in parameterized queries.
/// Rejects empty strings and names containing SQL metacharacters.
pub fn validate_schema_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Schema name cannot be empty".into());
    }
    if name.contains(';')
        || name.contains("--")
        || name.contains("/*")
        || name.contains('\'')
        || name.contains('"')
        || name.contains('\\')
    {
        return Err(format!("Invalid schema name: {}", name));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_schema_graph(
    _connection_id: String,
    schema: Option<String>,
    _state: State<'_, crate::AppState>,
) -> Result<SchemaGraph, String> {
    let schema = schema.unwrap_or_else(|| "public".to_string());
    validate_schema_name(&schema)?;

    // Placeholder: return empty graph for now
    Ok(SchemaGraph {
        tables: vec![],
        relationships: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_schema_name_rejects_empty() {
        assert!(validate_schema_name("").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_semicolon() {
        assert!(validate_schema_name("public; DROP TABLE users").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_sql_comment() {
        assert!(validate_schema_name("public--comment").is_err());
        assert!(validate_schema_name("public/*comment*/").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_quotes() {
        assert!(validate_schema_name("pub'lic").is_err());
        assert!(validate_schema_name("pub\"lic").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_backslash() {
        assert!(validate_schema_name("public\\schema").is_err());
    }

    #[test]
    fn validate_schema_name_accepts_valid_names() {
        assert!(validate_schema_name("public").is_ok());
        assert!(validate_schema_name("my_schema").is_ok());
        assert!(validate_schema_name("schema123").is_ok());
        assert!(validate_schema_name("auth").is_ok());
    }
}