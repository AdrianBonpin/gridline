use super::*;

/// The single cross-language corpus. `desktop/src/lib/sqlScanCorpus.test.ts`
/// asserts the SAME file against the TypeScript scanner, so a behavioral
/// divergence between the frontend guard and this backend gate fails a test in
/// one of the two languages. Add new vendor grammar here once — never as a
/// second copy in either language.
const CORPUS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/sql-classification-vectors.json"
));

#[derive(serde::Deserialize)]
struct Corpus {
    version: u32,
    vectors: Vec<Vector>,
}

#[derive(serde::Deserialize)]
struct Vector {
    id: String,
    sql: String,
    statements: Vec<String>,
    kinds: Vec<String>,
    analysis: ExpectedAnalysis,
}

#[derive(serde::Deserialize)]
struct ExpectedAnalysis {
    destructive: bool,
    #[serde(rename = "firstDestructiveIndex")]
    first_destructive_index: Option<usize>,
    #[serde(rename = "totalStatements")]
    total_statements: usize,
    reason: Option<String>,
}

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS).expect("shared SQL classification corpus must parse")
}

#[test]
fn shared_corpus_is_versioned_and_has_unique_ids() {
    let corpus = corpus();
    assert_eq!(corpus.version, 1);
    assert!(
        corpus.vectors.len() > 10,
        "corpus should cover the classification seam broadly, got {}",
        corpus.vectors.len()
    );
    let mut ids: Vec<&str> = corpus.vectors.iter().map(|v| v.id.as_str()).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(before, ids.len(), "duplicate vector ids in the corpus");
}

/// Every field of every vector: split statements, per-statement classification
/// and the whole-script analysis. Asserting all three is what makes the corpus
/// a drift test — a splitter change that hides a statement from the classifier
/// (or vice versa) cannot pass unnoticed.
#[test]
fn shared_corpus_vectors() {
    for vector in corpus().vectors {
        let statements = split_statements(&vector.sql);
        assert_eq!(
            statements, vector.statements,
            "[{}] split mismatch for {:?}",
            vector.id, vector.sql
        );

        let kinds: Vec<&str> = statements
            .iter()
            .map(|stmt| classify_statement(stmt).as_str())
            .collect();
        assert_eq!(
            kinds, vector.kinds,
            "[{}] classification mismatch for {:?}",
            vector.id, vector.sql
        );

        let analysis = analyze_script(&vector.sql);
        assert_eq!(
            analysis.destructive, vector.analysis.destructive,
            "[{}] destructive mismatch for {:?}",
            vector.id, vector.sql
        );
        assert_eq!(
            analysis.first_destructive_index, vector.analysis.first_destructive_index,
            "[{}] firstDestructiveIndex mismatch for {:?}",
            vector.id, vector.sql
        );
        assert_eq!(
            analysis.total_statements, vector.analysis.total_statements,
            "[{}] totalStatements mismatch for {:?}",
            vector.id, vector.sql
        );
        assert_eq!(
            analysis.reason.map(|reason| reason.as_str()),
            vector.analysis.reason.as_deref(),
            "[{}] reason mismatch for {:?}",
            vector.id,
            vector.sql
        );
    }
}

// ── Behaviour pinned by the ticket, independent of the corpus file ──
//
// These restate the acceptance criteria directly so the safety intent survives
// a careless edit to the JSON (the corpus test proves the two languages agree;
// these prove both are right about the cases that matter).

