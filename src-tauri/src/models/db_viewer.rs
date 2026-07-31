use serde::{Deserialize, Serialize};

/// A single filter rule sent from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterRule {
    pub id: String,
    pub column: String,
    pub operator: String,  // "eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt" | "null" | "notnull"
    pub value: String,
}

/// A single sort rule sent from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortRule {
    pub id: String,
    pub column: String,
    pub order: String,  // "asc" | "desc"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_pk: bool,
    pub is_fk: bool,
    pub fk_ref: Option<(String, String)>,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: i64,
    pub page: i64,
    pub page_size: i64,
    pub execution_time_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub page: i64,
    pub page_size: i64,
    pub total_rows: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub schema: String,
    pub return_type: String,
    pub argument_types: Vec<String>,
    pub argument_names: Vec<String>,
    pub argument_modes: Vec<String>,
    pub language: String,
    pub source: Option<String>,
    pub kind: String, // 'f' = function, 'p' = procedure
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub schema: String,
    pub table_schema: String,
    pub table_name: String,
    pub event_manipulation: String,
    pub action_timing: String,
    pub action_orientation: String,
    pub action_statement: String,
    pub enabled: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceInfo {
    pub name: String,
    pub schema: String,
    pub start_value: String,
    pub min_value: String,
    pub max_value: String,
    pub increment: String,
    pub current_value: String,
    pub cycle: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumInfo {
    pub name: String,
    pub schema: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInfo {
    pub name: String,
    pub schema: String,
    pub version: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Change {
    Update {
        id: String,
        schema: String,
        table: String,
        primary_key: String,
        old_data: String,
        new_data: String,
    },
    Insert {
        id: String,
        schema: String,
        table: String,
        data: String,
    },
    Delete {
        id: String,
        schema: String,
        table: String,
        primary_key: String,
    },
    AlterTable {
        id: String,
        schema: String,
        table: String,
        sql: String,
        rollback_sql: String,
    },
}

impl Change {
    pub fn id(&self) -> &str {
        match self {
            Change::Update { id, .. }
            | Change::Insert { id, .. }
            | Change::Delete { id, .. }
            | Change::AlterTable { id, .. } => id,
        }
    }
}

/// Complete schema graph for the ER diagram visualizer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaGraph {
    pub tables: Vec<TableNode>,
    pub relationships: Vec<Relationship>,
}

/// A table node in the schema graph, including all columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableNode {
    pub name: String,
    pub schema: String,
    pub table_type: String,
    pub columns: Vec<GraphColumn>,
}

/// Column metadata for schema graph visualization.
///
/// Includes PK/FK/UNIQUE flags and an optional foreign-key reference
/// (referenced_schema, referenced_table, referenced_column).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphColumn {
    pub name: String,
    pub data_type: String,
    pub is_pk: bool,
    pub is_fk: bool,
    pub is_unique: bool,
    pub is_nullable: bool,
    pub fk_ref: Option<(String, String, String)>,
}

