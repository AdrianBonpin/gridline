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
