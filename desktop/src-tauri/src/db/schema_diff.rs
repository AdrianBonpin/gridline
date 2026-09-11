//! Schema snapshot capture + the pure diff engine (engine lands in Task 14).
//!
//! Snapshots are read-only, single-use, and capped (5,000 objects — spec §2).
//! Sync SQL is generated in the TARGET's dialect with identifiers quoted
//! per engine (spec §2: never raw interpolation).

use crate::db::pool::DbHandle;
use crate::models::db_viewer::*;
use std::collections::BTreeMap;

pub(crate) const SNAPSHOT_CAP: usize = 5_000;

/// Map a PG `conf*type` action code to its SQL name.
pub(crate) fn pg_fk_action(code: &str) -> &'static str {
    match code {
        "r" => "RESTRICT",
        "c" => "CASCADE",
        "n" => "SET NULL",
        "d" => "SET DEFAULT",
        _ => "NO ACTION",
    }
}

/// Enforce the 5,000-object cap, setting `truncated` (never silent).
pub(crate) fn apply_snapshot_cap(snap: &mut SchemaSnapshot) {
    let mut total = snap.tables.len() + snap.views.len() + snap.sequences.len() + snap.enums.len();
    let over = total > SNAPSHOT_CAP;
    if over {
        let mut remaining = SNAPSHOT_CAP;
        fn take<T>(v: &mut Vec<T>, budget: &mut usize) {
            if v.len() > *budget {
                v.truncate(*budget);
            }
            *budget -= v.len();
        }
        take(&mut snap.tables, &mut remaining);
        take(&mut snap.views, &mut remaining);
        take(&mut snap.sequences, &mut remaining);
        take(&mut snap.enums, &mut remaining);
        total = SNAPSHOT_CAP;
    }
    snap.object_count = total;
    snap.truncated = over;
}