/// A foreign-key relationship between two tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relationship {
    pub source_schema: String,
    pub source_table: String,
    pub source_column: String,
    pub target_schema: String,
    pub target_table: String,
    pub target_column: String,
    /// Inferred cardinality: "1:1", "1:N", or "N:M"
    pub cardinality: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_info_serialization() {
        let info = TableInfo {
            name: "users".to_string(),
            schema: "public".to_string(),
            table_type: "TABLE".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("users"));
        assert!(json.contains("public"));
        assert!(json.contains("TABLE"));
    }

    #[test]
    fn query_result_can_be_empty() {
        let result = QueryResult {
            columns: vec![],
            rows: vec![],
            total_rows: 0,
            page: 1,
            page_size: 100,
            execution_time_ms: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains(r#""rows":[]"#));
    }

    #[test]
    fn change_id_method() {
        let update = Change::Update {
            id: "chg-1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            primary_key: "{\"id\": 1}".to_string(),
            old_data: "{\"name\": \"old\"}".to_string(),
            new_data: "{\"name\": \"new\"}".to_string(),
        };
        assert_eq!(update.id(), "chg-1");

        let inserted = Change::Insert {
            id: "chg-2".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            data: "{\"name\": \"alice\"}".to_string(),
        };
        assert_eq!(inserted.id(), "chg-2");

        let deleted = Change::Delete {
            id: "chg-3".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            primary_key: "{\"id\": 2}".to_string(),
        };
        assert_eq!(deleted.id(), "chg-3");

        let alter = Change::AlterTable {
            id: "chg-4".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            sql: "ALTER TABLE users ADD COLUMN age INT".to_string(),
            rollback_sql: "ALTER TABLE users DROP COLUMN age".to_string(),
        };
        assert_eq!(alter.id(), "chg-4");
    }

    #[test]
    fn change_serde_tag() {
        let update = Change::Update {
            id: "chg-1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            primary_key: "{\"id\": 1}".to_string(),
            old_data: "{\"name\": \"old\"}".to_string(),
            new_data: "{\"name\": \"new\"}".to_string(),
        };
        let json = serde_json::to_string(&update).unwrap();
        assert!(
            json.contains(r#""type":"update""#),
            "serialized Change::Update should use snake_case tag 'update'; got: {}",
            json
        );
    }

    #[test]
    fn column_info_fk_ref() {
        let col = ColumnInfo {
            name: "user_id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: true,
            is_pk: false,
            is_fk: true,
            fk_ref: Some(("users".to_string(), "id".to_string())),
            default_value: None,
        };
        let json = serde_json::to_string(&col).unwrap();
        assert!(json.contains("user_id"));
        assert!(json.contains("users"));
    }

    #[test]
    fn pagination_serialization() {
        let pagination = Pagination {
            page: 2,
            page_size: 50,
            total_rows: 250,
        };
        let json = serde_json::to_string(&pagination).unwrap();
        assert!(json.contains(r#""page":2"#));
        assert!(json.contains(r#""page_size":50"#));
        assert!(json.contains(r#""total_rows":250"#));
    }

    #[test]
    fn function_info_serialization() {
        let info = FunctionInfo {
            name: "get_user".into(),
            schema: "public".into(),
            return_type: "TABLE(id integer, name text)".into(),
            argument_types: vec!["integer".into()],
            argument_names: vec!["p_id".into()],
            argument_modes: vec!["IN".into()],
            language: "plpgsql".into(),
            source: Some("BEGIN RETURN; END;".into()),
            kind: "f".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("get_user"));
        assert!(json.contains("plpgsql"));
    }

    #[test]
    fn trigger_info_serialization() {
        let info = TriggerInfo {
            name: "trg_audit".into(),
            schema: "public".into(),
            table_schema: "public".into(),
            table_name: "users".into(),
            event_manipulation: "INSERT".into(),
            action_timing: "AFTER".into(),
            action_orientation: "ROW".into(),
            action_statement: "EXECUTE FUNCTION audit_log()".into(),
            enabled: "O".into(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("trg_audit"));
    }

    #[test]
    fn sequence_info_serialization() {
        let info = SequenceInfo {
            name: "users_id_seq".into(),
            schema: "public".into(),
            start_value: "1".into(),
            min_value: "1".into(),
            max_value: "9223372036854775807".into(),
            increment: "1".into(),
            current_value: "42".into(),
            cycle: false,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("users_id_seq"));
    }

    #[test]
    fn enum_info_serialization() {
        let info = EnumInfo {
            name: "user_role".into(),
            schema: "public".into(),
            labels: vec!["admin".into(), "editor".into(), "viewer".into()],
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("admin"));
    }

    #[test]
    fn extension_info_serialization() {
        let info = ExtensionInfo {
            name: "pg_stat_statements".into(),
            schema: "public".into(),
            version: "1.10".into(),
            comment: Some("track SQL statistics".into()),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("pg_stat_statements"));
    }

    #[test]
    fn schema_graph_serialization() {
        let graph = SchemaGraph {
            tables: vec![TableNode {
                name: "users".into(),
                schema: "public".into(),
                table_type: "TABLE".into(),
                columns: vec![
                    GraphColumn {
                        name: "id".into(),
                        data_type: "integer".into(),
                        is_pk: true,
                        is_fk: false,
                        is_unique: true,
                        is_nullable: false,
                        fk_ref: None,
                    },
                    GraphColumn {
                        name: "email".into(),
                        data_type: "text".into(),
                        is_pk: false,
                        is_fk: false,
                        is_unique: true,
                        is_nullable: false,
                        fk_ref: None,
                    },
                ],
            }],
            relationships: vec![Relationship {
                source_schema: "public".into(),
                source_table: "orders".into(),
                source_column: "user_id".into(),
                target_schema: "public".into(),
                target_table: "users".into(),
                target_column: "id".into(),
                cardinality: "1:N".into(),
            }],
        };

        let json = serde_json::to_string(&graph).unwrap();
        assert!(json.contains("users"), "should contain table name");
        assert!(json.contains("orders"), "should contain relationship source table");
        assert!(json.contains("1:N"), "should contain cardinality");
        assert!(json.contains("is_pk"), "should contain is_pk field");
        assert!(json.contains("is_fk"), "should contain is_fk field");
        assert!(json.contains("is_unique"), "should contain is_unique field");

        // Round-trip deserialization
        let parsed: SchemaGraph = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.tables.len(), 1);
        assert_eq!(parsed.tables[0].columns.len(), 2);
        assert_eq!(parsed.relationships.len(), 1);
        assert_eq!(parsed.relationships[0].cardinality, "1:N");
    }

    #[test]
    fn schema_graph_empty_is_valid() {
        let graph = SchemaGraph {
            tables: vec![],
            relationships: vec![],
        };
        let json = serde_json::to_string(&graph).unwrap();
        let parsed: SchemaGraph = serde_json::from_str(&json).unwrap();
        assert!(parsed.tables.is_empty());
        assert!(parsed.relationships.is_empty());
    }

    #[test]
    fn graph_column_fk_ref_serialization() {
        // fk_ref = None
        let col_none = GraphColumn {
            name: "name".into(),
            data_type: "text".into(),
            is_pk: false,
            is_fk: false,
            is_unique: false,
            is_nullable: false,
            fk_ref: None,
        };
        let json = serde_json::to_string(&col_none).unwrap();
        assert!(json.contains("null"), "fk_ref=None should serialize as null");

        // fk_ref = Some(...)
        let col_some = GraphColumn {
            name: "user_id".into(),
            data_type: "integer".into(),
            is_pk: false,
            is_fk: true,
            is_unique: false,
            is_nullable: false,
            fk_ref: Some(("public".into(), "users".into(), "id".into())),
        };
        let json = serde_json::to_string(&col_some).unwrap();
        assert!(json.contains("public"), "should contain referenced schema");
        assert!(json.contains("users"), "should contain referenced table");
        assert!(json.contains("id"), "should contain referenced column");
    }
}