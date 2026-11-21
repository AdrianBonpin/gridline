//! Cross-language SQL classification: the safety gate in front of a write.
//!
//! This mirrors `desktop/src/lib/sqlScan.ts` behaviour for behaviour, and both
//! implementations assert the SAME corpus —
//! `desktop/fixtures/sql-classification-vectors.json`, driven by
//! `sql_classify.test.rs` here and `desktop/src/lib/sqlScanCorpus.test.ts`
//! there. Neither language owns the expectations, so the frontend guard and
//! the backend gate cannot drift into disagreeing about whether a script
//! writes.
//!
//! Classification fails closed. An unrecognised verb, or an `EXPLAIN` whose
//! wrapped statement cannot be proven read-only, is [`StatementKind::Unknown`]
//! and therefore needs confirmation; nothing uncertain is reported as safe.
//!
//! Quoted strings, quoted identifiers, comments and dollar-quoted bodies never
//! contribute keywords — with one deliberate exception: MySQL executable
//! comments (`/*! … */`), whose bodies the server actually runs (mysqldump
//! wraps routine and trigger definitions in them).

use crate::db::sql_split::{
    copy_quoted, dollar_quote_end, skip_block_comment, skip_until, split_statements,
};

/// Verbs that never change data or schema. Allowlist-based on purpose: an
/// unlisted verb falls through to [`StatementKind::Unknown`], which asks for
/// confirmation.
pub const READ_VERBS: &[&str] = &[
    "SELECT",
    "VALUES",
    "TABLE",
    "SHOW",
    "DESCRIBE",
    "DESC",
    "EXPLAIN",
    "SET",
    "RESET",
    "BEGIN",
    "START",
    "COMMIT",
    "END",
    "ROLLBACK",
    "ABORT",
    "SAVEPOINT",
    "RELEASE",
    "ANALYZE",
    "VACUUM",
    "REINDEX",
    "CLUSTER",
    "CHECKPOINT",
    "DECLARE",
    "FETCH",
    "MOVE",
    "CLOSE",
    "LISTEN",
    "UNLISTEN",
    "NOTIFY",
    "LOCK",
    "UNLOCK",
    "DISCARD",
    "DEALLOCATE",
    "PREPARE",
    "PRAGMA",
    "USE",
    "HELP",
];

/// Verbs that change rows.
pub const WRITE_VERBS: &[&str] = &[
    "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT", "LOAD",
];

/// Verbs that change schema. `TRUNCATE` lives here (not in [`WRITE_VERBS`]) to
/// preserve the documented behaviour that the object tree refreshes after a
/// schema-modifying run — `TRUNCATE` is still destructive, so it prompts
/// either way.
pub const SCHEMA_VERBS: &[&str] = &[
    "CREATE", "DROP", "ALTER", "RENAME", "COMMENT", "GRANT", "REVOKE", "REFRESH", "IMPORT",
    "TRUNCATE",
];

/// Verbs inside a `WITH` chain that make the whole statement a write.
pub const CTE_WRITE_VERBS: &[&str] = &["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    /// Provably read-only.
    Read,
    /// Changes rows.
    Write,
    /// Changes schema (also destructive).
    Schema,
    /// Not provably read-only — must be confirmed.
    Unknown,
}

impl StatementKind {
    pub fn as_str(self) -> &'static str {
        match self {
            StatementKind::Read => "read",
            StatementKind::Write => "write",
            StatementKind::Schema => "schema",
            StatementKind::Unknown => "unknown",
        }
    }

    /// True when running this statement requires an explicit confirmation.
    pub fn requires_confirmation(self) -> bool {
        matches!(
            self,
            StatementKind::Write | StatementKind::Schema | StatementKind::Unknown
        )
    }
}

/// Result of classifying every statement in a script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptAnalysis {
    /// True when running this script needs an explicit confirmation.
    pub destructive: bool,
    /// 1-based index of the first statement needing confirmation, else None.
    pub first_destructive_index: Option<usize>,
    pub total_statements: usize,
    /// The classification that made the script destructive, else None.
    pub reason: Option<StatementKind>,
}

