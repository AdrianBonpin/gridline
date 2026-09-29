//! Planning for a MySQL "clean" restore.
//!
//! `clean` drops only the objects the dump recreates, matching the UI label
//! "Clean — DROP before CREATE" and `pg_restore --clean` semantics: objects in
//! the target database that the dump does not mention survive. It is
//! deliberately *not* `DROP DATABASE` (spec §4.3).
//!
//! Pure by design: takes already-split statements, returns the DROP script.

use crate::db::mysql::mysql_quote_ident;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ObjectKind {
    Table,
    View,
    Procedure,
    Function,
    Trigger,
    Event,
}

impl ObjectKind {
    fn keyword(self) -> &'static str {
        match self {
            ObjectKind::Table => "TABLE",
            ObjectKind::View => "VIEW",
            ObjectKind::Procedure => "PROCEDURE",
            ObjectKind::Function => "FUNCTION",
            ObjectKind::Trigger => "TRIGGER",
            ObjectKind::Event => "EVENT",
        }
    }

    /// Dependents first, tables last, so the drop phase reads predictably.
    /// Foreign-key ordering is handled by the caller disabling
    /// `FOREIGN_KEY_CHECKS`, so this is about clarity, not correctness.
    fn order(self) -> u8 {
        match self {
            ObjectKind::Trigger => 0,
            ObjectKind::Event => 1,
            ObjectKind::Procedure => 2,
            ObjectKind::Function => 3,
            ObjectKind::View => 4,
            ObjectKind::Table => 5,
        }
    }
}

/// Tokens that may appear between the object keyword and its name.
const MODIFIERS: &[&str] = &[
    "OR", "REPLACE", "TEMPORARY", "IF", "NOT", "EXISTS", "AGGREGATE", "SQL", "SECURITY",
    "DEFINER", "ALGORITHM", "UNDEFINED", "MERGE", "TEMPTABLE", "CASCADED", "LOCAL", "INVOKER",
    "=",
];

/// Build the ordered `DROP … IF EXISTS` script for a clean restore.
/// Returns an empty vector when no object can be identified (fail closed).
pub fn plan_clean_drops(default_schema: &str, statements: &[String]) -> Vec<String> {
    let mut found: Vec<(ObjectKind, String)> = Vec::new();
    for stmt in statements {
        if let Some((kind, name)) = parse_create_target(stmt) {
            let qualified = qualify(default_schema, &name);
            if !found.iter().any(|(k, n)| *k == kind && *n == qualified) {
                found.push((kind, qualified));
            }
        }
    }
    found.sort_by_key(|(k, _)| k.order());
    found
        .into_iter()
        .map(|(kind, name)| format!("DROP {} IF EXISTS {}", kind.keyword(), name))
        .collect()
}

/// Extract `(kind, raw name)` from a `CREATE …` statement, or `None`.
fn parse_create_target(stmt: &str) -> Option<(ObjectKind, String)> {
    let tokens = unwrap_version_comments(stmt);
    let tokens = tokenize(&tokens);
    let mut it = tokens.iter().peekable();
    while let Some(tok) = it.next() {
        if !tok.eq_ignore_ascii_case("CREATE") {
            continue;
        }
        // Walk forward until an object keyword is found.
        while let Some(t) = it.next() {
            let upper = t.to_ascii_uppercase();
            let kind = match upper.as_str() {
                "TABLE" => ObjectKind::Table,
                "VIEW" => ObjectKind::View,
                "PROCEDURE" => ObjectKind::Procedure,
                "FUNCTION" => ObjectKind::Function,
                "TRIGGER" => ObjectKind::Trigger,
                "EVENT" => ObjectKind::Event,
                _ => continue,
            };
            // The first following token that is neither a modifier nor an
            // `x=y` clause is the object name.
            for cand in it.by_ref() {
                let up = cand.to_ascii_uppercase();
                if MODIFIERS.contains(&up.as_str()) || cand.contains('=') {
                    continue;
                }
                // A routine's name is followed by its argument list with no
                // space (`p`()`, hence a single token); strip that trailing
                // `()` so the DROP names the routine, not its signature. This
                // must be a *string* suffix — `trim_end_matches('(')` (a char
                // pattern) strips nothing from `p`()`.
                let name = cand.strip_suffix("()").unwrap_or(cand).to_string();
                if name.is_empty() {
                    return None;
                }
                // Fail closed: a token that is not a plausible identifier means
                // we cannot name the object, so plan no DROP rather than emit a
                // bogus one. `CREATE TABLE (id int)` tokenizes as
                // `["CREATE", "TABLE", "(id", "int)"]`, and `(id` is a column
                // definition fragment, not a table name.
                if !is_plausible_identifier(&name) {
                    return None;
                }
                return Some((kind, name));
            }
            return None;
        }
    }
    None
}

/// Reject candidates that are clearly not object names. A `(`, `)`, `,` or `;`
/// outside a backtick-quoted region means the token is part of an argument
/// list, a column definition, or a statement terminator — not an identifier.
fn is_plausible_identifier(cand: &str) -> bool {
    if cand.is_empty() {
        return false;
    }
    let mut in_backtick = false;
    for ch in cand.chars() {
        match ch {
            '`' => in_backtick = !in_backtick,
            '(' | ')' | ',' | ';' if !in_backtick => return false,
            _ => {}
        }
    }
    true
}

/// Replace `/*!50003 … */` executable comments with their inner text — the
/// shape mysqldump uses to wrap routine and trigger definitions.
fn unwrap_version_comments(stmt: &str) -> String {
    let mut out = String::with_capacity(stmt.len());
    let chars: Vec<char> = stmt.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '/' && i + 2 < chars.len() && chars[i + 1] == '*' && chars[i + 2] == '!' {
            // skip `/*!` and any leading digits
            let mut j = i + 3;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            out.push(' ');
            while j < chars.len()
                && !(chars[j] == '*' && j + 1 < chars.len() && chars[j + 1] == '/')
            {
                out.push(chars[j]);
                j += 1;
            }
            out.push(' ');
            i = (j + 2).min(chars.len());
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Split on whitespace, treating backtick-quoted regions as part of one token.
fn tokenize(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut in_backtick = false;
    for ch in s.chars() {
        match ch {
            '`' => {
                in_backtick = !in_backtick;
                cur.push(ch);
            }
            c if c.is_whitespace() && !in_backtick => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

/// `a` -> `schema`.`a`; `db`.`a` / `db.a` -> `db`.`a`.
fn qualify(default_schema: &str, name: &str) -> String {
    let parts: Vec<String> = name
        .split('.')
        .map(|p| mysql_quote_ident(strip_backticks(p)))
        .collect();
    if parts.len() == 1 {
        format!("{}.{}", mysql_quote_ident(default_schema), parts[0])
    } else {
        parts.join(".")
    }
}

fn strip_backticks(s: &str) -> &str {
    s.trim_matches('`')
}

#[cfg(test)]
#[path = "mysql_clean.test.rs"]
mod mysql_clean_tests;
