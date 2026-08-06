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

#[derive(Deserialize)]
pub struct ViewParams {
    pub schema: String,
    pub name: String,
    pub materialized: bool,
    pub action: ViewAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ViewAction {
    Create { definition: String },
    Replace { definition: String },
    Refresh,
    Drop,
}

pub fn view_ddl(p: &ViewParams) -> Result<Vec<String>, String> {
    let q = qual(&p.schema, &p.name)?;
    Ok(match &p.action {
        ViewAction::Create { definition } if !p.materialized =>
            vec![format!("CREATE OR REPLACE VIEW {} AS\n{}", q, definition)],
        ViewAction::Create { definition } =>
            vec![format!("CREATE MATERIALIZED VIEW {} AS\n{}", q, definition)],
        ViewAction::Replace { definition } if !p.materialized =>
            vec![format!("CREATE OR REPLACE VIEW {} AS\n{}", q, definition)],
        ViewAction::Replace { definition } => vec![
            format!("DROP MATERIALIZED VIEW {}", q),
            format!("CREATE MATERIALIZED VIEW {} AS\n{}", q, definition),
        ],
        ViewAction::Refresh if p.materialized => vec![format!("REFRESH MATERIALIZED VIEW {}", q)],
        ViewAction::Refresh => return Err("Cannot REFRESH a non-materialized view".into()),
        ViewAction::Drop if p.materialized => vec![format!("DROP MATERIALIZED VIEW {}", q)],
        ViewAction::Drop => vec![format!("DROP VIEW {}", q)],
    })
}

#[derive(Deserialize)]
pub struct ExtensionParams {
    pub schema: String,
    pub name: String,
    pub action: ExtensionAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ExtensionAction {
    Create { version: Option<String> },
    SetSchema { new_schema: String },
    Drop,
}

pub fn extension_ddl(p: &ExtensionParams) -> Result<Vec<String>, String> {
    validate_object_name(&p.schema)?;
    validate_object_name(&p.name)?;
    let name = quote_ident(&p.name);
    let schema = quote_ident(&p.schema);
    Ok(vec![match &p.action {
        ExtensionAction::Create { version: None } =>
            format!("CREATE EXTENSION IF NOT EXISTS {} WITH SCHEMA {}", name, schema),
        ExtensionAction::Create { version: Some(v) } =>
            format!("CREATE EXTENSION IF NOT EXISTS {} WITH SCHEMA {} VERSION '{}'", name, schema, v.replace('\'', "''")),
        ExtensionAction::SetSchema { new_schema } => {
            validate_object_name(new_schema)?;
            format!("ALTER EXTENSION {} SET SCHEMA {}", name, quote_ident(new_schema))
        }
        ExtensionAction::Drop => format!("DROP EXTENSION {}", name),
    }])
}

/// Quote a list of identifiers, joined with ", ".
fn quoted_cols(v: &[String]) -> String {
    v.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ")
}

#[derive(Deserialize)]
pub struct IndexParams {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub action: IndexAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum IndexAction {
    Create { unique: bool, method: String, columns: Vec<String>, predicate: Option<String> },
    Drop,
}

pub fn index_ddl(p: &IndexParams) -> Result<Vec<String>, String> {
    validate_object_name(&p.schema)?;
    validate_object_name(&p.table)?;
    validate_object_name(&p.name)?;
    let table = format!("{}.{}", quote_ident(&p.schema), quote_ident(&p.table));
    let name = quote_ident(&p.name);
    Ok(vec![match &p.action {
        IndexAction::Create { unique, method, columns, predicate } => {
            if columns.is_empty() { return Err("Index requires at least one column".into()); }
            let cols = quoted_cols(columns);
            let unique = if *unique { "UNIQUE " } else { "" };
            let method = if method.trim().is_empty() { String::new() } else { format!(" USING {}", method.trim()) };
            let pred = match predicate {
                Some(p) if !p.trim().is_empty() => format!(" WHERE {}", validate_expression(p)?),
                _ => String::new(),
            };
            format!("CREATE {}INDEX {} ON {}{} ({}){}", unique, name, table, method, cols, pred)
        }
        IndexAction::Drop => format!("DROP INDEX {}.{}", quote_ident(&p.schema), name),
    }])
}

#[derive(Deserialize)]
pub struct ConstraintParams {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub action: ConstraintAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ConstraintAction {
    Check { expression: String },
    Unique { columns: Vec<String> },
    PrimaryKey { columns: Vec<String> },
    ForeignKey { columns: Vec<String>, ref_schema: String, ref_table: String, ref_columns: Vec<String>, on_delete: Option<String>, on_update: Option<String>, deferrable: Option<bool>, initially_deferred: Option<bool> },
    Drop,
}

pub fn constraint_ddl(p: &ConstraintParams) -> Result<Vec<String>, String> {
    validate_object_name(&p.schema)?;
    validate_object_name(&p.table)?;
    validate_object_name(&p.name)?;
    let table = format!("{}.{}", quote_ident(&p.schema), quote_ident(&p.table));
    let name = quote_ident(&p.name);
    Ok(vec![match &p.action {
        ConstraintAction::Check { expression } =>
            format!("ALTER TABLE {} ADD CONSTRAINT {} CHECK ({})", table, name, validate_expression(expression)?),
        ConstraintAction::Unique { columns } => {
            if columns.is_empty() { return Err("UNIQUE constraint requires a column".into()); }
            format!("ALTER TABLE {} ADD CONSTRAINT {} UNIQUE ({})", table, name, quoted_cols(columns))
        }
        ConstraintAction::PrimaryKey { columns } => {
            if columns.is_empty() { return Err("PRIMARY KEY requires a column".into()); }
            format!("ALTER TABLE {} ADD CONSTRAINT {} PRIMARY KEY ({})", table, name, quoted_cols(columns))
        }
        ConstraintAction::ForeignKey { columns, ref_schema, ref_table, ref_columns, on_delete, on_update, deferrable, initially_deferred } => {
            if columns.is_empty() || ref_columns.is_empty() { return Err("FOREIGN KEY requires source and referenced columns".into()); }
            validate_object_name(ref_schema)?;
            validate_object_name(ref_table)?;
            let refq = format!("{}.{}", quote_ident(ref_schema), quote_ident(ref_table));
            let mut sql = format!("ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})", table, name, quoted_cols(columns), refq, quoted_cols(ref_columns));
            if let Some(d) = on_delete { sql.push_str(&format!(" ON DELETE {}", d)); }
            if let Some(u) = on_update { sql.push_str(&format!(" ON UPDATE {}", u)); }
            match (deferrable, initially_deferred) {
                (Some(true), Some(true)) => sql.push_str(" DEFERRABLE INITIALLY DEFERRED"),
                (Some(true), _) => sql.push_str(" DEFERRABLE INITIALLY IMMEDIATE"),
                _ => {}
            }
            sql
        }
        ConstraintAction::Drop => format!("ALTER TABLE {} DROP CONSTRAINT {}", table, name),
    }])
}

#[derive(Deserialize)]
pub struct FunctionArg { pub mode: String, pub name: String, #[serde(rename = "type")] pub type_: String }

#[derive(Deserialize)]
pub struct FunctionParams {
    pub schema: String,
    pub name: String,
    pub is_procedure: bool,
    pub action: FunctionAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FunctionAction {
    CreateOrReplace { args: Vec<FunctionArg>, return_type: Option<String>, language: String, body: String, volatility: Option<String>, strict: bool },
    Drop { arg_types: Vec<String> },
}

fn arg_sql(a: &FunctionArg) -> String {
    let mode = match a.mode.trim().to_lowercase().as_str() {
        "in" | "" => String::new(),
        m => format!("{} ", m.to_uppercase()),
    };
    format!("{}{} {}", mode, a.name, a.type_)
}

pub fn function_ddl(p: &FunctionParams) -> Result<Vec<String>, String> {
    let q = qual(&p.schema, &p.name)?;
    let kind = if p.is_procedure { "PROCEDURE" } else { "FUNCTION" };
    Ok(vec![match &p.action {
        FunctionAction::CreateOrReplace { args, return_type, language, body, volatility, strict } => {
            let arglist: Vec<String> = args.iter().map(arg_sql).collect();
            let ret = match (p.is_procedure, return_type) {
                (false, Some(r)) => format!(" RETURNS {}", r),
                _ => String::new(),
            };
            let vol = match volatility.as_deref() {
                Some("IMMUTABLE") => " IMMUTABLE", Some("STABLE") => " STABLE", Some("VOLATILE") => " VOLATILE", _ => "",
            };
            let strict = if *strict { " STRICT" } else { "" };
            format!("CREATE OR REPLACE {} {}({}){} LANGUAGE {}{}{} AS $${}$$", kind, q, arglist.join(", "), ret, language, vol, strict, body)
        }
        FunctionAction::Drop { arg_types } => format!("DROP {} {}({})", kind, q, arg_types.join(", ")),
    }])
}

#[derive(Deserialize)]
pub struct TriggerParams {
    pub schema: String,
    pub name: String,
    pub action: TriggerAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TriggerAction {
    Create { table: String, timing: String, events: Vec<String>, orientation: String, function_schema: String, function_name: String, function_args: Vec<String>, when: Option<String> },
    Enable { table: String },
    Disable { table: String },
    Drop { table: String },
}

pub fn trigger_ddl(p: &TriggerParams) -> Result<Vec<String>, String> {
    validate_object_name(&p.schema)?;
    validate_object_name(&p.name)?;
    let schema = quote_ident(&p.schema);
    let name = quote_ident(&p.name);
    Ok(vec![match &p.action {
        TriggerAction::Create { table, timing, events, orientation, function_schema, function_name, function_args, when } => {
            validate_object_name(table)?;
            validate_object_name(function_schema)?;
            validate_object_name(function_name)?;
            let evs = events.join(" OR ");
            let orient = match orientation.trim().to_uppercase().as_str() { "STATEMENT" => "FOR EACH STATEMENT", _ => "FOR EACH ROW" };
            let when_clause = match when {
                Some(w) if !w.trim().is_empty() => format!(" WHEN ({})", w),
                _ => String::new(),
            };
            let fq = format!("{}.{}", quote_ident(function_schema), quote_ident(function_name));
            format!("CREATE TRIGGER {} {} {} ON {}.{} {}{} EXECUTE FUNCTION {}({})",
                name, timing, evs, schema, quote_ident(table), orient, when_clause, fq, function_args.join(", "))
        }
        TriggerAction::Enable { table } => format!("ALTER TABLE {}.{} ENABLE TRIGGER {}", schema, quote_ident(table), name),
        TriggerAction::Disable { table } => format!("ALTER TABLE {}.{} DISABLE TRIGGER {}", schema, quote_ident(table), name),
        TriggerAction::Drop { table } => format!("DROP TRIGGER {} ON {}.{}", name, schema, quote_ident(table)),
    }])
}

use std::collections::HashSet;

fn validate_type(t: &str) -> Result<String, String> {
    let s = t.trim();
    if s.is_empty() { return Err("Column type must not be empty".into()); }
    if s.ends_with(';') { return Err("Column type must not end with ';'".into()); }
    if s.contains("--") || s.contains("/*") { return Err("Column type must not contain comments".into()); }
    Ok(s.to_string())
}

#[derive(Deserialize, Clone)]
pub struct TableColumn {
    pub name: String,
    #[serde(rename = "type")] pub type_: String,
    pub nullable: bool,
    pub default: Option<Option<String>>, // null | Some(null) | Some(expr)
    pub is_pk: bool,
    pub unique: Option<bool>,
}

impl TableColumn {
    fn default_sql(&self) -> Option<&str> {
        match &self.default { Some(Some(d)) => Some(d.as_str()), _ => None }
    }
}

#[derive(Deserialize)]
pub struct TableParams { pub schema: String, pub name: String, pub action: TableAction }

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TableAction {
    Create { columns: Vec<TableColumn>, tablespace: Option<String> },
    Edit { columns: Vec<TableColumn>, old_columns: Vec<TableColumn> },
    Options { tablespace: Option<String>, rls: Option<String> },
    Drop,
}

fn col_def(c: &TableColumn) -> Result<String, String> {
    validate_object_name(&c.name)?;
    let ty = validate_type(&c.type_)?;
    let mut s = format!("{} {}", quote_ident(&c.name), ty);
    if c.unique == Some(true) { s.push_str(" UNIQUE"); }
    if !c.nullable { s.push_str(" NOT NULL"); }
    if let Some(d) = c.default_sql() { s.push_str(&format!(" DEFAULT {}", validate_expression(d)?)); }
    Ok(s)
}

pub fn table_ddl(p: &TableParams) -> Result<Vec<String>, String> {
    let q = qual(&p.schema, &p.name)?;
    Ok(match &p.action {
        TableAction::Create { columns, tablespace } => {
            if columns.is_empty() { return Err("CREATE TABLE requires at least one column".into()); }
            let mut seen = HashSet::new();
            for c in columns {
                validate_object_name(&c.name)?;
                if !seen.insert(c.name.clone()) { return Err(format!("Duplicate column name: {}", c.name)); }
            }
            let mut defs: Vec<String> = columns.iter().map(col_def).collect::<Result<_, _>>()?;
            let pk: Vec<String> = columns.iter().filter(|c| c.is_pk).map(|c| quote_ident(&c.name)).collect();
            if !pk.is_empty() { defs.push(format!("PRIMARY KEY ({})", pk.join(", "))); }
            let mut sql = format!("CREATE TABLE {} (\n  {}\n)", q, defs.join(",\n  "));
            if let Some(ts) = tablespace { validate_object_name(ts)?; sql.push_str(&format!(" TABLESPACE {}", quote_ident(ts))); }
            vec![sql]
        }
        TableAction::Edit { columns, old_columns } => table_diff(&q, old_columns, columns)?,
        TableAction::Options { tablespace, rls } => {
            let mut out = Vec::new();
            if let Some(ts) = tablespace { validate_object_name(ts)?; out.push(format!("ALTER TABLE {} SET TABLESPACE {}", q, quote_ident(ts))); }
            match rls.as_deref() {
                Some("enable") | Some("force") => out.push(format!("ALTER TABLE {} ENABLE ROW LEVEL SECURITY", q)),
                _ => {}
            }
            if rls.as_deref() == Some("force") { out.push(format!("ALTER TABLE {} FORCE ROW LEVEL SECURITY", q)); }
            if rls.as_deref() == Some("disable") { out.push(format!("ALTER TABLE {} DISABLE ROW LEVEL SECURITY", q)); }
            out
        }
        TableAction::Drop => vec![format!("DROP TABLE {}", q)],
    })
}

fn table_diff(q: &str, old: &[TableColumn], new: &[TableColumn]) -> Result<Vec<String>, String> {
    for c in new { validate_object_name(&c.name)?; validate_type(&c.type_)?; }
    let mut old_by_name: std::collections::HashMap<&str, &TableColumn> = old.iter().map(|c| (c.name.as_str(), c)).collect();
    let mut out: Vec<String> = Vec::new();
    let mut used_old: HashSet<usize> = HashSet::new();
    // 1. RENAMEs: unmatched new col at ordinal i matching an unmatched old col at ordinal i with identical type/nullable/default
    let mut renames: Vec<(usize, String, String)> = Vec::new(); // (old_idx, old_name, new_name)
    for (i, nc) in new.iter().enumerate() {
        if old_by_name.contains_key(nc.name.as_str()) { continue; }
        if let Some(oc) = old.get(i) {
            if !used_old.contains(&i) && oc.type_.trim() == nc.type_.trim()
                && oc.nullable == nc.nullable && oc.default_sql() == nc.default_sql() {
                renames.push((i, oc.name.clone(), nc.name.clone()));
                used_old.insert(i);
                old_by_name.remove(oc.name.as_str());
            }
        }
    }
    for (_, oldn, newn) in &renames {
        out.push(format!("ALTER TABLE {} RENAME COLUMN \"{}\" TO \"{}\"", q, oldn, newn));
    }
    // 2. ADDs: remaining unmatched new cols
    for nc in new {
        if old_by_name.contains_key(nc.name.as_str()) || renames.iter().any(|r| r.2 == nc.name) { continue; }
        let s = format!("ALTER TABLE {} ADD COLUMN {}", q, col_def(nc)?);
        out.push(s);
    }
    // 3. ALTERs for kept (name-matched) cols
    for nc in new {
        let Some(oc) = old.iter().find(|c| c.name == nc.name) else { continue; };
        if oc.type_.trim() != nc.type_.trim() {
            out.push(format!("ALTER TABLE {} ALTER COLUMN {} TYPE {}", q, quote_ident(&nc.name), validate_type(&nc.type_)?));
        }
        match (oc.default_sql(), nc.default_sql()) {
            (None, Some(d)) => out.push(format!("ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}", q, quote_ident(&nc.name), validate_expression(d)?)),
            (Some(_), None) => out.push(format!("ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT", q, quote_ident(&nc.name))),
            (Some(a), Some(b)) if a != b => out.push(format!("ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}", q, quote_ident(&nc.name), validate_expression(b)?)),
            _ => {}
        }
        match (oc.nullable, nc.nullable) {
            (true, false) => out.push(format!("ALTER TABLE {} ALTER COLUMN {} SET NOT NULL", q, quote_ident(&nc.name))),
            (false, true) => out.push(format!("ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL", q, quote_ident(&nc.name))),
            _ => {}
        }
    }
    // 4. DROPs last: old cols not present in new and not renamed-away
    let new_names: HashSet<&str> = new.iter().map(|c| c.name.as_str()).collect();
    for oc in old {
        if !new_names.contains(oc.name.as_str()) && !renames.iter().any(|r| r.1 == oc.name) {
            out.push(format!("ALTER TABLE {} DROP COLUMN {}", q, quote_ident(&oc.name)));
        }
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct RebuildConstraint { pub name: String, pub definition: String }

#[derive(Debug, Clone)]
pub struct RebuildIndex { pub name: String, pub definition: String }

#[derive(Debug, Clone)]
pub struct RebuildFk { pub name: String, pub definition: String }

#[derive(Debug, Clone)]
pub struct RebuildFkIn {
    pub name: String,
    pub own_schema: String,
    pub own_table: String,
    pub definition: String,
}

#[derive(Debug, Clone)]
pub struct RebuildGrant {
    pub grantee: String,
    pub privileges: Vec<String>,
    pub grantable: bool,
}

#[derive(Debug, Clone)]
pub struct RebuildOwnedSequence {
    pub seq_schema: String,
    pub seq_name: String,
    pub column: String,
}

/// Everything needed to reconstruct a table's metadata after a reorder-only rebuild.
/// Rebuild is reorder-only: column names + types in `new_columns` must equal the live
/// snapshot (validated by the Task 2.4 command). These structs are assembled in Rust
/// from introspection rows, so they derive Clone/Debug only (no IPC Deserialize).
#[derive(Debug, Clone)]
pub struct RebuildInput {
    pub schema: String,
    pub name: String,
    pub constraints: Vec<RebuildConstraint>,
    pub indexes: Vec<RebuildIndex>,
    pub fks_out: Vec<RebuildFk>,
    pub fks_in: Vec<RebuildFkIn>,
    pub grants: Vec<RebuildGrant>,
    pub owned_sequences: Vec<RebuildOwnedSequence>,
}

/// Assemble the full rebuild script for a reorder-only table rebuild.
///
/// Order (transactional at the caller — the script itself is BEGIN-free):
/// detach owned sequences → drop inbound FKs → create temp table in the new column
/// order → INSERT..SELECT (cast-free: names/types unchanged) → DROP original → RENAME
/// temp → recreate PK/unique/check constraints → recreate indexes → re-add outbound
/// FKs → re-add inbound FKs → re-grant privileges → re-attach owned sequences.
///
/// The caller executes this via transactional `batch_execute` (Task 2.4), so the
/// script must NOT contain BEGIN/COMMIT.
pub fn rebuild_script(input: &RebuildInput, new_columns: &[TableColumn]) -> Result<String, String> {
    validate_object_name(&input.schema)?;
    validate_object_name(&input.name)?;
    for c in new_columns {
        validate_object_name(&c.name)?;
        validate_type(&c.type_)?;
    }
    let q = qual(&input.schema, &input.name)?;
    let tmp = qual(&input.schema, &format!("_gridline_rb_{}", input.name))?;
    let mut s = String::new();
    // 1. detach owned sequences (OWNED BY NONE keeps the sequence alive but decoupled)
    for seq in &input.owned_sequences {
        validate_object_name(&seq.seq_schema)?;
        validate_object_name(&seq.seq_name)?;
        s.push_str(&format!("ALTER SEQUENCE \"{}\".\"{}\" OWNED BY NONE;\n", seq.seq_schema, seq.seq_name));
    }
    // 2. drop FKs IN (from other tables) before DROP TABLE
    for fk in &input.fks_in {
        validate_object_name(&fk.own_schema)?;
        validate_object_name(&fk.own_table)?;
        validate_object_name(&fk.name)?;
        s.push_str(&format!("ALTER TABLE \"{}\".\"{}\" DROP CONSTRAINT \"{}\";\n", fk.own_schema, fk.own_table, fk.name));
    }
    // 3. create temp table (new order, NOT NULL + DEFAULT only)
    let defs: Vec<String> = new_columns.iter().map(col_def).collect::<Result<_, _>>()?;
    s.push_str(&format!("CREATE TABLE {} (\n  {}\n);\n", tmp, defs.join(",\n  ")));
    // 4. copy data (names unchanged = cast-free SELECT in new order)
    let cols: Vec<String> = new_columns.iter().map(|c| quote_ident(&c.name)).collect();
    s.push_str(&format!("INSERT INTO {} ({}) SELECT {} FROM {};\n", tmp, cols.join(", "), cols.join(", "), q));
    // 5. drop old + 6. rename temp
    s.push_str(&format!("DROP TABLE {};\n", q));
    s.push_str(&format!("ALTER TABLE {} RENAME TO \"{}\";\n", tmp, input.name));
    // 7. recreate constraints (PK/unique/check)
    for c in &input.constraints {
        validate_object_name(&c.name)?;
        s.push_str(&format!("ALTER TABLE {} ADD CONSTRAINT \"{}\" {};\n", q, c.name, c.definition));
    }
    // 8. recreate indexes (pg_get_indexdef references schema.name = the renamed table)
    for idx in &input.indexes {
        s.push_str(&format!("{};\n", idx.definition));
    }
    // 9. recreate FKs OUT (this table's FKs)
    for fk in &input.fks_out {
        validate_object_name(&fk.name)?;
        s.push_str(&format!("ALTER TABLE {} ADD CONSTRAINT \"{}\" {};\n", q, fk.name, fk.definition));
    }
    // 10. recreate FKs IN (other tables)
    for fk in &input.fks_in {
        s.push_str(&format!("ALTER TABLE \"{}\".\"{}\" ADD CONSTRAINT \"{}\" {};\n", fk.own_schema, fk.own_table, fk.name, fk.definition));
    }
    // 11. re-apply grants
    for g in &input.grants {
        validate_object_name(&g.grantee)?;
        let opt = if g.grantable { " WITH GRANT OPTION" } else { "" };
        s.push_str(&format!("GRANT {} ON {} TO {}{};\n", g.privileges.join(", "), q, quote_ident(&g.grantee), opt));
    }
    // 12. re-attach owned sequences
    for seq in &input.owned_sequences {
        validate_object_name(&seq.column)?;
        s.push_str(&format!("ALTER SEQUENCE \"{}\".\"{}\" OWNED BY {}.\"{}\";\n", seq.seq_schema, seq.seq_name, q, seq.column));
    }
    Ok(s.trim_end().to_string())
}

#[derive(Deserialize)]
pub struct RoleParams {
    pub schema: String,
    pub name: String,
    pub action: RoleAction,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum RoleAction {
    Create { login: bool, superuser: bool, createdb: bool, createrole: bool, inherit: bool,
             replication: bool, bypassrls: bool, connection_limit: i64, valid_until: String,
             password: String, members: Vec<String> },
    Edit { login: bool, superuser: bool, createdb: bool, createrole: bool, inherit: bool,
           replication: bool, bypassrls: bool, connection_limit: i64, valid_until: String,
           password: String, members: Vec<String> },
    Drop,
    Grant { object_class: String, object_schema: Option<String>, object_name: String,
            privileges: Vec<String>, grantee: String, grant_option: bool },
    Revoke { object_class: String, object_schema: Option<String>, object_name: String,
             privileges: Vec<String>, grantee: String, grant_option: bool },
}

/// Compose the option-clause portion of CREATE/ALTER ROLE.
fn role_options(a: &RoleAction) -> String {
    let (login, superuser, createdb, createrole, inherit, replication, bypassrls, conn, until, pw) = match a {
        RoleAction::Create { login, superuser, createdb, createrole, inherit, replication, bypassrls, connection_limit, valid_until, password, .. }
        | RoleAction::Edit { login, superuser, createdb, createrole, inherit, replication, bypassrls, connection_limit, valid_until, password, .. } =>
            (*login, *superuser, *createdb, *createrole, *inherit, *replication, *bypassrls, *connection_limit, valid_until.clone(), password.clone()),
        _ => return String::new(),
    };
    let mut o: Vec<String> = Vec::new();
    if login { o.push("LOGIN".into()); }
    if superuser { o.push("SUPERUSER".into()); }
    if createdb { o.push("CREATEDB".into()); }
    if createrole { o.push("CREATEROLE".into()); }
    o.push(if inherit { "INHERIT".into() } else { "NOINHERIT".into() });
    if replication { o.push("REPLICATION".into()); }
    if bypassrls { o.push("BYPASSRLS".into()); }
    o.push(format!("CONNECTION LIMIT {}", conn));
    if !pw.is_empty() { o.push(format!("PASSWORD '{}'", pw.replace('\'', "''"))); }
    if !until.is_empty() { o.push(format!("VALID UNTIL '{}'", until.replace('\'', "''"))); }
    o.join(" ")
}

/// Qualified object reference for GRANT/REVOKE. Schemaless classes (schema, database)
/// quote the bare name; everything else is emitted as schema.name.
fn grant_object_ref(class: &str, schema: Option<&str>, name: &str) -> Result<String, String> {
    validate_object_name(name)?;
    match class {
        "schema" | "database" => Ok(quote_ident(name)),
        _ => {
            let s = match schema {
                Some(s) => { validate_object_name(s)?; quote_ident(s) }
                None => String::new(),
            };
            Ok(format!("{}.{}", s, quote_ident(name)))
        }
    }
}

pub fn role_ddl(p: &RoleParams) -> Result<Vec<String>, String> {
    if !p.name.is_empty() { validate_object_name(&p.name)?; }
    let name = quote_ident(&p.name);
    Ok(match &p.action {
        RoleAction::Create { members, .. } => {
            let mut out = vec![format!("CREATE ROLE {} {}", name, role_options(&p.action))];
            for m in members {
                validate_object_name(m)?;
                out.push(format!("GRANT {} TO {}", quote_ident(m), name));
            }
            out
        }
        RoleAction::Edit { members, .. } => {
            // membership edits are advisory in v1 (no diff); skip
            let _ = members;
            vec![format!("ALTER ROLE {} {}", name, role_options(&p.action))]
        }
        RoleAction::Drop => vec![format!("DROP ROLE {}", name)],
        RoleAction::Grant { object_class, object_schema, object_name, privileges, grantee, grant_option } => {
            validate_object_name(grantee)?;
            let obj = grant_object_ref(object_class, object_schema.as_deref(), object_name)?;
            let privs = privileges.join(", ");
            let opt = if *grant_option { " WITH GRANT OPTION" } else { "" };
            vec![format!("GRANT {} ON {} TO {}{}", privs, obj, quote_ident(grantee), opt)]
        }
        RoleAction::Revoke { object_class, object_schema, object_name, privileges, grantee, grant_option } => {
            validate_object_name(grantee)?;
            let obj = grant_object_ref(object_class, object_schema.as_deref(), object_name)?;
            let privs = privileges.join(", ");
            let opt = if *grant_option { " GRANT OPTION FOR" } else { "" };
            vec![format!("REVOKE{} {} ON {} FROM {}", opt, privs, obj, quote_ident(grantee))]
        }
    })
}

/// Dispatch a DDL build by kind. `params` is the JSON payload from the frontend.
/// Returns one or more single SQL statements.
pub fn build_ddl(kind: &str, params: serde_json::Value) -> Result<Vec<String>, String> {
    match kind {
        "role" => {
            let p: RoleParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            role_ddl(&p)
        }
        "sequence" => {
            let p: SequenceParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            sequence_ddl(&p)
        }
        "enum" => {
            let p: EnumParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            enum_ddl(&p)
        }
        "view" => {
            let p: ViewParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            view_ddl(&p)
        }
        "extension" => {
            let p: ExtensionParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            extension_ddl(&p)
        }
        "index" => {
            let p: IndexParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            index_ddl(&p)
        }
        "constraint" => {
            let p: ConstraintParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            constraint_ddl(&p)
        }
        "function" | "procedure" => {
            let mut p: FunctionParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            p.is_procedure = kind == "procedure";
            function_ddl(&p)
        }
        "trigger" => {
            let p: TriggerParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            trigger_ddl(&p)
        }
        "table" => {
            let p: TableParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
            table_ddl(&p)
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

    #[test]
    fn view_create_or_replace() {
        let p = serde_json::json!({ "schema": "public", "name": "v_users", "materialized": false, "action": { "op": "create", "definition": "SELECT * FROM users" } });
        assert_eq!(build_ddl("view", p).unwrap(), vec!["CREATE OR REPLACE VIEW \"public\".\"v_users\" AS\nSELECT * FROM users"]);
    }

    #[test]
    fn matview_create() {
        let p = serde_json::json!({ "schema": "public", "name": "mv_sales", "materialized": true, "action": { "op": "create", "definition": "SELECT count(*) FROM sales" } });
        assert_eq!(build_ddl("view", p).unwrap(), vec!["CREATE MATERIALIZED VIEW \"public\".\"mv_sales\" AS\nSELECT count(*) FROM sales"]);
    }

    #[test]
    fn matview_replace_is_drop_then_create() {
        let p = serde_json::json!({ "schema": "public", "name": "mv_sales", "materialized": true, "action": { "op": "replace", "definition": "SELECT count(*) FROM sales" } });
        assert_eq!(build_ddl("view", p).unwrap(), vec![
            "DROP MATERIALIZED VIEW \"public\".\"mv_sales\"",
            "CREATE MATERIALIZED VIEW \"public\".\"mv_sales\" AS\nSELECT count(*) FROM sales",
        ]);
    }

    #[test]
    fn matview_refresh() {
        let p = serde_json::json!({ "schema": "public", "name": "mv_sales", "materialized": true, "action": { "op": "refresh" } });
        assert_eq!(build_ddl("view", p).unwrap(), vec!["REFRESH MATERIALIZED VIEW \"public\".\"mv_sales\""]);
    }

    #[test]
    fn view_refresh_errors() {
        let p = serde_json::json!({ "schema": "public", "name": "v_users", "materialized": false, "action": { "op": "refresh" } });
        assert!(build_ddl("view", p).is_err());
    }

    #[test]
    fn view_drop() {
        let p = serde_json::json!({ "schema": "public", "name": "v_users", "materialized": false, "action": { "op": "drop" } });
        assert_eq!(build_ddl("view", p).unwrap(), vec!["DROP VIEW \"public\".\"v_users\""]);
    }

    #[test]
    fn extension_create_with_version() {
        let p = serde_json::json!({ "schema": "public", "name": "pgcrypto", "action": { "op": "create", "version": "1.3" } });
        assert_eq!(build_ddl("extension", p).unwrap(), vec!["CREATE EXTENSION IF NOT EXISTS \"pgcrypto\" WITH SCHEMA \"public\" VERSION '1.3'"]);
    }

    #[test]
    fn extension_create_without_version() {
        let p = serde_json::json!({ "schema": "public", "name": "pgcrypto", "action": { "op": "create", "version": null } });
        assert_eq!(build_ddl("extension", p).unwrap(), vec!["CREATE EXTENSION IF NOT EXISTS \"pgcrypto\" WITH SCHEMA \"public\""]);
    }

    #[test]
    fn extension_set_schema() {
        let p = serde_json::json!({ "schema": "public", "name": "pgcrypto", "action": { "op": "set_schema", "new_schema": "utils" } });
        assert_eq!(build_ddl("extension", p).unwrap(), vec!["ALTER EXTENSION \"pgcrypto\" SET SCHEMA \"utils\""]);
    }

    #[test]
    fn extension_drop() {
        let p = serde_json::json!({ "schema": "public", "name": "pgcrypto", "action": { "op": "drop" } });
        assert_eq!(build_ddl("extension", p).unwrap(), vec!["DROP EXTENSION \"pgcrypto\""]);
    }

    #[test]
    fn index_create_unique_btree_with_predicate() {
        let p = serde_json::json!({
            "schema": "public", "table": "users", "name": "users_email_key",
            "action": { "op": "create", "unique": true, "method": "btree", "columns": ["email"], "predicate": "email IS NOT NULL" }
        });
        assert_eq!(build_ddl("index", p).unwrap(),
            vec!["CREATE UNIQUE INDEX \"users_email_key\" ON \"public\".\"users\" USING btree (\"email\") WHERE email IS NOT NULL"]);
    }

    #[test]
    fn index_create_no_method_no_predicate() {
        let p = serde_json::json!({
            "schema": "public", "table": "users", "name": "i_name",
            "action": { "op": "create", "unique": false, "method": "", "columns": ["a", "b"], "predicate": null }
        });
        assert_eq!(build_ddl("index", p).unwrap(),
            vec!["CREATE INDEX \"i_name\" ON \"public\".\"users\" (\"a\", \"b\")"]);
    }

    #[test]
    fn index_drop() {
        let p = serde_json::json!({ "schema": "public", "table": "users", "name": "i_name", "action": { "op": "drop" } });
        assert_eq!(build_ddl("index", p).unwrap(), vec!["DROP INDEX \"public\".\"i_name\""]);
    }

    #[test]
    fn index_create_rejects_empty_columns() {
        let p = serde_json::json!({ "schema": "public", "table": "users", "name": "i", "action": { "op": "create", "unique": false, "method": "", "columns": [], "predicate": null } });
        assert!(build_ddl("index", p).is_err());
    }

    #[test]
    fn constraint_check() {
        let p = serde_json::json!({ "schema": "public", "table": "orders", "name": "ck_pos", "action": { "op": "check", "expression": "amount > 0" } });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"ck_pos\" CHECK (amount > 0)"]);
    }

    #[test]
    fn constraint_unique() {
        let p = serde_json::json!({ "schema": "public", "table": "users", "name": "u_email", "action": { "op": "unique", "columns": ["email"] } });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"u_email\" UNIQUE (\"email\")"]);
    }

    #[test]
    fn constraint_primary_key() {
        let p = serde_json::json!({ "schema": "public", "table": "users", "name": "pk_users", "action": { "op": "primary_key", "columns": ["id"] } });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"pk_users\" PRIMARY KEY (\"id\")"]);
    }