/// Every bare word in `sql`, uppercased, with quoted regions, comments and
/// dollar-quoted bodies skipped. MySQL executable comment bodies are scanned,
/// because the server executes them.
pub fn scan_words(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut words: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\'' | '"' | '`' => {
                let mut sink = String::new();
                copy_quoted(&chars, &mut i, &mut sink, c);
            }
            '-' if chars.get(i + 1) == Some(&'-') => {
                skip_until(&chars, &mut i, |ch| ch == '\n');
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                if chars.get(i + 2) == Some(&'!') {
                    // MySQL executable comment: the server runs its body, so the
                    // opener is not a comment at all — scan on as if it were plain
                    // SQL (the closing marker is punctuation and the optional
                    // version gate is digits). Scanning inline can only ADD
                    // words, so it can never hide a write.
                    i += 3;
                } else {
                    skip_block_comment(&chars, &mut i);
                }
            }
            '$' => match dollar_quote_end(&chars, i) {
                Some(end) => i = end,
                None => i += 1,
            },
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut word = String::new();
                while i < chars.len()
                    && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
                {
                    word.push(chars[i].to_ascii_uppercase());
                    i += 1;
                }
                words.push(word);
            }
            _ => i += 1,
        }
    }
    words
}

/// Classify a single statement.
pub fn classify_statement(stmt: &str) -> StatementKind {
    classify_words(&scan_words(stmt))
}

fn classify_words(words: &[String]) -> StatementKind {
    let Some(first) = words.first() else {
        return StatementKind::Read; // nothing executes
    };
    match first.as_str() {
        "EXPLAIN" => classify_explain(&words[1..]),
        // A data-modifying CTE can sit anywhere in the chain, e.g.
        //   WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d
        // which writes even though the trailing verb is SELECT. Fail closed.
        "WITH" => {
            if words[1..]
                .iter()
                .any(|word| CTE_WRITE_VERBS.contains(&word.as_str()))
            {
                StatementKind::Write
            } else {
                StatementKind::Read
            }
        }
        verb if SCHEMA_VERBS.contains(&verb) => StatementKind::Schema,
        verb if WRITE_VERBS.contains(&verb) => StatementKind::Write,
        verb if READ_VERBS.contains(&verb) => StatementKind::Read,
        _ => StatementKind::Unknown,
    }
}

/// Classify the statement an `EXPLAIN` wraps.
///
/// `EXPLAIN ANALYZE` executes the wrapped statement on PostgreSQL and on MySQL
/// 8.0.18+, and option words (`(ANALYZE, BUFFERS, FORMAT JSON)`) make the
/// wrapped verb awkward to locate, so ANY write or schema verb inside an
/// `EXPLAIN` makes the whole statement destructive. `Read` is only returned
/// when a known read verb is actually present; anything else is unprovable.
fn classify_explain(words: &[String]) -> StatementKind {
    if words
        .iter()
        .any(|word| SCHEMA_VERBS.contains(&word.as_str()))
    {
        return StatementKind::Schema;
    }
    if words
        .iter()
        .any(|word| WRITE_VERBS.contains(&word.as_str()))
    {
        return StatementKind::Write;
    }
    if words
        .iter()
        .any(|word| READ_VERBS.contains(&word.as_str()) || word == "WITH")
    {
        return StatementKind::Read;
    }
    StatementKind::Unknown
}

/// Inspect **every** statement in the script, not just the first one.
/// `SELECT 1; DROP TABLE demo;` must be destructive.
pub fn analyze_script(sql: &str) -> ScriptAnalysis {
    let statements = split_statements(sql);
    let total_statements = statements.len();
    for (index, statement) in statements.iter().enumerate() {
        let kind = classify_statement(statement);
        if kind.requires_confirmation() {
            return ScriptAnalysis {
                destructive: true,
                first_destructive_index: Some(index + 1),
                total_statements,
                reason: Some(kind),
            };
        }
    }
    ScriptAnalysis {
        destructive: false,
        first_destructive_index: None,
        total_statements,
        reason: None,
    }
}

/// True when ANY statement in `sql` changes schema (drives the tree refresh).
pub fn has_schema_modifying_statement(sql: &str) -> bool {
    split_statements(sql)
        .iter()
        .any(|stmt| classify_statement(stmt) == StatementKind::Schema)
}

#[cfg(test)]
#[path = "sql_classify.test.rs"]
mod sql_classify_tests;
