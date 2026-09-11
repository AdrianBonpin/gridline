//! Pure MySQL SQL builders for the DB viewer. Identifiers are backtick-quoted
//! (never string-concatenated); values are bound via `?` placeholders at the
//! call site. Mirrors the PG builders in `commands/db_viewer.rs` but with
//! MySQL quoting and `LIMIT 1` on single-row UPDATE/DELETE.
use crate::models::db_viewer::{FilterRule, SortRule};
use sqlx::Row;

/// `SHOW DATABASES` — the browsing branches filter system DBs client-side
/// (see [`MYSQL_SYSTEM_DBS`]).
pub fn mysql_databases_query() -> String {
    "SHOW DATABASES".to_string()
}

/// System databases hidden from the DB viewer's database/schema selector.
pub const MYSQL_SYSTEM_DBS: [&str; 4] = ["information_schema", "mysql", "performance_schema", "sys"];

/// Quote a MySQL identifier with backticks, doubling any embedded backticks.
pub fn mysql_quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// Decode a MySQL row cell as a String. `information_schema` / `SHOW`
/// metadata columns can surface as VARBINARY (bytes) depending on the
/// connection charset, so fall back from String to a UTF-8 lossy decode.
pub fn mysql_row_string(row: &sqlx::mysql::MySqlRow, i: usize) -> String {
    if let Ok(s) = row.try_get::<String, _>(i) {
        return s;
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(i) {
        return String::from_utf8_lossy(&b).into_owned();
    }
    String::new()
}

/// information_schema.columns query for a table — returns column metadata in
/// the column order the grid expects (name, data_type, is_nullable, column_key,
/// default, extra). Caller maps these into `ColumnInfo`.
pub fn mysql_columns_query(schema: &str, table: &str) -> String {
    format!(
        "SELECT column_name, data_type, is_nullable, column_key, column_default, extra \
         FROM information_schema.columns \
         WHERE table_schema = '{}' AND table_name = '{}' \
         ORDER BY ordinal_position",
        schema.replace('\'', "''"),
        table.replace('\'', "''")
    )
}

/// Build a `SELECT ... FROM \`schema\`.\`table\` [WHERE ...] [ORDER BY ...] LIMIT ? OFFSET ?`.
/// `filters` produce `?` placeholders (values bound by the caller); `sorts`
/// are quoted identifiers. `default_sort` is used when `sorts` is empty.
pub fn mysql_select_data_query(
    schema: &str,
    table: &str,
    filters: &[FilterRule],
    sorts: &[SortRule],
    default_sort: &str,
) -> String {
    let mut where_parts: Vec<String> = Vec::new();
    for f in filters {
        let col = mysql_quote_ident(&f.column);
        let op = match f.operator.as_str() {
            "eq" => format!("{} = ?", col),
            "neq" => format!("{} <> ?", col),
            "contains" => format!("{} LIKE CONCAT('%', ?, '%')", col),
            "starts" => format!("{} LIKE CONCAT(?, '%')", col),
            "ends" => format!("{} LIKE CONCAT('%', ?)", col),
            "gt" => format!("{} > ?", col),
            "lt" => format!("{} < ?", col),
            "null" => format!("{} IS NULL", col),
            "notnull" => format!("{} IS NOT NULL", col),
            _ => format!("{} = ?", col),
        };
        where_parts.push(op);
    }
    let where_clause = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };

    let order_cols: Vec<String> = sorts
        .iter()
        .map(|s| format!("{} {}", mysql_quote_ident(&s.column), if s.order.eq_ignore_ascii_case("desc") { "DESC" } else { "ASC" }))
        .collect();
    let order_clause = if order_cols.is_empty() {
        if default_sort.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {}", mysql_quote_ident(default_sort))
        }
    } else {
        format!(" ORDER BY {}", order_cols.join(", "))
    };

    format!(
        "SELECT * FROM {}{}{} LIMIT ? OFFSET ?",
        qualified(schema, table),
        where_clause,
        order_clause
    )
}

pub fn mysql_count_query(schema: &str, table: &str) -> String {
    format!("SELECT COUNT(*) FROM {}", qualified(schema, table))
}

pub fn mysql_ddl_query(schema: &str, table: &str) -> String {
    format!("SHOW CREATE TABLE {}", qualified(schema, table))
}

/// Foreign-key columns for a table (referenced table/column).
pub fn mysql_fk_query(schema: &str, table: &str) -> String {
    format!(
        "SELECT column_name, referenced_table_schema, referenced_table_name, referenced_column_name \
         FROM information_schema.key_column_usage \
         WHERE table_schema = '{}' AND table_name = '{}' AND referenced_table_name IS NOT NULL",
        schema.replace('\'', "''"),
        table.replace('\'', "''")
    )
}

/// Choose a default sort column: prefer an `id`-like column, else the first.
pub fn mysql_default_sort(columns: &[String]) -> &str {
    columns.iter().find(|c| c.as_str() == "id").map(|s| s.as_str()).unwrap_or_else(|| {
        columns.first().map(|s| s.as_str()).unwrap_or("")
    })
}