    #[test]
    fn constraint_foreign_key() {
        let p = serde_json::json!({
            "schema": "public", "table": "orders", "name": "fk_user",
            "action": { "op": "foreign_key", "columns": ["user_id"], "ref_schema": "public", "ref_table": "users", "ref_columns": ["id"] }
        });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_user\" FOREIGN KEY (\"user_id\") REFERENCES \"public\".\"users\" (\"id\")"]);
    }

    #[test]
    fn constraint_foreign_key_with_actions() {
        let p = serde_json::json!({
            "schema": "public", "table": "orders", "name": "fk_user",
            "action": {
                "op": "foreign_key",
                "columns": ["user_id"],
                "ref_schema": "public",
                "ref_table": "users",
                "ref_columns": ["id"],
                "on_delete": "CASCADE",
                "on_update": "SET NULL",
                "deferrable": true,
                "initially_deferred": true
            }
        });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_user\" FOREIGN KEY (\"user_id\") REFERENCES \"public\".\"users\" (\"id\") ON DELETE CASCADE ON UPDATE SET NULL DEFERRABLE INITIALLY DEFERRED"]);
    }

    #[test]
    fn constraint_drop() {
        let p = serde_json::json!({ "schema": "public", "table": "orders", "name": "ck_pos", "action": { "op": "drop" } });
        assert_eq!(build_ddl("constraint", p).unwrap(),
            vec!["ALTER TABLE \"public\".\"orders\" DROP CONSTRAINT \"ck_pos\""]);
    }

