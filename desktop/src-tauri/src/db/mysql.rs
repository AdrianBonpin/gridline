//! Pure MySQL SQL builders for the DB viewer. Identifiers are backtick-quoted
//! (never string-concatenated); values are bound via `?` placeholders at the
//! call site. Mirrors the PG builders in `commands/db_viewer.rs` but with MySQL
//! quoting. Single-row UPDATE/DELETE deliberately carry **no** `LIMIT 1`: a
//! limited statement silently succeeds when its locator matches more than one
//! row, so an ambiguous match must reach the caller (tests forbid the clause).
use crate::db::ident::{self, Engine};
use crate::models::db_viewer::{FilterRule, SortRule};
use sqlx::Row;

/// `SHOW DATABASES` — the browsing branches filter system DBs client-side
/// (see [`MYSQL_SYSTEM_DBS`]).
pub fn mysql_databases_query() -> String {
    "SHOW DATABASES".to_string()
}

/// System databases hidden from the DB viewer's database/schema selector.
pub const MYSQL_SYSTEM_DBS: [&str; 4] =
    ["information_schema", "mysql", "performance_schema", "sys"];

/// Quote a MySQL identifier with backticks, doubling any embedded backticks.
///
/// Delegates to the one shared quoting implementation (`db::ident`) so MySQL
/// names have exactly one tested implementation in this crate.
pub fn mysql_quote_ident(name: &str) -> String {
    ident::quote(Engine::MySql, name)
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

/// information_schema.columns query for one table — `?` holds the schema and
/// `?` the table (bound by the caller, in that order).
///
/// The names are **bound parameters**, not literals: MySQL string literals
/// interpret backslash escapes, so a legal name containing `'` or `\` cannot be
/// spliced in without risking a different (or broken) filter.
/// Returns column metadata in the order the grid expects (name, data_type,
/// is_nullable, column_key, default, extra). Caller maps these into
/// `ColumnInfo`.
pub fn mysql_columns_query() -> String {
    "SELECT column_name, data_type, is_nullable, column_key, column_default, extra \
     FROM information_schema.columns \
     WHERE table_schema = ? AND table_name = ? \
     ORDER BY ordinal_position"
        .to_string()
}

/// Build a `SELECT ... FROM \`schema\`.\`table\` [WHERE ...] [ORDER BY ...] LIMIT ? OFFSET ?`.
/// `filters` produce `?` placeholders (values bound by the caller); `sorts`
/// are quoted identifiers. `default_sort` is used when `sorts` is empty.
///
/// Fails closed: a column that cannot be represented, an operator this builder
/// does not implement, or an unknown sort direction is an error naming the
/// offending rule. Dropping such a rule would return unfiltered or unsorted
/// rows to a grid whose filter controls look active.
pub fn mysql_select_data_query(
    schema: &str,
    table: &str,
    filters: &[FilterRule],
    sorts: &[SortRule],
    default_sort: &str,
) -> Result<String, String> {
    ident::validate(schema)
        .map_err(|e| format!("MySQL: schema {schema:?} cannot be represented: {e}"))?;
    ident::validate(table)
        .map_err(|e| format!("MySQL: table {table:?} cannot be represented: {e}"))?;

    let where_clause = mysql_filter_clause(filters)?;

    let mut order_cols: Vec<String> = Vec::new();
    for s in sorts {
        let col = ident::quote_checked(Engine::MySql, &s.column)
            .map_err(|e| format!("cannot apply sort on column {:?}: {e}", s.column))?;
        let dir = if s.order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else if s.order.eq_ignore_ascii_case("asc") {
            "ASC"
        } else {
            return Err(format!(
                "cannot apply sort on column {:?}: unsupported direction {:?}",
                s.column, s.order
            ));
        };
        order_cols.push(format!("{col} {dir}"));
    }
    let order_clause = if order_cols.is_empty() {
        if default_sort.is_empty() {
            String::new()
        } else {
            let col = ident::quote_checked(Engine::MySql, default_sort).map_err(|e| {
                format!("cannot apply default sort on column {default_sort:?}: {e}")
            })?;
            format!(" ORDER BY {col}")
        }
    } else {
        format!(" ORDER BY {}", order_cols.join(", "))
    };

    Ok(format!(
        "SELECT * FROM {}{}{} LIMIT ? OFFSET ?",
        qualified(schema, table),
        where_clause,
        order_clause
    ))
}

pub fn mysql_count_query(schema: &str, table: &str) -> String {
    format!("SELECT COUNT(*) FROM {}", qualified(schema, table))
}

/// The ` WHERE ...` clause a filter list contributes, or an empty string when
/// nothing is filtered.
///
/// One builder feeds every statement that has to agree about the filter — the
/// data page and its total count — so the two can never drift apart. Fails
/// closed on a rule the builder cannot represent (see
/// [`mysql_select_data_query`]).
pub fn mysql_filter_clause(filters: &[FilterRule]) -> Result<String, String> {
    let mut where_parts: Vec<String> = Vec::new();
    for f in filters {
        let col = ident::quote_checked(Engine::MySql, &f.column)
            .map_err(|e| format!("cannot apply filter on column {:?}: {e}", f.column))?;
        let op = match f.operator.as_str() {
            "eq" => format!("{col} = ?"),
            "neq" => format!("{col} <> ?"),
            "contains" => format!("{col} LIKE CONCAT('%', ?, '%')"),
            "starts" => format!("{col} LIKE CONCAT(?, '%')"),
            "ends" => format!("{col} LIKE CONCAT('%', ?)"),
            "gt" => format!("{col} > ?"),
            "lt" => format!("{col} < ?"),
            "null" => format!("{col} IS NULL"),
            "notnull" => format!("{col} IS NOT NULL"),
            other => {
                return Err(format!(
                    "cannot apply filter on column {:?}: unsupported operator {other:?}",
                    f.column
                ))
            }
        };
        where_parts.push(op);
    }
    Ok(if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    })
}