fn csv_names(s: &str) -> Vec<String> {
    s.split(", ").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

/// Capture a PostgreSQL schema snapshot (six set-based queries, one per class).
pub(crate) async fn capture_pg(
    client: &tokio_postgres::Client,
    engine: &str,
    schema: &str,
) -> Result<SchemaSnapshot, String> {
    let mut tables: BTreeMap<String, SnapshotTable> = BTreeMap::new();
    let mut views: Vec<SnapshotView> = Vec::new();
    let mut sequences: Vec<SnapshotSequence> = Vec::new();
    let mut enums: BTreeMap<String, SnapshotEnum> = BTreeMap::new();

    // Columns
    let rows = client
        .query(&crate::db::introspection::pg_diff_columns_query(), &[&schema])
        .await
        .map_err(|e| format!("columns query failed: {e}"))?;
    for r in rows {
        let tname: String = r.get(0);
        let entry = tables.entry(tname.clone()).or_insert_with(|| SnapshotTable {
            schema: schema.to_string(),
            name: tname,
            ..Default::default()
        });
        entry.columns.push(SnapshotColumn {
            name: r.get(1),
            data_type: r.get(2),
            nullable: r.get(3),
            default_value: r.get::<_, Option<String>>(4),
        });
    }

    // Constraints (PK / UNIQUE / CHECK / FK)
    // Column order: table_name(0), constraint_name(1), contype(2), cols(3),
    // ref_cols(4), ref_table(5), confdeltype(6), confupdtype(7), definition(8)
    let rows = client
        .query(&crate::db::introspection::pg_diff_constraints_query(), &[&schema])
        .await
        .map_err(|e| format!("constraints query failed: {e}"))?;
    for r in rows {
        let tname: String = r.get(0);
        let cname: String = r.get(1);
        let contype: String = r.get(2);
        let Some(entry) = tables.get_mut(&tname) else { continue };
        match contype.as_str() {
            "p" => entry.primary_key = csv_names(&r.get::<_, Option<String>>(3).unwrap_or_default()),
            "u" => entry.uniques.push(SnapshotConstraint {
                name: cname,
                kind: "unique".into(),
                definition: r.get::<_, Option<String>>(3).unwrap_or_default(),
            }),
            "c" => entry.checks.push(SnapshotConstraint {
                name: cname,
                kind: "check".into(),
                definition: r.get::<_, Option<String>>(8).unwrap_or_default(),
            }),
            "f" => {
                let ref_qualified: Option<String> = r.get(5);
                let (ref_schema, ref_table) = ref_qualified
                    .map(|q| match q.split_once('.') {
                        Some((s, t)) => (s.to_string(), t.to_string()),
                        None => (String::new(), q.clone()),
                    })
                    .unwrap_or_default();
                entry.foreign_keys.push(SnapshotFk {
                    name: cname,
                    columns: csv_names(&r.get::<_, Option<String>>(3).unwrap_or_default()),
                    ref_schema,
                    ref_table,
                    ref_columns: csv_names(&r.get::<_, Option<String>>(4).unwrap_or_default()),
                    on_delete: pg_fk_action(&r.get::<_, Option<String>>(6).unwrap_or_default()).to_string(),
                    on_update: pg_fk_action(&r.get::<_, Option<String>>(7).unwrap_or_default()).to_string(),
                });
            }
            _ => {}
        }
    }

    // Indexes
    let rows = client
        .query(&crate::db::introspection::pg_diff_indexes_query(), &[&schema])
        .await
        .map_err(|e| format!("indexes query failed: {e}"))?;
    for r in rows {
        let tname: String = r.get(0);
        let Some(entry) = tables.get_mut(&tname) else { continue };
        entry.indexes.push(SnapshotIndex {
            name: r.get(1),
            columns: csv_names(&r.get::<_, Option<String>>(3).unwrap_or_default()),
            unique: r.get(2),
        });
    }

    // Views + matviews
    let rows = client
        .query(&crate::db::introspection::pg_diff_views_query(), &[&schema])
        .await
        .map_err(|e| format!("views query failed: {e}"))?;
    for r in rows {
        views.push(SnapshotView {
            schema: r.get(0),
            name: r.get(1),
            definition: r.get(2),
            materialized: r.get(3),
        });
    }

    // Sequences
    let rows = client
        .query(&crate::db::introspection::pg_diff_sequences_query(), &[&schema])
        .await
        .map_err(|e| format!("sequences query failed: {e}"))?;
    for r in rows {
        sequences.push(SnapshotSequence {
            schema: r.get(0),
            name: r.get(1),
            start: r.get(2),
            increment: r.get(3),
            minimum: r.get(4),
            maximum: r.get(5),
            cycle: r.get(6),
        });
    }

    // Enums (one row per label — aggregate by name)
    let rows = client
        .query(&crate::db::introspection::pg_diff_enums_query(), &[&schema])
        .await
        .map_err(|e| format!("enums query failed: {e}"))?;
    for r in rows {
        let ename: String = r.get(1);
        let entry = enums.entry(ename.clone()).or_insert_with(|| SnapshotEnum {
            schema: r.get(0),
            name: ename,
            labels: Vec::new(),
        });
        entry.labels.push(r.get(2));
    }

    let mut snap = SchemaSnapshot {
        engine: engine.to_string(),
        schema: schema.to_string(),
        tables: tables.into_values().collect(),
        views,
        sequences,
        enums: enums.into_values().collect(),
        object_count: 0,
        truncated: false,
    };
    apply_snapshot_cap(&mut snap);
    Ok(snap)
}

/// Capture a SQLite (in-file/in-memory) snapshot.
pub(crate) fn capture_sqlite(conn: &rusqlite::Connection) -> Result<SchemaSnapshot, String> {
    crate::db::schema_diff::capture::sqlite(conn)
}

/// Capture a MySQL/MariaDB snapshot.
pub(crate) async fn capture_mysql(
    conn: &mut sqlx::mysql::MySqlConnection,
    engine: &str,
    schema: &str,
) -> Result<SchemaSnapshot, String> {
    crate::db::schema_diff::capture::mysql(conn, engine, schema).await
}

/// Dispatch a snapshot capture across engines. `engine` is the CONNECTION's
/// db_type (mariadb vs mysql matters for the diff dialect).
pub(crate) async fn capture_snapshot(
    handle: &mut DbHandle,
    engine: &str,
    schema: &str,
) -> Result<SchemaSnapshot, String> {
    match handle {
        DbHandle::Postgresql(client, _) => capture_pg(client, engine, schema).await,
        DbHandle::MySql(pool) => {
            let mut conn = pool
                .acquire()
                .await
                .map_err(|e| format!("source/target connection failed: {e}"))?;
            capture_mysql(&mut *conn, engine, schema).await
        }
        DbHandle::Sqlite(conn) => capture_sqlite(conn),
    }
}

pub(crate) mod capture {
    use super::*;

    pub(crate) fn sqlite(conn: &rusqlite::Connection) -> Result<SchemaSnapshot, String> {
        let mut snap = SchemaSnapshot {
            engine: "sqlite".into(),
            schema: "main".into(),
            ..Default::default()
        };

        let mut stmt = conn
            .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view') ORDER BY name")
            .map_err(|e| e.to_string())?;
        let objects: Vec<(String, String, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        for (otype, name, sql) in objects {
            if otype == "view" {
                snap.views.push(SnapshotView {
                    schema: "main".into(),
                    name,
                    definition: sql.unwrap_or_default(),
                    materialized: false,
                });
                continue;
            }
            let mut table = SnapshotTable {
                schema: "main".into(),
                name: name.clone(),
                ..Default::default()
            };
            // Columns + PK + defaults
            let mut cols = conn
                .prepare(&format!("PRAGMA table_info({})", quote_double(&name)))
                .map_err(|e| e.to_string())?;
            let col_rows: Vec<(String, String, i64, Option<String>, i64)> = cols
                .query_map([], |r| Ok((r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(cols);
            for (cname, ctype, notnull, default, pk) in col_rows {
                if pk > 0 {
                    table.primary_key.push(cname.clone());
                }
                table.columns.push(SnapshotColumn {
                    name: cname,
                    data_type: ctype,
                    nullable: notnull == 0,
                    default_value: default,
                });
            }
            // Indexes (skip the PK-mandated sqlite_autoindex_*)
            let mut idx = conn
                .prepare(&format!("PRAGMA index_list({})", quote_double(&name)))
                .map_err(|e| e.to_string())?;
            let idx_rows: Vec<(String, i64)> = idx
                .query_map([], |r| Ok((r.get(1)?, r.get(2)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(idx);
            for (iname, unique) in idx_rows {
                if iname.starts_with("sqlite_autoindex") {
                    continue;
                }
                let mut info = conn
                    .prepare(&format!("PRAGMA index_info({})", quote_double(&iname)))
                    .map_err(|e| e.to_string())?;
                let icols: Vec<String> = info
                    .query_map([], |r| r.get::<_, String>(2))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                drop(info);
                table.indexes.push(SnapshotIndex {
                    name: iname,
                    columns: icols,
                    unique: unique != 0,
                });
            }
            // Foreign keys
            let mut fks = conn
                .prepare(&format!("PRAGMA foreign_key_list({})", quote_double(&name)))
                .map_err(|e| e.to_string())?;
            let fk_rows: Vec<(i64, i64, String, String, String, String, String)> = fks
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(fks);
            // (id, seq, table, from, to, on_update, on_delete) — group by id
            let mut grouped: BTreeMap<i64, SnapshotFk> = BTreeMap::new();
            for (id, _seq, reftable, from, to, on_update, on_delete) in fk_rows {
                let fk = grouped.entry(id).or_insert_with(|| SnapshotFk {
                    name: format!("fk_{name}_{id}"),
                    columns: Vec::new(),
                    ref_schema: "main".into(),
                    ref_table: reftable,
                    ref_columns: Vec::new(),
                    on_delete: String::new(),
                    on_update: String::new(),
                });
                fk.columns.push(from);
                if !to.is_empty() {
                    fk.ref_columns.push(to);
                }
                if !on_delete.is_empty() {
                    fk.on_delete = on_delete.to_uppercase();
                }
                if !on_update.is_empty() {
                    fk.on_update = on_update.to_uppercase();
                }
            }
            table.foreign_keys = grouped.into_values().collect();
            snap.tables.push(table);
        }

        apply_snapshot_cap(&mut snap);
        Ok(snap)
    }

    pub(crate) async fn mysql(
        conn: &mut sqlx::mysql::MySqlConnection,
        engine: &str,
        schema: &str,
    ) -> Result<SchemaSnapshot, String> {
        use crate::db::mysql::{mysql_row_string, mysql_snapshot_columns_query, mysql_snapshot_constraints_query, mysql_snapshot_indexes_query, mysql_snapshot_views_query};

        let mut tables: BTreeMap<String, SnapshotTable> = BTreeMap::new();
        let mut views: Vec<SnapshotView> = Vec::new();

        let rows = sqlx::query(&mysql_snapshot_columns_query(schema))
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("columns query failed: {e}"))?;
        for r in rows {
            let tname = mysql_row_string(&r, 0);
            let entry = tables.entry(tname.clone()).or_insert_with(|| SnapshotTable {
                schema: schema.to_string(),
                name: tname,
                ..Default::default()
            });
            entry.columns.push(SnapshotColumn {
                name: mysql_row_string(&r, 1),
                data_type: mysql_row_string(&r, 2),
                nullable: mysql_row_string(&r, 3) == "YES",
                default_value: (!mysql_row_string(&r, 4).is_empty()).then(|| mysql_row_string(&r, 4)),
            });
        }

        let rows = sqlx::query(&mysql_snapshot_constraints_query(schema))
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("constraints query failed: {e}"))?;
        for r in rows {
            let tname = mysql_row_string(&r, 0);
            let cname = mysql_row_string(&r, 1);
            let ctype = mysql_row_string(&r, 2);
            let col = mysql_row_string(&r, 3);
            let Some(entry) = tables.get_mut(&tname) else { continue };
            match ctype.as_str() {
                "PRIMARY KEY" => {
                    if !entry.primary_key.contains(&col) {
                        entry.primary_key.push(col);
                    }
                }
                "UNIQUE" => {
                    if let Some(u) = entry.uniques.iter_mut().find(|u| u.name == cname) {
                        u.definition = if u.definition.is_empty() { col.clone() } else { format!("{}, {col}", u.definition) };
                    } else {
                        entry.uniques.push(SnapshotConstraint {
                            name: cname,
                            kind: "unique".into(),
                            definition: col,
                        });
                    }
                }
                "FOREIGN KEY" => {
                    let ref_table = mysql_row_string(&r, 4);
                    let on_delete = mysql_row_string(&r, 5).to_uppercase();
                    let on_update = mysql_row_string(&r, 6).to_uppercase();
                    if let Some(fk) = entry.foreign_keys.iter_mut().find(|f| f.name == cname) {
                        fk.columns.push(col);
                    } else {
                        entry.foreign_keys.push(SnapshotFk {
                            name: cname,
                            columns: vec![col],
                            ref_schema: String::new(),
                            ref_table,
                            ref_columns: Vec::new(),
                            on_delete,
                            on_update,
                        });
                    }
                }
                "CHECK" => {
                    if let Some(c) = entry.checks.iter_mut().find(|c| c.name == cname) {
                        c.definition = format!("{} {}", c.definition, mysql_row_string(&r, 7));
                    } else {
                        entry.checks.push(SnapshotConstraint {
                            name: cname,
                            kind: "check".into(),
                            definition: mysql_row_string(&r, 7),
                        });
                    }
                }
                _ => {}
            }
        }

        let rows = sqlx::query(&mysql_snapshot_indexes_query(schema))
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("indexes query failed: {e}"))?;
        for r in rows {
            let tname = mysql_row_string(&r, 0);
            let iname = mysql_row_string(&r, 1);
            let unique = mysql_row_string(&r, 2) == "0";
            let col = mysql_row_string(&r, 3);
            let Some(entry) = tables.get_mut(&tname) else { continue };
            if let Some(ix) = entry.indexes.iter_mut().find(|i| i.name == iname) {
                ix.columns.push(col);
            } else {
                entry.indexes.push(SnapshotIndex {
                    name: iname,
                    columns: vec![col],
                    unique,
                });
            }
        }

        let rows = sqlx::query(&mysql_snapshot_views_query(schema))
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| format!("views query failed: {e}"))?;
        for r in rows {
            views.push(SnapshotView {
                schema: mysql_row_string(&r, 0),
                name: mysql_row_string(&r, 1),
                definition: mysql_row_string(&r, 2),
                materialized: false,
            });
        }

        let mut snap = SchemaSnapshot {
            engine: engine.to_string(),
            schema: schema.to_string(),
            tables: tables.into_values().collect(),
            views,
            sequences: Vec::new(),
            enums: Vec::new(),
            object_count: 0,
            truncated: false,
        };
        apply_snapshot_cap(&mut snap);
        Ok(snap)
    }
}

/// Double-quote an identifier (PG/SQLite) with embedded-quote doubling.
pub(crate) fn quote_double(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// Pure diff engine (spec §4/§5A)
// ---------------------------------------------------------------------------
// Destructive classification (binding): DROP TABLE/VIEW/INDEX/SEQUENCE/TYPE/
// CONSTRAINT, DROP COLUMN, and ALTER COLUMN TYPE are destructive (copy-only);
// everything else (CREATE, ADD COLUMN, ADD CONSTRAINT, RENAME, SET/DROP
// DEFAULT, SET/DROP NOT NULL) is stageable.

pub(crate) fn engine_family(engine: &str) -> &'static str {
    match engine {
        "mysql" | "mariadb" => "mysql",
        "sqlite" => "sqlite",
        _ => "postgresql",
    }
}

fn quote(family: &str, name: &str) -> String {
    match family {
        "mysql" => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

fn qualified(family: &str, schema: &str, name: &str) -> String {
    match family {
        "mysql" => format!("`{}`.`{}`", schema.replace('`', "``"), name.replace('`', "``")),
        "sqlite" => quote(family, name),
        _ => format!("\"{}\".\"{}\"", schema.replace('"', "\"\""), name.replace('"', "\"\"")),
    }
}

fn detail_line(label: &str, old: &str, new: &str) -> DiffDetailLine {
    DiffDetailLine { label: label.into(), old: old.into(), new: new.into() }
}

fn item(ty: &str, name: &str, kind: &str, detail: Vec<DiffDetailLine>, sql: Vec<String>, destructive: bool) -> DiffItem {
    DiffItem {
        object_type: ty.into(),
        name: name.into(),
        kind: kind.into(),
        detail,
        sync_sql: sql,
        destructive,
    }
}

/// Diff two snapshots into a report. Sync SQL is in the TARGET's dialect.
pub fn diff_snapshots(source: &SchemaSnapshot, target: &SchemaSnapshot) -> DiffReport {
    let family = engine_family(&target.engine);
    let schema = &target.schema;
    let mut items: Vec<DiffItem> = Vec::new();

    // ── Enums (PG) — must come first (tables may depend on them) ──────────
    for (s_enum, t_enum) in enum_pairs(&source.enums, &target.enums) {
        match (s_enum, t_enum) {
            (Some(s), None) => items.push(item(
                "enum", &s.name, "added", vec![],
                vec![format!(
                    "CREATE TYPE {}.{} AS ENUM ({});",
                    quote(family, &s.schema),
                    quote(family, &s.name),
                    s.labels.iter().map(|l| format!("'{}'", l.replace('\'', "''"))).collect::<Vec<_>>().join(", ")
                )],
                false,
            )),
            (None, Some(t)) => items.push(item(
                "enum", &t.name, "removed", vec![],
                vec![format!("DROP TYPE {}.{};", quote(family, &t.schema), quote(family, &t.name))],
                true,
            )),
            (Some(s), Some(t)) => {
                let mut added = Vec::new();
                let mut removed_or_reordered = false;
                for l in &s.labels {
                    if !t.labels.contains(l) { added.push(l.clone()); }
                }
                if t.labels.iter().any(|l| !s.labels.contains(l)) || !common_prefix(&s.labels, &t.labels) {
                    removed_or_reordered = true;
                }
                if !added.is_empty() {
                    if removed_or_reordered {
                        items.push(item("enum", &s.name, "changed", vec![detail_line("labels", &t.labels.join(", "), &s.labels.join(", "))], vec![], true));
                    } else {
                        items.push(item(
                            "enum", &s.name, "changed",
                            vec![detail_line("added labels", "", &added.join(", "))],
                            added.iter().map(|l| format!("ALTER TYPE {}.{} ADD VALUE '{}';", quote(family, &s.schema), quote(family, &s.name), l.replace('\'', "''"))).collect(),
                            false,
                        ));
                    }
                }
            }
            (None, None) => {}
        }
    }

    // ── Sequences (PG) ─────────────────────────────────────────────────────
    for (s_seq, t_seq) in pair_by(&source.sequences, &target.sequences, |s| s.name.clone()) {
        match (s_seq, t_seq) {
            (Some(s), None) => items.push(item(
                "sequence", &s.name, "added", vec![],
                vec![format!(
                    "CREATE SEQUENCE {q} START WITH {start} INCREMENT BY {inc} MINVALUE {min} MAXVALUE {max} {cycle};",
                    q = qualified(family, schema, &s.name),
                    start = s.start, inc = s.increment, min = s.minimum, max = s.maximum,
                    cycle = if s.cycle { "CYCLE" } else { "NO CYCLE" }
                )],
                false,
            )),
            (None, Some(t)) => items.push(item(
                "sequence", &t.name, "removed", vec![],
                vec![format!("DROP SEQUENCE {};", qualified(family, schema, &t.name))],
                true,
            )),
            (Some(s), Some(t)) => {
                let mut sql = String::new();
                let mut detail = Vec::new();
                for (label, sv, tv) in [
                    ("start", &s.start, &t.start),
                    ("increment", &s.increment, &t.increment),
                    ("minimum", &s.minimum, &t.minimum),
                    ("maximum", &s.maximum, &t.maximum),
                ] {
                    if sv != tv {
                        detail.push(detail_line(label, tv, sv));
                        if !sql.is_empty() { sql.push(' '); }
                        match label {
                            "start" => sql.push_str(&format!("START WITH {sv}")),
                            "increment" => sql.push_str(&format!("INCREMENT BY {sv}")),
                            "minimum" => sql.push_str(&format!("MINVALUE {sv}")),
                            "maximum" => sql.push_str(&format!("MAXVALUE {sv}")),
                            _ => {}
                        }
                    }
                }
                if s.cycle != t.cycle {
                    detail.push(detail_line("cycle", &t.cycle.to_string(), &s.cycle.to_string()));
                    if !sql.is_empty() { sql.push(' '); }
                    sql.push_str(if s.cycle { "CYCLE" } else { "NO CYCLE" });
                }
                if !sql.is_empty() {
                    items.push(item("sequence", &s.name, "changed", detail, vec![format!("ALTER SEQUENCE {} {};", qualified(family, schema, &s.name), sql)], false));
                }
            }
            (None, None) => {}
        }
    }

    // ── Tables ─────────────────────────────────────────────────────────────
    for (s_t, t_t) in pair_by(&source.tables, &target.tables, |t| t.name.clone()) {
        match (s_t, t_t) {
            (Some(s), None) => {
                let mut defs: Vec<String> = s.columns.iter().map(|c| {
                    let mut d = format!("{} {}", quote(family, &c.name), c.data_type);
                    if !c.nullable { d.push_str(" NOT NULL"); }
                    if let Some(def) = &c.default_value { d.push_str(&format!(" DEFAULT {def}")); }
                    d
                }).collect();
                if !s.primary_key.is_empty() {
                    defs.push(format!("PRIMARY KEY ({})", s.primary_key.iter().map(|p| quote(family, p)).collect::<Vec<_>>().join(", ")));
                }
                items.push(item(
                    "table", &s.name, "added", vec![],
                    vec![format!("CREATE TABLE {} ({});", qualified(family, schema, &s.name), defs.join(", "))],
                    false,
                ));
                push_constraint_items(&mut items, family, schema, s, "added");
            }
            (None, Some(t)) => items.push(item(
                "table", &t.name, "removed", vec![],
                vec![format!("DROP TABLE {};", qualified(family, schema, &t.name))],
                true,
            )),
            (Some(s), Some(t)) => diff_table(&mut items, family, schema, s, t),
            (None, None) => {}
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────
    for (s_v, t_v) in pair_by(&source.views, &target.views, |v| v.name.clone()) {
        match (s_v, t_v) {
            (Some(s), None) => items.push(item(
                "view", &s.name, "added", vec![],
                vec![format!("CREATE {}VIEW {} AS {};", if s.materialized { "MATERIALIZED " } else { "" }, qualified(family, schema, &s.name), s.definition.trim_end_matches(';'))],
                false,
            )),
            (None, Some(t)) => items.push(item(
                "view", &t.name, "removed", vec![],
                vec![format!("DROP {}VIEW {};", if t.materialized { "MATERIALIZED " } else { "" }, qualified(family, schema, &t.name))],
                true,
            )),
            (Some(s), Some(t)) if s.definition.trim() != t.definition.trim() => {
                if family == "postgresql" || family == "mysql" {
                    if s.materialized || t.materialized {
                        items.push(item("view", &s.name, "changed", vec![detail_line("definition", &t.definition, &s.definition)],
                            vec![format!("DROP MATERIALIZED VIEW {q}; CREATE MATERIALIZED VIEW {q} AS {d};", q = qualified(family, schema, &s.name), d = s.definition.trim_end_matches(';'))], true));
                    } else {
                        items.push(item("view", &s.name, "changed", vec![detail_line("definition", &t.definition, &s.definition)],
                            vec![format!("CREATE OR REPLACE VIEW {} AS {};", qualified(family, schema, &s.name), s.definition.trim_end_matches(';'))], false));
                    }
                } else {
                    items.push(item("view", &s.name, "changed", vec![detail_line("definition", &t.definition, &s.definition)], vec![], true));
                }
            }
            _ => {}
        }
    }

    DiffReport {
        items,
        source_label: format!("{} ({})", source.schema, source.engine),
        target_label: format!("{} ({})", target.schema, target.engine),
        truncated: source.truncated || target.truncated,
    }
}

/// Items safe to stage: non-destructive AND carrying SQL.
pub fn stageable_items(report: &DiffReport) -> Vec<&DiffItem> {
    report.items.iter().filter(|i| !i.destructive && !i.sync_sql.is_empty()).collect()
}

fn common_prefix(source: &[String], target: &[String]) -> bool {
    let mut ti = 0usize;
    for l in target {
        if source.contains(l) {
            if ti >= source.len() || &source[ti] != l {
                return false;
            }
            ti += 1;
        }
    }
    true
}

/// Pair two keyed lists into (source, target) options by key.
fn pair_by<'a, T, K: Ord + Clone + Eq>(src: &'a [T], tgt: &'a [T], key: impl Fn(&T) -> K) -> Vec<(Option<&'a T>, Option<&'a T>)> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<K, (Option<&T>, Option<&T>)> = BTreeMap::new();
    for s in src { map.entry(key(s)).or_insert((None, None)).0 = Some(s); }
    for t in tgt { map.entry(key(t)).or_insert((None, None)).1 = Some(t); }
    map.into_values().collect()
}

fn enum_pairs<'a>(src: &'a [SnapshotEnum], tgt: &'a [SnapshotEnum]) -> Vec<(Option<&'a SnapshotEnum>, Option<&'a SnapshotEnum>)> {
    pair_by(src, tgt, |e| e.name.clone())
}

fn push_constraint_items(items: &mut Vec<DiffItem>, family: &str, schema: &str, table: &SnapshotTable, kind: &str) {
    let qtn = qualified(family, schema, &table.name);
    for fk in &table.foreign_keys {
        items.push(item(
            "constraint", &format!("{}.{}", table.name, fk.name), kind, vec![],
            vec![constraint_fk_sql(family, schema, &qtn, fk)],
            false,
        ));
    }
    for u in &table.uniques {
        let cols = u.definition.split(", ").map(|c| quote(family, c.trim())).collect::<Vec<_>>().join(", ");
        items.push(item(
            "constraint", &format!("{}.{}", table.name, u.name), kind, vec![],
            vec![format!("ALTER TABLE {qtn} ADD CONSTRAINT {n} UNIQUE ({cols});", n = quote(family, &u.name), cols = cols)],
            false,
        ));
    }
    for c in &table.checks {
        items.push(item(
            "constraint", &format!("{}.{}", table.name, c.name), kind, vec![],
            vec![format!("ALTER TABLE {qtn} ADD CONSTRAINT {n} CHECK ({d});", n = quote(family, &c.name), d = c.definition.trim())],
            false,
        ));
    }
    for ix in &table.indexes {
        let cols = ix.columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", ");
        items.push(item(
            "index", &format!("{}.{}", table.name, ix.name), kind, vec![],
            vec![format!("CREATE {u}INDEX {n} ON {qtn} ({cols});", u = if ix.unique { "UNIQUE " } else { "" }, n = quote(family, &ix.name), cols = cols)],
            false,
        ));
    }
}

fn constraint_fk_sql(family: &str, _schema: &str, qtn: &str, fk: &SnapshotFk) -> String {
    let cols = fk.columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", ");
    let ref_cols = fk.ref_columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", ");
    let ref_qualified = match family {
        "mysql" => format!("`{}`", fk.ref_table.replace('`', "``")),
        "sqlite" => quote(family, &fk.ref_table),
        _ => qualified(family, &fk.ref_schema, &fk.ref_table),
    };
    format!(
        "ALTER TABLE {qtn} ADD CONSTRAINT {n} FOREIGN KEY ({cols}) REFERENCES {r} ({rc}) ON DELETE {od} ON UPDATE {ou};",
        n = quote(family, &fk.name), cols = cols, r = ref_qualified, rc = ref_cols,
        od = fk.on_delete, ou = fk.on_update
    )
}

fn diff_table(items: &mut Vec<DiffItem>, family: &str, schema: &str, s: &SnapshotTable, t: &SnapshotTable) {
    let qtn = qualified(family, schema, &s.name);

    for (s_c, t_c) in pair_by(&s.columns, &t.columns, |c| c.name.clone()) {
        match (s_c, t_c) {
            (Some(c), None) => {
                let mut sql = format!("ALTER TABLE {qtn} ADD COLUMN {n} {ty}", n = quote(family, &c.name), ty = c.data_type);
                if !c.nullable {
                    if family == "sqlite" && c.default_value.is_none() {
                        items.push(item("column", &format!("{}.{}", s.name, c.name), "added",
                            vec![detail_line("nullable", "false", "true (SQLite cannot ADD COLUMN NOT NULL without DEFAULT)")],
                            vec![format!("{sql};")], false));
                        continue;
                    }
                    sql.push_str(" NOT NULL");
                }
                if let Some(d) = &c.default_value { sql.push_str(&format!(" DEFAULT {d}")); }
                items.push(item("column", &format!("{}.{}", s.name, c.name), "added", vec![], vec![format!("{sql};")], false));
            }
            (None, Some(c)) => items.push(item(
                "column", &format!("{}.{}", s.name, c.name), "removed", vec![],
                vec![format!("ALTER TABLE {qtn} DROP COLUMN {n};", n = quote(family, &c.name))],
                true,
            )),
            (Some(sc), Some(tc)) => {
                if sc.data_type != tc.data_type {
                    let sql = match family {
                        "postgresql" => format!("ALTER TABLE {qtn} ALTER COLUMN {n} TYPE {ty} USING {n}::{ty};", n = quote(family, &sc.name), ty = sc.data_type),
                        "mysql" => format!("ALTER TABLE {qtn} MODIFY COLUMN {n} {ty}{nn};", n = quote(family, &sc.name), ty = sc.data_type, nn = if sc.nullable { String::new() } else { " NOT NULL".into() }),
                        _ => String::new(),
                    };
                    items.push(item("column", &format!("{}.{}", s.name, sc.name), "changed",
                        vec![detail_line("type", &tc.data_type, &sc.data_type)],
                        if sql.is_empty() { vec![] } else { vec![sql] }, true));
                }
                if sc.nullable != tc.nullable {
                    let sql = match family {
                        "postgresql" => format!("ALTER TABLE {qtn} ALTER COLUMN {n} {op};", n = quote(family, &sc.name), op = if sc.nullable { "DROP NOT NULL" } else { "SET NOT NULL" }),
                        "mysql" => format!("ALTER TABLE {qtn} MODIFY COLUMN {n} {ty}{nn};", n = quote(family, &sc.name), ty = sc.data_type, nn = if sc.nullable { String::new() } else { " NOT NULL".into() }),
                        _ => String::new(),
                    };
                    if !sql.is_empty() {
                        items.push(item("column", &format!("{}.{}", s.name, sc.name), "changed",
                            vec![detail_line("nullable", &tc.nullable.to_string(), &sc.nullable.to_string())],
                            vec![sql], false));
                    }
                }
                if sc.default_value != tc.default_value {
                    let sql = match family {
                        "postgresql" => match &sc.default_value {
                            Some(d) => format!("ALTER TABLE {qtn} ALTER COLUMN {n} SET DEFAULT {d};", n = quote(family, &sc.name)),
                            None => format!("ALTER TABLE {qtn} ALTER COLUMN {n} DROP DEFAULT;", n = quote(family, &sc.name)),
                        },
                        "mysql" => match &sc.default_value {
                            Some(d) => format!("ALTER TABLE {qtn} ALTER COLUMN {n} SET DEFAULT {d};", n = quote(family, &sc.name)),
                            None => format!("ALTER TABLE {qtn} ALTER COLUMN {n} DROP DEFAULT;", n = quote(family, &sc.name)),
                        },
                        _ => String::new(),
                    };
                    if !sql.is_empty() {
                        items.push(item("column", &format!("{}.{}", s.name, sc.name), "changed",
                            vec![detail_line("default", &tc.default_value.as_deref().unwrap_or_default(), &sc.default_value.clone().unwrap_or_default())],
                            vec![sql], false));
                    }
                }
            }
            (None, None) => {}
        }
    }

    if s.primary_key != t.primary_key {
        items.push(item("table", &s.name, "changed",
            vec![detail_line("primary key", &t.primary_key.join(", "), &s.primary_key.join(", "))],
            vec![], true));
    }

    for (s_c, t_c) in pair_by(&s.uniques, &t.uniques, |c| c.name.clone()) {
        push_constraint_delta(items, family, s, "UNIQUE", s_c, t_c);
    }
    for (s_c, t_c) in pair_by(&s.checks, &t.checks, |c| c.name.clone()) {
        push_constraint_delta(items, family, s, "CHECK", s_c, t_c);
    }

    for (s_f, t_f) in pair_by(&s.foreign_keys, &t.foreign_keys, |f| f.name.clone()) {
        let qtn2 = qualified(family, schema, &s.name);
        match (s_f, t_f) {
            (Some(f), None) => {
                if family == "sqlite" {
                    items.push(item("constraint", &format!("{}.{}", s.name, f.name), "added",
                        vec![detail_line("note", "", "SQLite cannot add foreign keys to existing tables — table rebuild required")],
                        vec![], false));
                } else {
                    items.push(item("constraint", &format!("{}.{}", s.name, f.name), "added", vec![],
                        vec![constraint_fk_sql(family, schema, &qtn2, f)], false));
                }
            }
            (None, Some(f)) => items.push(item(
                "constraint", &format!("{}.{}", s.name, f.name), "removed", vec![],
                vec![format!("ALTER TABLE {qtn2} DROP CONSTRAINT {n};", n = quote(family, &f.name))],
                true,
            )),
            (Some(sf), Some(tf)) if sf.definition_differs(tf) => {
                items.push(item("constraint", &format!("{}.{}", s.name, sf.name), "changed",
                    vec![detail_line("definition", &tf.on_delete, &sf.on_delete)],
                    vec![format!("ALTER TABLE {qtn2} DROP CONSTRAINT {n}; ALTER TABLE {qtn2} ADD CONSTRAINT {n2} FOREIGN KEY ({cols}) REFERENCES {r} ({rc}) ON DELETE {od} ON UPDATE {ou};",
                        n = quote(family, &sf.name), n2 = quote(family, &sf.name),
                        cols = sf.columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", "),
                        r = qualified(family, &sf.ref_schema, &sf.ref_table),
                        rc = sf.ref_columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", "),
                        od = sf.on_delete, ou = sf.on_update)],
                    true));
            }
            _ => {}
        }
    }

    for (s_i, t_i) in pair_by(&s.indexes, &t.indexes, |i| i.name.clone()) {
        match (s_i, t_i) {
            (Some(ix), None) => items.push(item(
                "index", &format!("{}.{}", s.name, ix.name), "added", vec![],
                vec![format!("CREATE {u}INDEX {n} ON {qtn} ({cols});", u = if ix.unique { "UNIQUE " } else { "" }, n = qualified(family, schema, &ix.name), cols = ix.columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", "))],
                false,
            )),
            (None, Some(ix)) => items.push(item(
                "index", &format!("{}.{}", s.name, ix.name), "removed", vec![],
                vec![format!("DROP INDEX {n};", n = quote(family, &ix.name))],
                true,
            )),
            (Some(si), Some(ti)) if si.columns != ti.columns || si.unique != ti.unique => {
                items.push(item("index", &format!("{}.{}", s.name, si.name), "changed",
                    vec![detail_line("columns", &ti.columns.join(", "), &si.columns.join(", "))],
                    vec![format!("DROP INDEX {n}; CREATE {u}INDEX {n} ON {qtn} ({cols});", n = qualified(family, schema, &si.name), u = if si.unique { "UNIQUE " } else { "" }, cols = si.columns.iter().map(|c| quote(family, c)).collect::<Vec<_>>().join(", "))],
                    true));
            }
            _ => {}
        }
    }
}