    #[test]
    fn function_create_or_replace_basic() {
        let p = serde_json::json!({
            "schema": "public", "name": "add", "is_procedure": false,
            "action": { "op": "create_or_replace",
                "args": [ { "mode": "in", "name": "a", "type": "int" }, { "mode": "in", "name": "b", "type": "int" } ],
                "return_type": "int", "language": "plpgsql", "body": "BEGIN RETURN a+b; END",
                "volatility": "IMMUTABLE", "strict": true }
        });
        assert_eq!(build_ddl("function", p).unwrap(), vec![
            "CREATE OR REPLACE FUNCTION \"public\".\"add\"(a int, b int) RETURNS int LANGUAGE plpgsql IMMUTABLE STRICT AS $$BEGIN RETURN a+b; END$$"
        ]);
    }

    #[test]
    fn procedure_create_or_replace_no_returns() {
        let p = serde_json::json!({
            "schema": "public", "name": "do_thing", "is_procedure": true,
            "action": { "op": "create_or_replace",
                "args": [ { "mode": "in", "name": "x", "type": "int" } ],
                "return_type": null, "language": "plpgsql", "body": "BEGIN PERFORM x; END",
                "volatility": null, "strict": false }
        });
        assert_eq!(build_ddl("procedure", p).unwrap(), vec![
            "CREATE OR REPLACE PROCEDURE \"public\".\"do_thing\"(x int) LANGUAGE plpgsql AS $$BEGIN PERFORM x; END$$"
        ]);
    }

