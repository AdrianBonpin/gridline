use super::*;

#[test]
fn splits_two_statements() {
    assert_eq!(
        split_statements("SELECT 1; SELECT 2"),
        vec!["SELECT 1", "SELECT 2"]
    );
}

#[test]
fn no_trailing_semicolon_is_fine() {
    assert_eq!(split_statements("SELECT 1"), vec!["SELECT 1"]);
}

#[test]
fn semicolon_inside_string_is_not_a_boundary() {
    assert_eq!(split_statements("SELECT 'a;b'"), vec!["SELECT 'a;b'"]);
    assert_eq!(
        split_statements("SELECT 'a;b'; SELECT 2"),
        vec!["SELECT 'a;b'", "SELECT 2"]
    );
}

#[test]
fn doubled_quote_escapes() {
    assert_eq!(
        split_statements("SELECT 'it''s'; SELECT 2"),
        vec!["SELECT 'it''s'", "SELECT 2"]
    );
}

#[test]
fn double_quoted_and_backtick_identifiers() {
    assert_eq!(
        split_statements("SELECT \"a;b\"; SELECT `x;y`"),
        vec!["SELECT \"a;b\"", "SELECT `x;y`"]
    );
    assert_eq!(
        split_statements("SELECT `a``b`; SELECT 2"),
        vec!["SELECT `a``b`", "SELECT 2"]
    );
}

#[test]
fn line_comments_do_not_break_statements() {
    assert_eq!(
        split_statements("SELECT 1 -- ; not a boundary\n; SELECT 2"),
        vec!["SELECT 1 -- ; not a boundary", "SELECT 2"]
    );
}

#[test]
fn block_comments_do_not_break_statements() {
    assert_eq!(split_statements("SELECT /* ; */ 1"), vec!["SELECT /* ; */ 1"]);
}

#[test]
fn dollar_quoted_bodies() {
    assert_eq!(
        split_statements("SELECT $$a;b$$; SELECT 2"),
        vec!["SELECT $$a;b$$", "SELECT 2"]
    );
    assert_eq!(
        split_statements("SELECT $fn$x;y$fn$; SELECT 2"),
        vec!["SELECT $fn$x;y$fn$", "SELECT 2"]
    );
}

#[test]
fn unclosed_dollar_is_literal() {
    assert_eq!(split_statements("SELECT a$b"), vec!["SELECT a$b"]);
    assert_eq!(split_statements("SELECT 1$"), vec!["SELECT 1$"]);
}

#[test]
fn comment_only_statements_are_skipped() {
    assert_eq!(split_statements("-- nothing\n; SELECT 1"), vec!["SELECT 1"]);
    assert_eq!(split_statements("/* c */"), Vec::<String>::new());
}

#[test]
fn empty_and_whitespace_input() {
    assert_eq!(split_statements(""), Vec::<String>::new());
    assert_eq!(split_statements("  ;  ; "), Vec::<String>::new());
}

// ── MySQL client DELIMITER directive ────────────────────────────────
//
// NOTE: the splitter strips the active statement terminator, exactly as the
// pre-existing tests above assert (`splits_two_statements` -> ["SELECT 1",
// "SELECT 2"]). The expectations below therefore never contain a trailing
// `;`/delimiter, matching that established contract.

#[test]
fn delimiter_directive_changes_statement_terminator() {
    let sql = "DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND//\nDELIMITER ;\nSELECT 2;";
    let stmts = split_statements(sql);
    assert_eq!(stmts.len(), 2, "got {stmts:?}");
    assert!(stmts[0].starts_with("CREATE PROCEDURE p()"), "got {:?}", stmts[0]);
    // The inner `;` must NOT have split the body.
    assert!(stmts[0].contains("SELECT 1;"), "body was split: {:?}", stmts[0]);
    assert!(!stmts[0].contains("DELIMITER"), "directive leaked into statement: {:?}", stmts[0]);
    assert_eq!(stmts[1], "SELECT 2");
}

#[test]
fn delimiter_directive_is_case_and_space_tolerant() {
    let sql = "  delimiter $$\n SELECT 1$$\n Delimiter ;\nSELECT 2;";
    let stmts = split_statements(sql);
    assert_eq!(stmts, vec!["SELECT 1".to_string(), "SELECT 2".to_string()]);
}

#[test]
fn delimiter_text_inside_a_string_is_not_a_directive() {
    let stmts = split_statements("SELECT 'DELIMITER //';\nSELECT 2;");
    assert_eq!(stmts.len(), 2);
    assert_eq!(stmts[0], "SELECT 'DELIMITER //'");
}

#[test]
fn delimiter_text_inside_a_line_comment_is_not_a_directive() {
    let stmts = split_statements("-- DELIMITER //\nSELECT 1;");
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("SELECT 1"));
}

#[test]
fn delimiter_with_trailing_junk_is_ordinary_text() {
    let stmts = split_statements("DELIMITER // extra\nSELECT 1;");
    assert_eq!(stmts.len(), 1);
    assert!(stmts[0].contains("DELIMITER // extra"), "got {:?}", stmts[0]);
}

#[test]
fn a_single_semicolon_is_ordinary_text_under_a_custom_delimiter() {
    let stmts = split_statements("DELIMITER //\nSELECT 1; SELECT 2//\nDELIMITER ;\nSELECT 3;");
    assert_eq!(stmts.len(), 2);
    assert!(stmts[0].contains("SELECT 1; SELECT 2"), "got {:?}", stmts[0]);
    assert_eq!(stmts[1], "SELECT 3");
}