#[test]
fn explain_analyze_over_a_write_requires_confirmation() {
    assert_eq!(
        classify_statement("EXPLAIN ANALYZE UPDATE users SET name = 'x'"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("EXPLAIN ANALYZE DELETE FROM users"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("EXPLAIN ANALYZE SELECT 1"),
        StatementKind::Read
    );
}

#[test]
fn mysql_executable_comment_containing_a_write_requires_confirmation() {
    assert_eq!(
        classify_statement("/*!40000 UPDATE users SET admin = 1 */"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("/*!50003 CREATE PROCEDURE p() BEGIN SELECT 1; END */"),
        StatementKind::Schema
    );
    // A session-setting executable comment is still read-only.
    assert_eq!(
        classify_statement("/*!40101 SET NAMES utf8 */"),
        StatementKind::Read
    );
}

#[test]
fn leading_comments_do_not_hide_a_write() {
    for sql in [
        "-- refresh the audit trail\nUPDATE audit SET seen = true",
        "/* nightly job */\nDELETE FROM sessions",
        "-- one\n/* two */\n-- three\nINSERT INTO audit (msg) VALUES ('x')",
    ] {
        assert!(
            analyze_script(sql).destructive,
            "leading comments hid the write in {sql:?}"
        );
    }
    assert!(!analyze_script("-- just looking\nSELECT 1").destructive);
}

#[test]
fn data_modifying_cte_requires_confirmation_read_only_cte_does_not() {
    assert_eq!(
        classify_statement("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("WITH u AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM u"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("WITH cte AS (SELECT 1) SELECT * FROM cte"),
        StatementKind::Read
    );
    assert!(!analyze_script("WITH cte AS (SELECT 1) SELECT * FROM cte").destructive);
}

#[test]
fn unknown_verbs_require_confirmation_and_string_literals_do_not() {
    assert_eq!(
        classify_statement("CALL refresh_stats()"),
        StatementKind::Unknown
    );
    assert!(analyze_script("CALL refresh_stats()").destructive);
    assert_eq!(
        classify_statement("SELECT 'DROP TABLE users; DELETE FROM users'"),
        StatementKind::Read
    );
    assert!(!analyze_script("SELECT 'DROP TABLE users'").destructive);
}

#[test]
fn quoted_identifiers_are_identifiers_not_keywords() {
    assert_eq!(
        classify_statement("UPDATE \"order items\" SET \"delete\" = true"),
        StatementKind::Write
    );
    assert_eq!(
        classify_statement("SELECT * FROM \"delete\""),
        StatementKind::Read
    );
    assert_eq!(
        classify_statement("SELECT `update` FROM `t`"),
        StatementKind::Read
    );
}

#[test]
fn delimiter_routine_body_is_one_statement() {
    let sql =
        "DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  INSERT INTO t VALUES (1);\nEND//\nDELIMITER ;\nSELECT 1;";
    let analysis = analyze_script(sql);
    assert_eq!(analysis.total_statements, 2);
    assert_eq!(analysis.first_destructive_index, Some(1));
    assert_eq!(analysis.reason, Some(StatementKind::Schema));
}

#[test]
fn empty_and_comment_only_scripts_are_not_destructive() {
    for sql in ["", "   ", "-- just a note", "/* just a note */", "  ;  ; "] {
        let analysis = analyze_script(sql);
        assert!(!analysis.destructive, "{sql:?}");
        assert_eq!(analysis.first_destructive_index, None, "{sql:?}");
    }
}

#[test]
fn later_destructive_statement_reports_its_position() {
    let analysis = analyze_script("SELECT 1; SELECT 2; DROP TABLE demo;");
    assert!(analysis.destructive);
    assert_eq!(analysis.first_destructive_index, Some(3));
    assert_eq!(analysis.total_statements, 3);
    assert_eq!(analysis.reason, Some(StatementKind::Schema));
}

#[test]
fn schema_modifying_detection_still_matches_the_tree_refresh_contract() {
    assert!(has_schema_modifying_statement(
        "SELECT 1; CREATE TABLE t (id int);"
    ));
    assert!(has_schema_modifying_statement("TRUNCATE TABLE t"));
    assert!(!has_schema_modifying_statement(
        "INSERT INTO t VALUES (1); DELETE FROM t;"
    ));
    assert!(!has_schema_modifying_statement(""));
}