    #[test]
    fn function_drop_by_signature() {
        let p = serde_json::json!({ "schema": "public", "name": "add", "is_procedure": false, "action": { "op": "drop", "arg_types": ["int", "int"] } });
        assert_eq!(build_ddl("function", p).unwrap(), vec!["DROP FUNCTION \"public\".\"add\"(int, int)"]);
    }

    #[test]
    fn procedure_drop_by_signature() {
        let p = serde_json::json!({ "schema": "public", "name": "do_thing", "is_procedure": true, "action": { "op": "drop", "arg_types": ["int"] } });
        assert_eq!(build_ddl("procedure", p).unwrap(), vec!["DROP PROCEDURE \"public\".\"do_thing\"(int)"]);
    }

    #[test]
    fn trigger_create_row() {
        let p = serde_json::json!({
            "schema": "public", "name": "tr_audit",
            "action": { "op": "create", "table": "orders", "timing": "BEFORE",
                "events": ["INSERT", "UPDATE"], "orientation": "ROW",
                "function_schema": "public", "function_name": "audit_fn",
                "function_args": [], "when": null }
        });
        assert_eq!(build_ddl("trigger", p).unwrap(), vec![
            "CREATE TRIGGER \"tr_audit\" BEFORE INSERT OR UPDATE ON \"public\".\"orders\" FOR EACH ROW EXECUTE FUNCTION \"public\".\"audit_fn\"()"
        ]);
    }