// ── Change-SQL builders ──────────────────────────────────────────────
pub fn mysql_build_update_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
    new_data: &[(String, serde_json::Value)],
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot update a row without a primary key (MySQL has no ctid)".to_string());
    }
    let mut params: Vec<serde_json::Value> = Vec::new();
    let set_clause: Vec<String> = new_data
        .iter()
        .map(|(col, val)| { params.push(val.clone()); format!("{} = ?", mysql_quote_ident(col)) })
        .collect();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, val)| { params.push(val.clone()); format!("{} = ?", mysql_quote_ident(col)) })
        .collect();
    Ok((
        format!(
            "UPDATE {} SET {} WHERE {} LIMIT 1",
            qualified(schema, table),
            set_clause.join(", "),
            where_clause.join(" AND ")
        ),
        params,
    ))
}

pub fn mysql_build_delete_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot delete a row without a primary key (MySQL has no ctid)".to_string());
    }
    let mut params: Vec<serde_json::Value> = Vec::new();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, val)| { params.push(val.clone()); format!("{} = ?", mysql_quote_ident(col)) })
        .collect();
    Ok((
        format!("DELETE FROM {} WHERE {} LIMIT 1", qualified(schema, table), where_clause.join(" AND ")),
        params,
    ))
}

pub fn mysql_build_insert_sql(
    schema: &str,
    table: &str,
    pairs: &[(String, serde_json::Value)],
) -> (String, Vec<serde_json::Value>) {
    let cols: Vec<String> = pairs.iter().map(|(c, _)| mysql_quote_ident(c)).collect();
    let placeholders: Vec<&str> = pairs.iter().map(|_| "?").collect();
    let params: Vec<serde_json::Value> = pairs.iter().map(|(_, v)| v.clone()).collect();
    (
        format!(
            "INSERT INTO {} ({}) VALUES ({})",
            qualified(schema, table),
            cols.join(", "),
            placeholders.join(", ")
        ),
        params,
    )
}

pub fn mysql_build_bulk_insert_sql(schema: &str, table: &str, columns: &[String], row_count: usize) -> String {
    let cols: Vec<String> = columns.iter().map(|c| mysql_quote_ident(c)).collect();
    let one_row = format!("({})", columns.iter().map(|_| "?").collect::<Vec<_>>().join(", "));
    let rows = vec![one_row; row_count].join(", ");
    format!("INSERT INTO {} ({}) VALUES {}", qualified(schema, table), cols.join(", "), rows)
}

pub fn mysql_build_drop_sql(schema: &str, table: &str) -> String {
    format!("DROP TABLE {}", qualified(schema, table))
}

pub fn mysql_build_empty_sql(schema: &str, table: &str) -> String {
    format!("DELETE FROM {}", qualified(schema, table))
}

