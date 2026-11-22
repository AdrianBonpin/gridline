//! Textual understanding of SQLite schema statements.
//!
//! A SQLite table rebuild has to reproduce everything `PRAGMA table_info` does
//! not report: `CHECK` and `UNIQUE` table constraints, foreign keys with their
//! actions, `COLLATE`, generated-column expressions, expression defaults,
//! `WITHOUT ROWID` / `STRICT`, and the table's indexes and triggers. The only
//! place SQLite keeps that text is `sqlite_master.sql`, so this module turns a
//! stored `CREATE TABLE` into the items it is built from, and provides the two
//! textual operations a rebuild needs:
//!
//! * [`parse_create_table`] — the column definitions (with their constraints
//!   split out and their original text kept verbatim), the table-level
//!   constraints, and the trailing table options.
//! * [`rewrite_identifiers`] — an identifier-aware rename, so an index or a
//!   trigger keeps meaning the column it named after an explicit rename.
//! * [`parse_rebuild_script`] — the rebuild script read back as a plan (declared
//!   columns, copy mapping, index/trigger statements), which is what the
//!   round-trip check in `db::sqlite_rebuild` compares the live table against.
//!
//! Everything here is pure text handling: no database I/O. Every function keeps
//! the source text verbatim wherever it can, because re-emitting a clause the
//! editor does not understand is the only faithful way to preserve it.

use crate::db::object_ddl::quote_ident;

/// One lexical token of a SQL statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// An unquoted identifier or keyword: `name`, `CHECK`, `x_1`.
    Word,
    /// A quoted identifier: `"name"`, `` `name` ``, `[name]`.
    Quoted,
    /// A string literal: `'value'`.
    Str,
    /// A numeric literal.
    Number,
    /// A single punctuation character (`(`, `)`, `,`, `.`, `*`, `;`, …).
    Punct,
    /// `-- line` or `/* block */`.
    Comment,
    /// A run of whitespace.
    Space,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    /// The exact source text, unchanged.
    pub text: String,
}

impl Token {
    /// The identifier this token names, with its quoting removed, or `None` for
    /// a token that cannot name a column or table.
    pub fn ident_value(&self) -> Option<String> {
        match self.kind {
            TokenKind::Word => Some(self.text.clone()),
            TokenKind::Quoted => {
                let mut chars = self.text.chars();
                let open = chars.next()?;
                let close = match open {
                    '[' => ']',
                    other => other,
                };
                let body: String = chars.collect();
                let body = body.strip_suffix(close).unwrap_or(&body);
                Some(match open {
                    '"' => body.replace("\"\"", "\""),
                    '`' => body.replace("``", "`"),
                    _ => body.to_string(),
                })
            }
            _ => None,
        }
    }

    fn is_space(&self) -> bool {
        matches!(self.kind, TokenKind::Space | TokenKind::Comment)
    }

