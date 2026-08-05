use serde::{Deserialize, Serialize};

/// A single filter rule sent from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterRule {
    pub id: String,
    pub column: String,
    pub operator: String, // "eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt" | "null" | "notnull"
    pub value: String,
}

/// A single sort rule sent from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortRule {
    pub id: String,
    pub column: String,
    pub order: String, // "asc" | "desc"
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
    pub editable: bool,
    pub is_generated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub definition: String,
    pub is_unique: bool,
    pub method: String,
    pub columns: Vec<String>,
    pub size_bytes: Option<i64>,
    pub tablespace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub contype: String, // "CHECK" | "UNIQUE" | "EXCLUSION"
    pub definition: String,
    pub deferrable: bool,
    pub validated: bool,
    pub columns: Vec<String>,
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
pub struct ObjectSearchHit {
    pub name: String,
    pub schema: String,
    pub object_type: String, // TABLE | VIEW | MATERIALIZED VIEW | FUNCTION | PROCEDURE | TRIGGER | SEQUENCE | ENUM | EXTENSION | INDEX | CONSTRAINT
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyInfo {
    pub deptype: String, // "n" (normal) | "a" (auto)
    pub class: String,   // pg_class | pg_proc | pg_trigger | pg_type | pg_constraint | pg_rewrite
    pub name: String,    // resolved dependent object name
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
    BulkInsert {
        id: String,
        schema: String,
        table: String,
        columns: Vec<String>,
        rows: Vec<Vec<serde_json::Value>>,
    },
    DropTable {
        id: String,
        schema: String,
        table: String,
    },
    EmptyTable {
        id: String,
        schema: String,
        table: String,
    },
}

impl Change {
    pub fn id(&self) -> &str {
        match self {
            Change::Update { id, .. }
            | Change::Insert { id, .. }
            | Change::Delete { id, .. }
            | Change::AlterTable { id, .. }
            | Change::BulkInsert { id, .. }
            | Change::DropTable { id, .. }
            | Change::EmptyTable { id, .. } => id,
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
    fn change_bulk_insert_roundtrip() {
        let json = serde_json::json!({
            "type": "bulk_insert", "id": "x", "schema": "public", "table": "t",
            "columns": ["a", "b"],
            "rows": [[1, "y"], [2, "z"]]
        });
        let c: Change = serde_json::from_value(json).unwrap();
        match c {
            Change::BulkInsert { columns, rows, .. } => {
                assert_eq!(columns, vec!["a".to_string(), "b".to_string()]);
                assert_eq!(rows.len(), 2);
            }
            _ => panic!("expected BulkInsert"),
        }
    }

    #[test]
    fn change_drop_and_empty_roundtrip() {
        let drop: Change = serde_json::from_value(serde_json::json!({
            "type": "drop_table", "id": "d", "schema": "public", "table": "t"
        }))
        .unwrap();
        assert_eq!(drop.id(), "d");
        let empty: Change = serde_json::from_value(serde_json::json!({
            "type": "empty_table", "id": "e", "schema": "public", "table": "t"
        }))
        .unwrap();
        assert_eq!(empty.id(), "e");
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
            editable: true,
            is_generated: false,
        };
        let json = serde_json::to_string(&col).unwrap();
        assert!(json.contains("user_id"));
        assert!(json.contains("users"));
    }

    #[test]
    fn column_info_has_editability_fields() {
        let c = ColumnInfo {
            name: "id".into(),
            data_type: "integer".into(),
            is_nullable: false,
            is_pk: true,
            is_fk: false,
            fk_ref: None,
            default_value: None,
            editable: false,
            is_generated: false,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"editable\":false"));
        assert!(json.contains("\"is_generated\":false"));
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
        assert!(
            json.contains("orders"),
            "should contain relationship source table"
        );
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
        assert!(
            json.contains("null"),
            "fk_ref=None should serialize as null"
        );

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

    #[test]
    fn object_search_hit_tagged_roundtrip() {
        let hit = ObjectSearchHit { name: "users".into(), schema: "public".into(), object_type: "TABLE".into() };
        let json = serde_json::to_string(&hit).unwrap();
        assert!(json.contains("\"object_type\":\"TABLE\""));
        let back: ObjectSearchHit = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "users");
    }

    #[test]
    fn dependency_info_roundtrip() {
        let d = DependencyInfo { deptype: "n".into(), class: "pg_class".into(), name: "v_users".into() };
        let json = serde_json::to_string(&d).unwrap();
        assert!(json.contains("\"deptype\":\"n\""));
        assert!(json.contains("v_users"));
    }
}