fn qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", mysql_quote_ident(schema), mysql_quote_ident(table))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::db_viewer::FilterRule;

    #[test]
    fn quote_ident_backticks_and_escapes_embedded_backticks() {
        assert_eq!(mysql_quote_ident("name"), "`name`");
        assert_eq!(mysql_quote_ident("o`d`d"), "`o``d``d`");
        assert_eq!(mysql_quote_ident("select"), "`select`");
    }

    #[test]
    fn columns_query_targets_information_schema() {
        let q = mysql_columns_query("shop", "orders");
        assert!(q.contains("FROM information_schema.columns"));
        assert!(q.contains("table_schema = 'shop'"));
        assert!(q.contains("table_name = 'orders'"));
        assert!(q.contains("ORDER BY ordinal_position"));
    }

    #[test]
    fn select_data_quotes_schema_table_and_applies_limit_offset() {
        let q = mysql_select_data_query("shop", "orders", &[], &[], "id");
        assert!(q.contains("SELECT * FROM `shop`.`orders`"));
        assert!(q.contains("ORDER BY `id`"));
        assert!(q.contains("LIMIT ? OFFSET ?"));
    }

    #[test]
    fn select_data_adds_where_for_filters_with_question_placeholders() {
        let filters = vec![FilterRule { id: "f1".into(), column: "status".into(), operator: "eq".into(), value: "paid".into() }];
        let q = mysql_select_data_query("shop", "orders", &filters, &[], "id");
        assert!(q.contains("WHERE `status` = ?"));
        assert!(q.contains("LIMIT ? OFFSET ?"));
    }

    #[test]
    fn count_query_uses_quoted_table() {
        let q = mysql_count_query("shop", "orders");
        assert_eq!(q, "SELECT COUNT(*) FROM `shop`.`orders`");
    }

    #[test]
    fn ddl_query_uses_show_create_table() {
        let q = mysql_ddl_query("shop", "orders");
        assert_eq!(q, "SHOW CREATE TABLE `shop`.`orders`");
    }

    #[test]
    fn fk_query_targets_key_column_usage() {
        let q = mysql_fk_query("shop", "orders");
        assert!(q.contains("FROM information_schema.key_column_usage"));
        assert!(q.contains("referenced_table_name IS NOT NULL"));
    }

    #[test]
    fn build_update_uses_backticks_question_and_limit_one() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let data = vec![("status".to_string(), serde_json::json!("paid"))];
        let (sql, params) = mysql_build_update_sql("shop", "orders", &pk, &data).unwrap();
        assert_eq!(sql, "UPDATE `shop`.`orders` SET `status` = ? WHERE `id` = ? LIMIT 1");
        assert_eq!(params, vec![serde_json::json!("paid"), serde_json::json!(1)]);
    }

    #[test]
    fn build_update_rejects_empty_primary_key() {
        let r = mysql_build_update_sql("shop", "orders", &[], &[]);
        assert!(r.is_err());
    }

    #[test]
    fn build_delete_uses_backticks_question_and_limit_one() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let (sql, params) = mysql_build_delete_sql("shop", "orders", &pk).unwrap();
        assert_eq!(sql, "DELETE FROM `shop`.`orders` WHERE `id` = ? LIMIT 1");
        assert_eq!(params, vec![serde_json::json!(1)]);
    }

    #[test]
    fn build_insert_emits_columns_and_question_placeholders() {
        let pairs = vec![
            ("a".to_string(), serde_json::json!(1)),
            ("b".to_string(), serde_json::json!("x")),
        ];
        let (sql, params) = mysql_build_insert_sql("shop", "orders", &pairs);
        assert_eq!(sql, "INSERT INTO `shop`.`orders` (`a`, `b`) VALUES (?, ?)");
        assert_eq!(params, vec![serde_json::json!(1), serde_json::json!("x")]);
    }

    #[test]
    fn build_drop_and_empty_table_quoted() {
        assert_eq!(mysql_build_drop_sql("shop", "orders"), "DROP TABLE `shop`.`orders`");
        assert_eq!(mysql_build_empty_sql("shop", "orders"), "DELETE FROM `shop`.`orders`");
    }

    #[test]
    fn build_bulk_insert_columns_and_placeholders() {
        let cols = vec!["a".to_string(), "b".to_string()];
        let sql = mysql_build_bulk_insert_sql("shop", "orders", &cols, 2);
        assert_eq!(sql, "INSERT INTO `shop`.`orders` (`a`, `b`) VALUES (?, ?), (?, ?)");
    }

    #[test]
    fn default_sort_picks_id_then_first_column() {
        assert_eq!(mysql_default_sort(&["updated_at".into(), "id".into()]), "id");
        assert_eq!(mysql_default_sort(&["name".into()]), "name");
        assert_eq!(mysql_default_sort(&[]), "");
    }
}
// ── Schema-diff snapshot queries (0.8.0) ──────────────────────────────

/// Columns: table_name, column_name, column_type, is_nullable, column_default
pub fn mysql_snapshot_columns_query(schema: &str) -> String {
    format!(
        "SELECT table_name, column_name, column_type, is_nullable, \
         COALESCE(column_default, '') \
         FROM information_schema.columns \
         WHERE table_schema = '{}' \
         ORDER BY table_name, ordinal_position",
        schema.replace('\'', "''")
    )
}

/// Constraints (one row per constraint-column). Columns: table_name,
/// constraint_name, constraint_type, column_name, referenced_table_name,
/// delete_rule, update_rule, check_clause
pub fn mysql_snapshot_constraints_query(schema: &str) -> String {
    format!(
        "SELECT kcu.table_name, kcu.constraint_name, tc.constraint_type, kcu.column_name, \
         COALESCE(kcu.referenced_table_name, ''), \
         COALESCE(rc.delete_rule, ''), COALESCE(rc.update_rule, ''), \
         COALESCE((SELECT cc.check_clause FROM information_schema.check_constraints cc \
            WHERE cc.constraint_schema = kcu.constraint_schema \
              AND cc.constraint_name = kcu.constraint_name), '') \
         FROM information_schema.key_column_usage kcu \
         LEFT JOIN information_schema.table_constraints tc \
           ON tc.constraint_schema = kcu.constraint_schema \
          AND tc.constraint_name = kcu.constraint_name \
          AND tc.table_name = kcu.table_name \
         LEFT JOIN information_schema.referential_constraints rc \
           ON rc.constraint_schema = kcu.constraint_schema \
          AND rc.constraint_name = kcu.constraint_name \
         WHERE kcu.constraint_schema = '{}' AND tc.constraint_type IS NOT NULL \
         ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position",
        schema.replace('\'', "''")
    )
}

/// Secondary indexes (one row per index-column). Columns: table_name,
/// index_name, non_unique, column_name
pub fn mysql_snapshot_indexes_query(schema: &str) -> String {
    format!(
        "SELECT table_name, index_name, non_unique, column_name \
         FROM information_schema.statistics \
         WHERE table_schema = '{}' AND index_name != 'PRIMARY' \
         ORDER BY table_name, index_name, seq_in_index",
        schema.replace('\'', "''")
    )
}

/// Views. Columns: table_schema, table_name, view_definition
pub fn mysql_snapshot_views_query(schema: &str) -> String {
    format!(
        "SELECT table_schema, table_name, view_definition \
         FROM information_schema.views \
         WHERE table_schema = '{}'",
        schema.replace('\'', "''")
    )
}