    fn is_punct(&self, c: char) -> bool {
        self.kind == TokenKind::Punct && self.text == c.to_string()
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$' || !c.is_ascii()
}

/// Split SQL text into tokens, keeping every byte of the original text.
pub fn tokenize(sql: &str) -> Vec<Token> {
    let chars: Vec<char> = sql.chars().collect();
    let mut out: Vec<Token> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let start = i;

        if c.is_whitespace() {
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Space,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Comment,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            out.push(Token {
                kind: TokenKind::Comment,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c == '\'' {
            // A string literal, with SQLite's doubled-quote escape.
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if chars.get(i + 1) == Some(&'\'') {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Str,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c == '"' || c == '`' {
            let quote = c;
            i += 1;
            while i < chars.len() {
                if chars[i] == quote {
                    if chars.get(i + 1) == Some(&quote) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Quoted,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c == '[' {
            i += 1;
            while i < chars.len() && chars[i] != ']' {
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Quoted,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if c.is_ascii_digit() {
            while i < chars.len() && (is_word_char(chars[i]) || chars[i] == '.') {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Number,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        if is_word_char(c) {
            while i < chars.len() && is_word_char(chars[i]) {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Word,
                text: chars[start..i].iter().collect(),
            });
            continue;
        }
        i += 1;
        out.push(Token {
            kind: TokenKind::Punct,
            text: c.to_string(),
        });
    }
    out
}

/// Concatenate tokens back into text, trimmed at both ends.
fn tokens_text(tokens: &[Token]) -> String {
    tokens
        .iter()
        .map(|t| t.text.as_str())
        .collect::<String>()
        .trim()
        .to_string()
}

/// A canonical form for comparing two SQL fragments: tokens joined by single
/// spaces, ignoring whitespace and comments. String literals keep their text, so
/// `CHECK (x = 'a b')` stays distinguishable from `CHECK (x = 'a')` + `b`.
pub fn normalize_sql(sql: &str) -> String {
    tokenize(sql)
        .iter()
        .filter(|t| !t.is_space())
        .map(|t| t.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Split a script into statements at top-level semicolons.
///
/// A trigger body is a `BEGIN … END` block whose inner statements are separated
/// by semicolons of their own, so a split only happens outside such a block —
/// and outside a `CASE … END` expression, which nests inside one.
pub fn split_statements(script: &str) -> Vec<String> {
    let tokens = tokenize(script);
    let mut out: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    let mut block = 0i32;
    for (i, t) in tokens.iter().enumerate() {
        if t.is_punct('(') {
            depth += 1;
            continue;
        }
        if t.is_punct(')') {
            depth -= 1;
            continue;
        }
        if depth == 0 {
            match keyword(t).as_deref() {
                Some("BEGIN") | Some("CASE") => {
                    block += 1;
                    continue;
                }
                Some("END") => {
                    block = (block - 1).max(0);
                    continue;
                }
                _ => {}
            }
        }
        if t.is_punct(';') && depth == 0 && block == 0 {
            let text = tokens_text(&tokens[start..i]);
            if !text.is_empty() {
                out.push(text);
            }
            start = i + 1;
        }
    }
    let tail = tokens_text(&tokens[start..]);
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

/// The uppercase keyword this token carries, if it is an unquoted word.
fn keyword(t: &Token) -> Option<String> {
    if t.kind == TokenKind::Word {
        Some(t.text.to_ascii_uppercase())
    } else {
        None
    }
}

/// Indices of a token slice that are neither whitespace nor comments.
fn significant(tokens: &[Token]) -> Vec<usize> {
    (0..tokens.len())
        .filter(|&i| !tokens[i].is_space())
        .collect()
}

/// Split a token slice at top-level commas.
fn split_top_level_commas(tokens: &[Token]) -> Vec<&[Token]> {
    let mut out: Vec<&[Token]> = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, t) in tokens.iter().enumerate() {
        if t.is_punct('(') {
            depth += 1;
        } else if t.is_punct(')') {
            depth -= 1;
        } else if t.is_punct(',') && depth == 0 {
            out.push(&tokens[start..i]);
            start = i + 1;
        }
    }
    out.push(&tokens[start..]);
    out
}

/// One column constraint (`NOT NULL`, `DEFAULT …`, `CHECK (…)`, `COLLATE …`, a
/// `REFERENCES …` clause, a generated-column clause, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClauseKind {
    PrimaryKey,
    NotNull,
    Null,
    Unique,
    Default,
    Check,
    Collate,
    References,
    Generated,
    /// `CONSTRAINT name` ahead of another constraint, or anything unrecognised.
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedClause {
    pub kind: ClauseKind,
    /// The clause exactly as it was written.
    pub text: String,
}

/// One column of a stored `CREATE TABLE`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedColumn {
    pub name: String,
    /// The declared type text, verbatim (may be empty).
    pub type_: String,
    /// Column constraints in their written order.
    pub clauses: Vec<ParsedClause>,
    /// The whole column definition, verbatim.
    pub definition: String,
}

impl ParsedColumn {
    pub fn clause(&self, kind: ClauseKind) -> Option<&ParsedClause> {
        self.clauses.iter().find(|c| c.kind == kind)
    }

    pub fn is_generated(&self) -> bool {
        self.clause(ClauseKind::Generated).is_some()
    }

    /// The clauses a rebuild must carry verbatim because the column editor does
    /// not model them (everything except the attributes the editor owns:
    /// primary key membership, nullability, default, uniqueness).
    pub fn preserved_clauses(&self) -> Vec<&ParsedClause> {
        self.clauses
            .iter()
            .filter(|c| {
                matches!(
                    c.kind,
                    ClauseKind::Check
                        | ClauseKind::Collate
                        | ClauseKind::References
                        | ClauseKind::Generated
                        | ClauseKind::Other
                )
            })
            .collect()
    }
}

/// What a table-level constraint is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConstraintKind {
    PrimaryKey,
    Unique,
    Check,
    ForeignKey,
}

/// One table-level constraint of a stored `CREATE TABLE`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedConstraint {
    pub kind: ConstraintKind,
    /// The `CONSTRAINT name` prefix, when the constraint was named.
    pub name: Option<String>,
    /// The local columns the constraint names explicitly (primary key, unique
    /// key, and foreign-key local columns). Empty for a `CHECK`.
    pub columns: Vec<String>,
    /// Every identifier the constraint's text mentions. For a `CHECK` this is
    /// how the rebuild knows which columns the expression depends on.
    pub identifiers: Vec<String>,
    /// The constraint exactly as it was written.
    pub text: String,
}

impl ParsedConstraint {
    /// The columns whose removal would make this constraint impossible.
    pub fn dependent_columns(&self) -> Vec<String> {
        match self.kind {
            // A foreign key names its local columns explicitly; the referenced
            // table and columns are identifiers too, but they are not local
            // columns and dropping one of them changes nothing here.
            ConstraintKind::Check => self.identifiers.clone(),
            _ => self.columns.clone(),
        }
    }
}

/// A stored `CREATE TABLE`, taken apart without losing any text.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedTable {
    pub name: String,
    pub columns: Vec<ParsedColumn>,
    pub constraints: Vec<ParsedConstraint>,
    /// Table options written after the closing parenthesis (`WITHOUT ROWID`,
    /// `STRICT`), verbatim.
    pub options: Vec<String>,
}

impl ParsedTable {
    /// Look a column up the way SQLite does: identifiers are case-insensitive.
    pub fn column(&self, name: &str) -> Option<&ParsedColumn> {
        self.columns
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name))
    }

    /// Every identifier in the definition, including the ones inside
    /// constraints and generated-column expressions.
    pub fn identifiers(&self) -> Vec<String> {
        let mut out: Vec<String> = self.columns.iter().map(|c| c.name.clone()).collect();
        for c in &self.constraints {
            out.extend(c.identifiers.iter().cloned());
        }
        out
    }
}

/// Which column constraint a token starts, if any.
fn clause_start(tokens: &[Token], i: usize) -> Option<ClauseKind> {
    match keyword(&tokens[i])?.as_str() {
        "NOT" => Some(ClauseKind::NotNull),
        "PRIMARY" => Some(ClauseKind::PrimaryKey),
        "UNIQUE" => Some(ClauseKind::Unique),
        "CHECK" => Some(ClauseKind::Check),
        "DEFAULT" => Some(ClauseKind::Default),
        "COLLATE" => Some(ClauseKind::Collate),
        "REFERENCES" => Some(ClauseKind::References),
        "GENERATED" => Some(ClauseKind::Generated),
        "AS" => Some(ClauseKind::Generated),
        "CONSTRAINT" => Some(ClauseKind::Other),
        _ => None,
    }
}

/// True when the keyword at `i` continues the clause that is being scanned
/// instead of starting a new one.
///
/// SQLite's grammar has three shapes that would otherwise look like a new
/// constraint: `NOT DEFERRABLE` inside a foreign-key clause, `AS (…)` inside a
/// generated-column clause (`GENERATED ALWAYS AS`), and `ON CONFLICT` / `ON
/// DELETE` / `ON UPDATE` anywhere (no column constraint starts with `ON`, so it
/// is never a boundary).
fn continues_clause(tokens: &[Token], i: usize, current: ClauseKind) -> bool {
    let word = match keyword(&tokens[i]) {
        Some(w) => w,
        None => return false,
    };
    if word == "AS" && current == ClauseKind::Generated {
        return true;
    }
    if word == "NOT" {
        let next = (i + 1..tokens.len()).find(|&j| !tokens[j].is_space());
        if let Some(j) = next {
            if keyword(&tokens[j]).as_deref() == Some("DEFERRABLE") {
                return true;
            }
        }
    }
    false
}

/// Split one column definition into its name, declared type, and constraints.
fn parse_column_definition(item: &[Token]) -> Result<ParsedColumn, String> {
    let sig = significant(item);
    let first = match sig.first() {
        Some(&i) => i,
        None => return Err("empty column definition".to_string()),
    };
    let name = item[first]
        .ident_value()
        .ok_or_else(|| "a column definition does not start with a name".to_string())?;

    let mut i = first + 1;
    let type_start = i;
    while i < item.len() && clause_start(item, i).is_none() {
        i += 1;
    }
    let type_ = tokens_text(&item[type_start..i]);

    let mut clauses: Vec<ParsedClause> = Vec::new();
    while i < item.len() {
        let kind = match clause_start(item, i) {
            Some(kind) => kind,
            None => {
                i += 1;
                continue;
            }
        };
        let start = i;
        i += 1;
        let mut depth = 0i32;
        while i < item.len() {
            let t = &item[i];
            if t.is_punct('(') {
                depth += 1;
            } else if t.is_punct(')') {
                depth -= 1;
            } else if depth == 0
                && !t.is_space()
                && clause_start(item, i).is_some()
                && !continues_clause(item, i, kind)
            {
                break;
            }
            i += 1;
        }
        clauses.push(ParsedClause {
            kind,
            text: tokens_text(&item[start..i]),
        });
    }

    Ok(ParsedColumn {
        name,
        type_,
        clauses,
        definition: tokens_text(item),
    })
}

/// True when the item starts a table-level constraint rather than a column.
fn constraint_kind(item: &[Token]) -> Option<ConstraintKind> {
    let sig = significant(item);
    let mut k = 0usize;
    let at = |k: usize| -> Option<&Token> { sig.get(k).map(|&i| &item[i]) };
    if keyword(at(k)?)?.as_str() == "CONSTRAINT" {
        // `CONSTRAINT name <kind>`
        k += 2;
    }
    let head = keyword(at(k)?)?;
    let next = at(k + 1).and_then(keyword);
    let third = at(k + 1).filter(|t| t.is_punct('(')).is_some();
    match head.as_str() {
        "PRIMARY" if next.as_deref() == Some("KEY") => Some(ConstraintKind::PrimaryKey),
        "FOREIGN" if next.as_deref() == Some("KEY") => Some(ConstraintKind::ForeignKey),
        "UNIQUE" if third => Some(ConstraintKind::Unique),
        "CHECK" if third => Some(ConstraintKind::Check),
        _ => None,
    }
}

/// The identifier list of a `PRIMARY KEY (…)`, `UNIQUE (…)`, or `FOREIGN KEY
/// (…)` clause: one column name per comma-separated item.
fn constraint_column_list(item: &[Token]) -> Vec<String> {
    let open = match item.iter().position(|t| t.is_punct('(')) {
        Some(i) => i,
        None => return Vec::new(),
    };
    let mut depth = 0i32;
    let mut close = item.len();
    for (i, t) in item.iter().enumerate().skip(open) {
        if t.is_punct('(') {
            depth += 1;
        } else if t.is_punct(')') {
            depth -= 1;
            if depth == 0 {
                close = i;
                break;
            }
        }
    }
    split_top_level_commas(&item[open + 1..close])
        .iter()
        .filter_map(|part| {
            significant(part)
                .first()
                .and_then(|&i| part[i].ident_value())
        })
        .collect()
}

/// Every identifier an item mentions, in order (used for `CHECK` dependencies).
///
/// For a `CHECK` only the expression's own identifiers count: the leading
/// `CHECK` keyword and a `CONSTRAINT name` prefix are not columns.
fn item_identifiers(item: &[Token], kind: ConstraintKind) -> Vec<String> {
    let scope: &[Token] = if kind == ConstraintKind::Check {
        let open = match item.iter().position(|t| t.is_punct('(')) {
            Some(i) => i,
            None => return Vec::new(),
        };
        &item[open..]
    } else {
        item
    };
    scope.iter().filter_map(|t| t.ident_value()).collect()
}

fn parse_constraint(item: &[Token], kind: ConstraintKind) -> ParsedConstraint {
    let sig = significant(item);
    let mut name: Option<String> = None;
    if sig.first().and_then(|&i| keyword(&item[i])).as_deref() == Some("CONSTRAINT") {
        name = sig.get(1).and_then(|&i| item[i].ident_value());
    }
    ParsedConstraint {
        kind,
        name,
        columns: match kind {
            ConstraintKind::Check => Vec::new(),
            _ => constraint_column_list(item),
        },
        identifiers: item_identifiers(item, kind),
        text: tokens_text(item),
    }
}

/// Take a stored `CREATE TABLE` statement apart.
pub fn parse_create_table(sql: &str) -> Result<ParsedTable, String> {
    let tokens = tokenize(sql);
    let sig = significant(&tokens);
    let mut k = 0usize;
    let word = |k: usize| -> Option<String> { sig.get(k).and_then(|&i| keyword(&tokens[i])) };

    if word(k).as_deref() != Some("CREATE") {
        return Err("not a CREATE statement".to_string());
    }
    k += 1;
    if matches!(word(k).as_deref(), Some("TEMP") | Some("TEMPORARY")) {
        k += 1;
    }
    if word(k).as_deref() != Some("TABLE") {
        return Err("not a CREATE TABLE statement".to_string());
    }
    k += 1;
    if word(k).as_deref() == Some("IF") {
        // IF NOT EXISTS
        k += 3;
    }
    let name_idx = *sig
        .get(k)
        .ok_or_else(|| "CREATE TABLE is missing its table name".to_string())?;
    let mut name = tokens[name_idx]
        .ident_value()
        .ok_or_else(|| "CREATE TABLE has an unreadable table name".to_string())?;
    k += 1;
    // `schema.table` is written the same way SQLite stores it for an attached
    // schema; the table's own name is the last segment.
    if sig.get(k).is_some_and(|&i| tokens[i].is_punct('.')) {
        let qualified = *sig
            .get(k + 1)
            .ok_or_else(|| "CREATE TABLE has an unreadable table name".to_string())?;
        name = tokens[qualified]
            .ident_value()
            .ok_or_else(|| "CREATE TABLE has an unreadable table name".to_string())?;
        k += 2;
    }

    let open_idx = *sig
        .get(k)
        .ok_or_else(|| format!("CREATE TABLE \"{name}\" has no column list"))?;
    if !tokens[open_idx].is_punct('(') {
        return Err(format!(
            "CREATE TABLE \"{name}\" has no column list (a virtual table?)"
        ));
    }
    let mut depth = 0i32;
    let mut close_idx = None;
    for (i, t) in tokens.iter().enumerate().skip(open_idx) {
        if t.is_punct('(') {
            depth += 1;
        } else if t.is_punct(')') {
            depth -= 1;
            if depth == 0 {
                close_idx = Some(i);
                break;
            }
        }
    }
    let close_idx = close_idx
        .ok_or_else(|| format!("CREATE TABLE \"{name}\" has an unbalanced column list"))?;

    let mut columns: Vec<ParsedColumn> = Vec::new();
    let mut constraints: Vec<ParsedConstraint> = Vec::new();
    for item in split_top_level_commas(&tokens[open_idx + 1..close_idx]) {
        if significant(item).is_empty() {
            continue;
        }
        match constraint_kind(item) {
            Some(kind) => constraints.push(parse_constraint(item, kind)),
            None => columns.push(parse_column_definition(item)?),
        }
    }

    let options_text = tokens_text(&tokens[close_idx + 1..]);
    let options_text = options_text.trim_end_matches(';').trim();
    let options: Vec<String> = if options_text.is_empty() {
        Vec::new()
    } else {
        options_text
            .split(',')
            .map(|o| o.trim().to_string())
            .filter(|o| !o.is_empty())
            .collect()
    };

    Ok(ParsedTable {
        name,
        columns,
        constraints,
        options,
    })
}

/// A rebuild script read back as a plan.
///
/// [`crate::db::sqlite_rebuild::apply_rebuild`] compares this against the live
/// table before it runs a single statement, so a script that would drop an
/// index, a trigger, a constraint, or an untouched column clause is refused
/// while the database is still untouched.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RebuildScript {
    /// The temporary table the script creates.
    pub tmp_table: String,
    /// The script's `CREATE TABLE`, parsed.
    pub create: ParsedTable,
    /// Declared column names, in the order the script creates them.
    pub columns: Vec<String>,
    /// `(source column, target column)` pairs from the copy statement, in order.
    pub copy: Vec<(String, String)>,
    /// Every `CREATE INDEX` statement, verbatim.
    pub index_sql: Vec<String>,
    /// Every `CREATE TRIGGER` statement, verbatim.
    pub trigger_sql: Vec<String>,
    /// Whether the script restores the `sqlite_sequence` row.
    pub restores_sequence: bool,
}

impl RebuildScript {
    /// The `(source column, target column)` pairs of the copy step, with a
    /// positional copy resolved against the live column order.
    pub fn copy_pairs(&self, live_columns: &[String]) -> Result<Vec<(String, String)>, String> {
        self.copy
            .iter()
            .map(|(source, target)| {
                if let Some(index) = source.strip_prefix('#') {
                    let index: usize = index
                        .parse()
                        .map_err(|_| "the rebuild script's copy step cannot be read".to_string())?;
                    let source = live_columns.get(index).ok_or_else(|| {
                        "the rebuild script copies a column the table does not have".to_string()
                    })?;
                    Ok((source.clone(), target.clone()))
                } else {
                    Ok((source.clone(), target.clone()))
                }
            })
            .collect()
    }

    /// The explicit renames the copy step declares: a target whose source column
    /// is a different name. This is the Column Identity mapping the values are
    /// copied through, so it is also the mapping the metadata must follow.
    pub fn renamed_columns(
        &self,
        live_columns: &[String],
    ) -> Result<Vec<(String, String)>, String> {
        Ok(self
            .copy_pairs(live_columns)?
            .into_iter()
            .filter(|(source, target)| !source.eq_ignore_ascii_case(target))
            .collect())
    }

    /// Whether the created table declares an `AUTOINCREMENT` column.
    pub fn declares_autoincrement(&self) -> bool {
        self.create
            .columns
            .iter()
            .any(|c| c.definition.to_ascii_uppercase().contains("AUTOINCREMENT"))
    }
}

/// Read a rebuild script (`CREATE` temp table / copy / drop / rename, then the
/// preserved index, trigger, and sequence statements) as a plan.
pub fn parse_rebuild_script(script: &str) -> Result<RebuildScript, String> {
    let mut plan = RebuildScript::default();
    let mut have_create = false;
    for statement in split_statements(script) {
        let tokens = tokenize(&statement);
        let sig = significant(&tokens);
        let head = |n: usize| -> Option<String> { sig.get(n).and_then(|&i| keyword(&tokens[i])) };
        let head1 = head(0).unwrap_or_default();
        let words: Vec<String> = sig.iter().filter_map(|&i| keyword(&tokens[i])).collect();
        let idents: Vec<String> = tokens.iter().filter_map(|t| t.ident_value()).collect();
        let touches_sequence = idents
            .iter()
            .any(|i| i.eq_ignore_ascii_case("sqlite_sequence"));
        match head1.as_str() {
            "CREATE" => {
                if words.iter().any(|w| w == "TABLE") && !have_create {
                    let parsed = parse_create_table(&statement)?;
                    plan.tmp_table = parsed.name.clone();
                    plan.columns = parsed.columns.iter().map(|c| c.name.clone()).collect();
                    plan.create = parsed;
                    have_create = true;
                } else if words.iter().any(|w| w == "INDEX") {
                    plan.index_sql.push(statement);
                } else if words.iter().any(|w| w == "TRIGGER") {
                    plan.trigger_sql.push(statement);
                }
            }
            "INSERT" => {
                if touches_sequence {
                    plan.restores_sequence = true;
                } else if words.get(1).map(String::as_str) == Some("INTO")
                    && words.iter().any(|w| w == "SELECT")
                {
                    plan.copy = parse_copy_statement(&tokens)?;
                }
            }
            "UPDATE" => {
                if touches_sequence {
                    plan.restores_sequence = true;
                }
            }
            _ => {}
        }
    }
    if !have_create {
        return Err("the rebuild script does not create a replacement table".to_string());
    }
    Ok(plan)
}

/// The `(source, target)` column pairs of `INSERT INTO tmp (a, b) SELECT x, y
/// FROM t`. A `SELECT *` pairs the live table's columns by position, which is
/// the only case where position is the identity.
fn parse_copy_statement(tokens: &[Token]) -> Result<Vec<(String, String)>, String> {
    let sig = significant(tokens);
    let unreadable = || "the rebuild script's copy step cannot be read".to_string();

    let open = sig
        .iter()
        .position(|&i| tokens[i].is_punct('('))
        .ok_or_else(unreadable)?;
    let mut depth = 0i32;
    let mut close = None;
    for (i, t) in tokens.iter().enumerate().skip(sig[open]) {
        if t.is_punct('(') {
            depth += 1;
        } else if t.is_punct(')') {
            depth -= 1;
            if depth == 0 {
                close = Some(i);
                break;
            }
        }
    }
    let close = close.ok_or_else(unreadable)?;
    let targets: Vec<String> = split_top_level_commas(&tokens[sig[open] + 1..close])
        .iter()
        .filter_map(|part| {
            significant(part)
                .first()
                .and_then(|&i| part[i].ident_value())
        })
        .collect();
    if targets.is_empty() {
        return Err(unreadable());
    }

    let select = sig
        .iter()
        .position(|&i| keyword(&tokens[i]).as_deref() == Some("SELECT"))
        .ok_or_else(unreadable)?;
    let from = sig
        .iter()
        .position(|&i| keyword(&tokens[i]).as_deref() == Some("FROM"))
        .ok_or_else(unreadable)?;
    if from <= select {
        return Err(unreadable());
    }
    let source_tokens = &tokens[sig[select] + 1..sig[from]];
    let source_sig = significant(source_tokens);
    if source_sig.len() == 1 && source_tokens[source_sig[0]].is_punct('*') {
        // Positional: the script relies on the live column order, which is only
        // faithful when it carries every column unchanged.
        return Ok(targets
            .iter()
            .enumerate()
            .map(|(i, t)| (format!("#{i}"), t.clone()))
            .collect());
    }
    let sources: Vec<String> = split_top_level_commas(source_tokens)
        .iter()
        .filter_map(|part| {
            significant(part)
                .first()
                .and_then(|&i| part[i].ident_value())
        })
        .collect();
    if sources.len() != targets.len() {
        return Err(unreadable());
    }
    Ok(sources.into_iter().zip(targets).collect())
}

/// Prefixes whose following identifier names a table or a trigger's subject, not
/// a column of this table.
const TABLE_REFERENCE_KEYWORDS: [&str; 6] = ["ON", "FROM", "UPDATE", "INTO", "TABLE", "REFERENCES"];

/// Rename column identifiers inside stored SQL (an index or trigger definition,
/// a constraint, a generated-column expression), leaving string literals,
/// comments, and table names alone.
pub fn rewrite_identifiers(sql: &str, renames: &[(String, String)], table: &str) -> String {
    if renames.is_empty() {
        return sql.to_string();
    }
    let tokens = tokenize(sql);
    let mut out = String::with_capacity(sql.len());
    let mut previous_keyword: Option<String> = None;
    for t in &tokens {
        let replace = match t.ident_value() {
            // A table reference is not a column reference.
            Some(ident)
                if ident.eq_ignore_ascii_case(table)
                    && previous_keyword
                        .as_deref()
                        .is_some_and(|k| TABLE_REFERENCE_KEYWORDS.contains(&k)) =>
            {
                None
            }
            Some(ident) => renames
                .iter()
                .find(|(from, _)| ident.eq_ignore_ascii_case(from))
                .map(|(_, to)| quote_ident(to)),
            None => None,
        };
        match replace {
            Some(quoted) => out.push_str(&quoted),
            None => out.push_str(&t.text),
        }
        if !t.is_space() {
            previous_keyword = keyword(t);
        }
    }
    out
}

/// Everything a rebuild has to reproduce that lives outside the column list the
/// editor submits: the parsed `CREATE TABLE`, the stored text of every explicit
/// index and trigger, and the table's `AUTOINCREMENT` sequence.
///
/// Read once, before any mutation, from `sqlite_master` (see
/// [`crate::db::sqlite_rebuild::read_table_shape`]).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PreservedTable {
    pub parsed: ParsedTable,
    /// `(name, stored CREATE statement)` of every explicit index.
    pub index_sql: Vec<(String, String)>,
    /// `(name, stored CREATE statement)` of every trigger.
    pub trigger_sql: Vec<(String, String)>,
    /// `sqlite_sequence.seq` for an `AUTOINCREMENT` table, when it has one.
    pub sequence: Option<i64>,
}

#[cfg(test)]
#[path = "sqlite_ddl.test.rs"]
mod tests;