    #[test]
    fn trigger_create_with_when_and_args() {
        let p = serde_json::json!({
            "schema": "public", "name": "tr_audit",
            "action": { "op": "create", "table": "orders", "timing": "AFTER",
                "events": ["UPDATE"], "orientation": "STATEMENT",
                "function_schema": "public", "function_name": "audit_fn",
                "function_args": ["'log'"], "when": "OLD.amount IS DISTINCT FROM NEW.amount" }
        });
        assert_eq!(build_ddl("trigger", p).unwrap(), vec![
            "CREATE TRIGGER \"tr_audit\" AFTER UPDATE ON \"public\".\"orders\" FOR EACH STATEMENT WHEN (OLD.amount IS DISTINCT FROM NEW.amount) EXECUTE FUNCTION \"public\".\"audit_fn\"('log')"
        ]);
    }

    #[test]
    fn trigger_enable_disable_drop() {
        let base = |op: &str| serde_json::json!({ "schema": "public", "name": "tr_audit", "action": { "op": op, "table": "orders" } });
        assert_eq!(build_ddl("trigger", base("enable")).unwrap(), vec!["ALTER TABLE \"public\".\"orders\" ENABLE TRIGGER \"tr_audit\""]);
        assert_eq!(build_ddl("trigger", base("disable")).unwrap(), vec!["ALTER TABLE \"public\".\"orders\" DISABLE TRIGGER \"tr_audit\""]);
        assert_eq!(build_ddl("trigger", base("drop")).unwrap(), vec!["DROP TRIGGER \"tr_audit\" ON \"public\".\"orders\""]);
    }

