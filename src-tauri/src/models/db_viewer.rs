use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub page: i64,
    pub page_size: i64,
    pub total_rows: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
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
        assert!(json.contains(r#""type":"Update""#));
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
}