fn push_constraint_delta(items: &mut Vec<DiffItem>, family: &str, table: &SnapshotTable, kind: &str,
    s_c: Option<&SnapshotConstraint>, t_c: Option<&SnapshotConstraint>) {
    let qtn = qualified(family, &table.schema, &table.name);
    match (s_c, t_c) {
        (Some(c), None) if kind == "UNIQUE" => items.push(item(
            "constraint", &format!("{}.{}", table.name, c.name), "added", vec![],
            vec![format!("ALTER TABLE {qtn} ADD CONSTRAINT {n} UNIQUE ({cols});", n = quote(family, &c.name), cols = c.definition.split(", ").map(|x| quote(family, x.trim())).collect::<Vec<_>>().join(", "))],
            false,
        )),
        (Some(c), None) if kind == "CHECK" => items.push(item(
            "constraint", &format!("{}.{}", table.name, c.name), "added", vec![],
            vec![format!("ALTER TABLE {qtn} ADD CONSTRAINT {n} CHECK ({d});", n = quote(family, &c.name), d = c.definition.trim())],
            false,
        )),
        (Some(c), None) if family == "sqlite" => items.push(item(
            "constraint", &format!("{}.{}", table.name, c.name), "added",
            vec![detail_line("note", "", "SQLite cannot add constraints to existing tables — table rebuild required")],
            vec![], false)),
        (None, Some(c)) => items.push(item(
            "constraint", &format!("{}.{}", table.name, c.name), "removed", vec![],
            vec![format!("ALTER TABLE {qtn} DROP CONSTRAINT {n};", n = quote(family, &c.name))],
            true,
        )),
        (Some(sc), Some(tc)) if sc.definition.trim() != tc.definition.trim() => {
            let sql = if kind == "UNIQUE" {
                format!("ALTER TABLE {qtn} DROP CONSTRAINT {n}; ALTER TABLE {qtn} ADD CONSTRAINT {n} UNIQUE ({cols});",
                    n = quote(family, &sc.name), cols = sc.definition.split(", ").map(|x| quote(family, x.trim())).collect::<Vec<_>>().join(", "))
            } else {
                format!("ALTER TABLE {qtn} DROP CONSTRAINT {n}; ALTER TABLE {qtn} ADD CONSTRAINT {n} CHECK ({d});",
                    n = quote(family, &sc.name), d = sc.definition.trim())
            };
            items.push(item("constraint", &format!("{}.{}", table.name, sc.name), "changed",
                vec![detail_line("definition", &tc.definition, &sc.definition)],
                vec![sql], true));
        }
        _ => {}
    }
}

impl SnapshotFk {
    fn definition_differs(&self, other: &SnapshotFk) -> bool {
        self.columns != other.columns
            || self.ref_table != other.ref_table
            || self.ref_columns != other.ref_columns
            || self.on_delete != other.on_delete
            || self.on_update != other.on_update
    }
}

#[cfg(test)]
#[path = "schema_diff.test.rs"]
mod schema_diff_tests;