    #[test]
    fn table_create_multi_col_pk_and_default() {
        let p = serde_json::json!({
            "schema": "public", "name": "users",
            "action": { "op": "create", "columns": [
                { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true },
                { "name": "email", "type": "text", "nullable": false, "default": null, "is_pk": false }
            ], "tablespace": null }
        });
        let sql = build_ddl("table", p).unwrap();
        assert_eq!(sql, vec![
            "CREATE TABLE \"public\".\"users\" (\n  \"id\" integer NOT NULL,\n  \"email\" text NOT NULL,\n  PRIMARY KEY (\"id\")\n)"
        ]);
    }

    #[test]
    fn table_create_with_tablespace() {
        let p = serde_json::json!({
            "schema": "public", "name": "t",
            "action": { "op": "create", "columns": [
                { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true }
            ], "tablespace": "fastdisk" }
        });
        let sql = build_ddl("table", p).unwrap();
        assert!(sql[0].ends_with(" TABLESPACE \"fastdisk\""));
    }

    #[test]
    fn table_create_unique_column_emits_unique_keyword() {
        let p = serde_json::json!({
            "schema": "public", "name": "users",
            "action": { "op": "create", "columns": [
                { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true },
                { "name": "email", "type": "text", "nullable": false, "default": null, "is_pk": false, "unique": true }
            ], "tablespace": null }
        });
        let sql = build_ddl("table", p).unwrap();
        assert!(sql[0].contains("\"email\" text UNIQUE NOT NULL"), "expected UNIQUE in column def; got: {}", sql[0]);
    }