/// The values to bind for [`mysql_filter_clause`], in placeholder order.
///
/// `IS NULL` / `IS NOT NULL` carry no value, so they contribute no parameter.
pub fn mysql_filter_values(filters: &[FilterRule]) -> Vec<String> {
    filters
        .iter()
        .filter(|f| f.operator != "null" && f.operator != "notnull")
        .map(|f| f.value.clone())
        .collect()
}

/// `COUNT(*)` over exactly the rows a filtered data page selects.
///
/// A browse that reports the whole-table count under an active filter describes
/// rows the user cannot see (and paginates past the real end), so the count
/// carries the same [`mysql_filter_clause`] as the data query.
pub fn mysql_count_query_filtered(
    schema: &str,
    table: &str,
    filters: &[FilterRule],
) -> Result<String, String> {
    ident::validate(schema)
        .map_err(|e| format!("MySQL: schema {schema:?} cannot be represented: {e}"))?;
    ident::validate(table)
        .map_err(|e| format!("MySQL: table {table:?} cannot be represented: {e}"))?;
    Ok(format!(
        "SELECT COUNT(*) FROM {}{}",
        qualified(schema, table),
        mysql_filter_clause(filters)?
    ))
}

pub fn mysql_ddl_query(schema: &str, table: &str) -> String {
    format!("SHOW CREATE TABLE {}", qualified(schema, table))
}

/// Foreign-key columns for a table (referenced table/column). The schema and
/// table are bound (`?`), for the same reason as [`mysql_columns_query`].
pub fn mysql_fk_query() -> String {
    "SELECT column_name, referenced_table_schema, referenced_table_name, referenced_column_name \
     FROM information_schema.key_column_usage \
     WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL"
        .to_string()
}

/// Choose a default sort column: prefer an `id`-like column, else the first.
pub fn mysql_default_sort(columns: &[String]) -> &str {
    columns
        .iter()
        .find(|c| c.as_str() == "id")
        .map(|s| s.as_str())
        .unwrap_or_else(|| columns.first().map(|s| s.as_str()).unwrap_or(""))
}