    #[test]
    fn table_column_deserialization_ignores_unknown_fields() {
        let p = serde_json::json!({
            "schema": "public", "name": "t",
            "action": { "op": "create", "columns": [
                { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true, "params": "(50)", "auto_increment": true }
            ], "tablespace": null }
        });
        let sql = build_ddl("table", p).unwrap();
        assert!(sql[0].contains("\"id\" integer NOT NULL"), "expected column def; got: {}", sql[0]);
    }

    #[test]
    fn table_create_rejects_empty_and_duplicate_columns() {
        let empty = serde_json::json!({ "schema": "public", "name": "t", "action": { "op": "create", "columns": [], "tablespace": null } });
        assert!(build_ddl("table", empty).is_err());
        let dup = serde_json::json!({ "schema": "public", "name": "t", "action": { "op": "create", "columns": [
            { "name": "id", "type": "int", "nullable": false, "default": null, "is_pk": true },
            { "name": "id", "type": "int", "nullable": false, "default": null, "is_pk": false }
        ], "tablespace": null } });
        assert!(build_ddl("table", dup).is_err());
    }

    #[test]
    fn table_edit_emits_rename_add_alter_drop_in_order() {
        let p = serde_json::json!({
            "schema": "public", "name": "users",
            "action": { "op": "edit",
                "old_columns": [
                    { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true },
                    { "name": "name", "type": "text", "nullable": true, "default": null, "is_pk": false },
                    { "name": "age", "type": "int", "nullable": true, "default": null, "is_pk": false }
                ],
                "columns": [
                    { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true },
                    { "name": "label", "type": "text", "nullable": true, "default": null, "is_pk": false },
                    { "name": "email", "type": "text", "nullable": false, "default": "'x'", "is_pk": false }
                ]
            }
        });
        let sql = build_ddl("table", p).unwrap();
        let joined = sql.join("\n");
        let rename_idx = joined.find("ALTER TABLE \"public\".\"users\" RENAME COLUMN \"name\" TO \"label\"").unwrap();
        let add_idx = joined.find("ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" text NOT NULL DEFAULT 'x'").unwrap();
        let drop_idx = joined.find("ALTER TABLE \"public\".\"users\" DROP COLUMN \"age\"").unwrap();
        assert!(rename_idx < add_idx, "RENAME before ADD; got: {}", joined);
        assert!(add_idx < drop_idx, "ADD before DROP; got: {}", joined);
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"users\" RENAME COLUMN \"name\" TO \"label\""));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" text NOT NULL DEFAULT 'x'"));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"users\" DROP COLUMN \"age\""));
    }

    #[test]
    fn table_edit_emits_alter_type_default_notnull() {
        let p = serde_json::json!({
            "schema": "public", "name": "t",
            "action": { "op": "edit",
                "old_columns": [ { "name": "c", "type": "int", "nullable": true, "default": null, "is_pk": false } ],
                "columns": [ { "name": "c", "type": "bigint", "nullable": false, "default": "0", "is_pk": false } ]
            }
        });
        let sql = build_ddl("table", p).unwrap();
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"c\" TYPE bigint"));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"c\" SET DEFAULT 0"));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" ALTER COLUMN \"c\" SET NOT NULL"));
    }

    #[test]
    fn table_options_rls_and_tablespace() {
        let p = serde_json::json!({ "schema": "public", "name": "t", "action": { "op": "options", "tablespace": "fastdisk", "rls": "force" } });
        let sql = build_ddl("table", p).unwrap();
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" SET TABLESPACE \"fastdisk\""));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" ENABLE ROW LEVEL SECURITY"));
        assert!(sql.iter().any(|s| s == "ALTER TABLE \"public\".\"t\" FORCE ROW LEVEL SECURITY"));
    }

    #[test]
    fn table_drop() {
        let p = serde_json::json!({ "schema": "public", "name": "t", "action": { "op": "drop" } });
        assert_eq!(build_ddl("table", p).unwrap(), vec!["DROP TABLE \"public\".\"t\""]);
    }

    #[test]
    fn role_create_with_options_and_membership() {
        let p = serde_json::json!({
            "schema": "", "name": "app",
            "action": { "op": "create", "login": true, "superuser": false, "createdb": true,
                "createrole": false, "inherit": true, "replication": false, "bypassrls": false,
                "connection_limit": 10, "valid_until": "", "password": "s3cr3t", "members": ["reader"] }
        });
        let sql = build_ddl("role", p).unwrap();
        assert_eq!(sql[0], "CREATE ROLE \"app\" LOGIN CREATEDB INHERIT CONNECTION LIMIT 10 PASSWORD 's3cr3t'");
        assert!(sql.iter().any(|s| s == "GRANT \"reader\" TO \"app\""));
    }

    #[test]
    fn role_create_escapes_password_literal() {
        let p = serde_json::json!({ "schema": "", "name": "r", "action": { "op": "create",
            "login": false, "superuser": false, "createdb": false, "createrole": false, "inherit": true,
            "replication": false, "bypassrls": false, "connection_limit": -1, "valid_until": "", "password": "a'b", "members": [] } });
        let sql = build_ddl("role", p).unwrap();
        assert!(sql[0].contains("PASSWORD 'a''b'"));
    }

    #[test]
    fn role_edit_blank_password_omits_password_clause() {
        let p = serde_json::json!({ "schema": "", "name": "app",
            "action": { "op": "edit", "login": true, "superuser": false, "createdb": false,
                "createrole": false, "inherit": true, "replication": false, "bypassrls": false,
                "connection_limit": -1, "valid_until": "2027-01-01", "password": "", "members": [] } });
        let sql = build_ddl("role", p).unwrap();
        assert!(sql[0].contains("ALTER ROLE \"app\""));
        assert!(!sql[0].contains("PASSWORD")); // blank = keep
        assert!(sql[0].contains("VALID UNTIL '2027-01-01'"));
    }

    #[test]
    fn role_drop() {
        let p = serde_json::json!({ "schema": "", "name": "app", "action": { "op": "drop" } });
        assert_eq!(build_ddl("role", p).unwrap(), vec!["DROP ROLE \"app\""]);
    }

    #[test]
    fn role_grant_and_revoke() {
        let g = serde_json::json!({ "schema": "", "name": "",
            "action": { "op": "grant", "object_class": "table", "object_schema": "public", "object_name": "users",
                "privileges": ["SELECT", "INSERT"], "grantee": "app", "grant_option": false } });
        assert_eq!(build_ddl("role", g).unwrap(), vec!["GRANT SELECT, INSERT ON \"public\".\"users\" TO \"app\""]);
        let r = serde_json::json!({ "schema": "", "name": "",
            "action": { "op": "revoke", "object_class": "table", "object_schema": "public", "object_name": "users",
                "privileges": ["SELECT"], "grantee": "app", "grant_option": false } });
        assert_eq!(build_ddl("role", r).unwrap(), vec!["REVOKE SELECT ON \"public\".\"users\" FROM \"app\""]);
    }

    #[test]
    fn role_grant_rejects_bad_identifier() {
        let p = serde_json::json!({ "schema": "", "name": "",
            "action": { "op": "grant", "object_class": "table", "object_schema": "public", "object_name": "a; DROP",
                "privileges": ["SELECT"], "grantee": "app", "grant_option": false } });
        assert!(build_ddl("role", p).is_err());
    }

    #[test]
    fn rebuild_script_preserves_order_and_recreates_fk_index_grant() {
        let input = RebuildInput {
            schema: "public".into(), name: "users".into(),
            constraints: vec![ RebuildConstraint { name: "users_pkey".into(), definition: "PRIMARY KEY (id)".into() } ],
            indexes: vec![ RebuildIndex { name: "users_email_key".into(), definition: "CREATE UNIQUE INDEX users_email_key ON public.users (email)".into() } ],
            fks_out: vec![],
            fks_in: vec![ RebuildFkIn { name: "orders_user_fk".into(), own_schema: "public".into(), own_table: "orders".into(), definition: "FOREIGN KEY (user_id) REFERENCES public.users(id)".into() } ],
            grants: vec![ RebuildGrant { grantee: "reader".into(), privileges: vec!["SELECT".into()], grantable: false } ],
            owned_sequences: vec![],
        };
        let new = vec![ TableColumn { name: "id".into(), type_: "integer".into(), nullable: false, default: None, is_pk: false, unique: None },
                       TableColumn { name: "email".into(), type_: "text".into(), nullable: true, default: None, is_pk: false, unique: None } ];
        let script = rebuild_script(&input, &new).unwrap();
        assert!(script.contains("ALTER TABLE \"public\".\"orders\" DROP CONSTRAINT \"orders_user_fk\""), "drop fks_in first; got: {script}");
        assert!(script.contains("CREATE TABLE \"public\".\"_gridline_rb_users\" ("));
        assert!(script.contains("INSERT INTO \"public\".\"_gridline_rb_users\" (\"id\", \"email\") SELECT \"id\", \"email\" FROM \"public\".\"users\""));
        assert!(script.contains("DROP TABLE \"public\".\"users\""));
        assert!(script.contains("ALTER TABLE \"public\".\"_gridline_rb_users\" RENAME TO \"users\""));
        assert!(script.contains("ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"users_pkey\" PRIMARY KEY (id)"));
        assert!(script.contains("CREATE UNIQUE INDEX users_email_key ON public.users (email)"));
        assert!(script.contains("ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"orders_user_fk\" FOREIGN KEY (user_id) REFERENCES public.users(id)"));
        assert!(script.contains("GRANT SELECT ON \"public\".\"users\" TO \"reader\""));
        // ordering: drop fks_in before DROP TABLE; DROP before RENAME; RENAME before recreate
        let d_fk = script.find("DROP CONSTRAINT \"orders_user_fk\"").unwrap();
        let drop = script.find("DROP TABLE \"public\".\"users\"").unwrap();
        let rename = script.find("RENAME TO \"users\"").unwrap();
        let addcon = script.find("ADD CONSTRAINT \"users_pkey\"").unwrap();
        assert!(d_fk < drop && drop < rename && rename < addcon, "ordering wrong; got: {script}");
    }

    #[test]
    fn rebuild_script_detaches_and_reattaches_owned_sequence() {
        let input = RebuildInput {
            schema: "public".into(), name: "t".into(), constraints: vec![], indexes: vec![],
            fks_out: vec![], fks_in: vec![], grants: vec![],
            owned_sequences: vec![ RebuildOwnedSequence { seq_schema: "public".into(), seq_name: "t_id_seq".into(), column: "id".into() } ],
        };
        let new = vec![ TableColumn { name: "id".into(), type_: "integer".into(), nullable: false, default: Some(Some("nextval('t_id_seq'::regclass)".into())), is_pk: false, unique: None } ];
        let script = rebuild_script(&input, &new).unwrap();
        assert!(script.contains("ALTER SEQUENCE \"public\".\"t_id_seq\" OWNED BY NONE"));
        assert!(script.contains("ALTER SEQUENCE \"public\".\"t_id_seq\" OWNED BY \"public\".\"t\".\"id\""));
        let detach = script.find("OWNED BY NONE").unwrap();
        let drop = script.find("DROP TABLE").unwrap();
        let attach = script.find("OWNED BY \"public\".\"t\".\"id\"").unwrap();
        assert!(detach < drop && drop < attach, "detach before drop before reattach; got: {script}");
    }
}