// ── Change-SQL builders ──────────────────────────────────────────────
/// A single-row MySQL UPDATE.
///
/// The predicate is the complete Row Identity plus `guard` (the edited
/// column's original value), and there is deliberately no `LIMIT 1`: a limited
/// statement would silently cap an ambiguous match at one row instead of
/// letting the caller's transaction detect and roll it back
/// (see [`crate::db::row_write`]).
pub fn mysql_build_update_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
    new_data: &[(String, serde_json::Value)],
    guard: &[(String, serde_json::Value)],
) -> Result<(String, Vec<serde_json::Value>), String> {
    let stmt = crate::db::row_write::RowWrite {
        engine: Engine::MySql,
        schema,
        table,
        kind: crate::db::row_write::WriteKind::Update,
        identity: primary_key,
        new_data,
        guard: guard.to_vec(),
    }
    .statement()?;
    Ok((stmt.sql, stmt.params))
}

/// A single-row MySQL DELETE (no `LIMIT 1`, for the same reason as the update).
pub fn mysql_build_delete_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
    guard: &[(String, serde_json::Value)],
) -> Result<(String, Vec<serde_json::Value>), String> {
    let stmt = crate::db::row_write::RowWrite {
        engine: Engine::MySql,
        schema,
        table,
        kind: crate::db::row_write::WriteKind::Delete,
        identity: primary_key,
        new_data: &[],
        guard: guard.to_vec(),
    }
    .statement()?;
    Ok((stmt.sql, stmt.params))
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

pub fn mysql_build_bulk_insert_sql(
    schema: &str,
    table: &str,
    columns: &[String],
    row_count: usize,
) -> String {
    let cols: Vec<String> = columns.iter().map(|c| mysql_quote_ident(c)).collect();
    let one_row = format!(
        "({})",
        columns.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
    );
    let rows = vec![one_row; row_count].join(", ");
    format!(
        "INSERT INTO {} ({}) VALUES {}",
        qualified(schema, table),
        cols.join(", "),
        rows
    )
}

pub fn mysql_build_drop_sql(schema: &str, table: &str) -> String {
    format!("DROP TABLE {}", qualified(schema, table))
}

pub fn mysql_build_empty_sql(schema: &str, table: &str) -> String {
    format!("DELETE FROM {}", qualified(schema, table))
}

fn qualified(schema: &str, table: &str) -> String {
    ident::qualified_unchecked(Engine::MySql, schema, table)
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
        let q = mysql_columns_query();
        assert!(q.contains("FROM information_schema.columns"));
        // The schema/table are bound, never spliced in as literals: MySQL string
        // literals interpret backslash escapes, so a legal name containing `'`
        // or `\` cannot be embedded without risking a different filter.
        assert!(
            q.contains("table_schema = ? AND table_name = ?"),
            "got: {q}"
        );
        assert!(!q.contains('\''), "no name may be a literal: {q}");
        assert!(q.contains("ORDER BY ordinal_position"));
    }

    #[test]
    fn select_data_quotes_schema_table_and_applies_limit_offset() {
        let q = mysql_select_data_query("shop", "orders", &[], &[], "id").unwrap();
        assert!(q.contains("SELECT * FROM `shop`.`orders`"));
        assert!(q.contains("ORDER BY `id`"));
        assert!(q.contains("LIMIT ? OFFSET ?"));
    }

    #[test]
    fn select_data_adds_where_for_filters_with_question_placeholders() {
        let filters = vec![FilterRule {
            id: "f1".into(),
            column: "status".into(),
            operator: "eq".into(),
            value: "paid".into(),
        }];
        let q = mysql_select_data_query("shop", "orders", &filters, &[], "id").unwrap();
        assert!(q.contains("WHERE `status` = ?"));
        assert!(q.contains("LIMIT ? OFFSET ?"));
    }

    /// Legal-but-awkward column names are quoted, never skipped: skipping would
    /// return unfiltered rows under a filter that looks active.
    #[test]
    fn select_data_quotes_legal_but_awkward_column_names() {
        let filters = vec![
            FilterRule {
                id: "f1".into(),
                column: "we ird".into(),
                operator: "eq".into(),
                value: "x".into(),
            },
            FilterRule {
                id: "f2".into(),
                column: "o`brien".into(),
                operator: "contains".into(),
                value: "y".into(),
            },
            FilterRule {
                id: "f3".into(),
                column: "select".into(),
                operator: "gt".into(),
                value: "1".into(),
            },
            FilterRule {
                id: "f4".into(),
                column: "o'brien".into(),
                operator: "null".into(),
                value: String::new(),
            },
        ];
        let sorts = vec![SortRule {
            id: "s1".into(),
            column: "Mixed Case".into(),
            order: "desc".into(),
        }];
        let q = mysql_select_data_query("my schema", "we `ird\"tbl", &filters, &sorts, "id")
            .expect("legal names must be representable");
        assert!(q.contains("FROM `my schema`.`we ``ird\"tbl`"), "got: {q}");
        assert!(q.contains("`we ird` = ?"), "got: {q}");
        assert!(
            q.contains("`o``brien` LIKE CONCAT('%', ?, '%')"),
            "got: {q}"
        );
        assert!(q.contains("`select` > ?"), "got: {q}");
        assert!(q.contains("`o'brien` IS NULL"), "got: {q}");
        assert!(q.contains("ORDER BY `Mixed Case` DESC"), "got: {q}");
    }

    /// An unknown operator must fail rather than silently becoming `=` (which
    /// would filter on the wrong predicate) or being dropped (unfiltered rows).
    #[test]
    fn select_data_rejects_unknown_operator() {
        let filters = vec![FilterRule {
            id: "f1".into(),
            column: "status".into(),
            operator: "matches_regex".into(),
            value: "x".into(),
        }];
        let err = mysql_select_data_query("shop", "orders", &filters, &[], "id")
            .expect_err("unknown operator must fail");
        assert!(err.contains("matches_regex"), "got: {err}");
    }

    #[test]
    fn select_data_rejects_unrepresentable_column_and_direction() {
        let empty_column = vec![FilterRule {
            id: "f1".into(),
            column: String::new(),
            operator: "eq".into(),
            value: "x".into(),
        }];
        let err = mysql_select_data_query("shop", "orders", &empty_column, &[], "id")
            .expect_err("empty column must fail");
        assert!(err.contains("empty"), "got: {err}");

        let bad_sort = vec![SortRule {
            id: "s1".into(),
            column: "id".into(),
            order: "sideways".into(),
        }];
        let err = mysql_select_data_query("shop", "orders", &[], &bad_sort, "id")
            .expect_err("unknown direction must fail");
        assert!(err.contains("sideways"), "got: {err}");
    }

    #[test]
    fn count_query_uses_quoted_table() {
        let q = mysql_count_query("shop", "orders");
        assert_eq!(q, "SELECT COUNT(*) FROM `shop`.`orders`");
    }

    /// Ticket 09: the total a filtered browse reports must describe the
    /// *filtered* result. The count query has to carry the exact same WHERE
    /// clause (and therefore the same bound values, in the same order) as the
    /// data query it accompanies — otherwise the toolbar says "1-50 of 9000"
    /// while the grid holds three matching rows.
    #[test]
    fn filtered_count_query_matches_the_data_query_filters() {
        let filters = vec![
            FilterRule {
                id: "f1".into(),
                column: "status".into(),
                operator: "eq".into(),
                value: "paid".into(),
            },
            FilterRule {
                id: "f2".into(),
                column: "note".into(),
                operator: "contains".into(),
                value: "gift".into(),
            },
            FilterRule {
                id: "f3".into(),
                column: "shipped_at".into(),
                operator: "notnull".into(),
                value: String::new(),
            },
        ];
        let data = mysql_select_data_query("shop", "orders", &filters, &[], "id").unwrap();
        let count = mysql_count_query_filtered("shop", "orders", &filters).unwrap();

        let data_where = data
            .split(" WHERE ")
            .nth(1)
            .and_then(|s| s.split(" ORDER BY ").next())
            .expect("data query has a WHERE clause");
        assert!(
            count.contains(data_where),
            "count query must apply the data query's filters\n data: {data}\ncount: {count}"
        );
        assert!(
            count.starts_with("SELECT COUNT(*) FROM `shop`.`orders` WHERE "),
            "got: {count}"
        );
        // Only filters that bind a value contribute a parameter — `IS [NOT]
        // NULL` has no value to bind, in either query.
        assert_eq!(
            mysql_filter_values(&filters),
            vec!["paid".to_string(), "gift".to_string()],
            "bound values must follow the placeholder order"
        );
    }

    #[test]
    fn unfiltered_count_query_has_no_where_clause() {
        let q = mysql_count_query_filtered("shop", "orders", &[]).unwrap();
        assert_eq!(q, "SELECT COUNT(*) FROM `shop`.`orders`");
    }

    #[test]
    fn filtered_count_query_fails_closed_on_an_unrepresentable_filter() {
        let filters = vec![FilterRule {
            id: "f1".into(),
            column: String::new(),
            operator: "eq".into(),
            value: "x".into(),
        }];
        let err = mysql_count_query_filtered("shop", "orders", &filters)
            .expect_err("an unrepresentable filter must not silently count everything");
        assert!(err.contains("empty"), "got: {err}");
    }

    #[test]
    fn ddl_query_uses_show_create_table() {
        let q = mysql_ddl_query("shop", "orders");
        assert_eq!(q, "SHOW CREATE TABLE `shop`.`orders`");
    }

    #[test]
    fn fk_query_targets_key_column_usage() {
        let q = mysql_fk_query();
        assert!(q.contains("FROM information_schema.key_column_usage"));
        assert!(q.contains("referenced_table_name IS NOT NULL"));
        assert!(
            q.contains("table_schema = ? AND table_name = ?"),
            "got: {q}"
        );
        assert!(!q.contains("'shop'"), "schema must be bound: {q}");
    }

    #[test]
    fn build_update_uses_backticks_question_and_original_value_guard() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let data = vec![("status".to_string(), serde_json::json!("paid"))];
        let guard = vec![("status".to_string(), serde_json::json!("unpaid"))];
        let (sql, params) = mysql_build_update_sql("shop", "orders", &pk, &data, &guard).unwrap();
        // No `LIMIT 1`: the caller's transaction must see an ambiguous match.
        assert_eq!(
            sql,
            "UPDATE `shop`.`orders` SET `status` = ? WHERE `id` = ? AND `status` = ?"
        );
        assert_eq!(
            params,
            vec![
                serde_json::json!("paid"),
                serde_json::json!(1),
                serde_json::json!("unpaid")
            ]
        );
    }

    #[test]
    fn build_update_rejects_empty_primary_key() {
        let data = vec![("status".to_string(), serde_json::json!("paid"))];
        let r = mysql_build_update_sql("shop", "orders", &[], &data, &[]);
        assert!(r.is_err());
    }

    #[test]
    fn build_delete_uses_backticks_question_and_no_limit() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let (sql, params) = mysql_build_delete_sql("shop", "orders", &pk, &[]).unwrap();
        assert_eq!(sql, "DELETE FROM `shop`.`orders` WHERE `id` = ?");
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
        assert_eq!(
            mysql_build_drop_sql("shop", "orders"),
            "DROP TABLE `shop`.`orders`"
        );
        assert_eq!(
            mysql_build_empty_sql("shop", "orders"),
            "DELETE FROM `shop`.`orders`"
        );
    }

    #[test]
    fn build_bulk_insert_columns_and_placeholders() {
        let cols = vec!["a".to_string(), "b".to_string()];
        let sql = mysql_build_bulk_insert_sql("shop", "orders", &cols, 2);
        assert_eq!(
            sql,
            "INSERT INTO `shop`.`orders` (`a`, `b`) VALUES (?, ?), (?, ?)"
        );
    }

    #[test]
    fn default_sort_picks_id_then_first_column() {
        assert_eq!(
            mysql_default_sort(&["updated_at".into(), "id".into()]),
            "id"
        );
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
