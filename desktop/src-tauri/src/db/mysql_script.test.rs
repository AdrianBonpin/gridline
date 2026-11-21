use super::*;

fn texts(script: &str) -> Vec<String> {
    MySqlScript::new(script)
        .map(|s| s.text.into_owned())
        .collect()
}

// ── dialect escapes ────────────────────────────────────────────────

#[test]
fn splits_backslash_escaped_quotes() {
    // MySQL string literals escape a quote with a backslash. Treating the
    // `\'` as a terminator would split the row in half and restore garbage.
    assert_eq!(
        texts("INSERT INTO `t` VALUES ('it\\'s; fine'); SELECT 2;"),
        vec![
            "INSERT INTO `t` VALUES ('it\\'s; fine')".to_string(),
            "SELECT 2".to_string(),
        ]
    );
}

#[test]
fn escaped_backslash_before_the_closing_quote_does_not_swallow_the_next_statement() {
    // `'a\\'` is a string holding one backslash: the quote after the escaped
    // backslash really does close it, so the following `;` is a boundary.
    assert_eq!(
        texts("INSERT INTO t VALUES ('a\\\\'); SELECT 2;"),
        vec![
            "INSERT INTO t VALUES ('a\\\\')".to_string(),
            "SELECT 2".to_string(),
        ]
    );
}

#[test]
fn a_dump_with_both_escapes_and_doubled_quotes_splits_exactly() {
    // Criterion 1: real mysqldump output carries both forms in one file.
    let dump = "CREATE TABLE `t` (id int, note varchar(50));\n\
                INSERT INTO `t` VALUES (1,'it\\'s O''Brien; ok');\n\
                INSERT INTO `t` VALUES (2,'back\\\\slash');\n\
                INSERT INTO `t` VALUES (3,'semi;colon;s');\n";
    let got = texts(dump);
    assert_eq!(got.len(), 4, "got {got:#?}");
    assert_eq!(got[0], "CREATE TABLE `t` (id int, note varchar(50))");
    assert_eq!(got[1], "INSERT INTO `t` VALUES (1,'it\\'s O''Brien; ok')");
    assert_eq!(got[2], "INSERT INTO `t` VALUES (2,'back\\\\slash')");
    assert_eq!(got[3], "INSERT INTO `t` VALUES (3,'semi;colon;s')");
}

#[test]
fn a_dotted_quoted_object_name_survives_splitting() {
    assert_eq!(
        texts("CREATE TABLE `my.table` (id int);\nSELECT 1;"),
        vec![
            "CREATE TABLE `my.table` (id int)".to_string(),
            "SELECT 1".to_string(),
        ]
    );
}

#[test]
fn semicolons_inside_identifiers_are_not_boundaries() {
    assert_eq!(
        texts("SELECT `x;y` FROM `a``b;c`; SELECT 2;"),
        vec![
            "SELECT `x;y` FROM `a``b;c`".to_string(),
            "SELECT 2".to_string(),
        ]
    );
}

#[test]
fn an_unterminated_quote_keeps_the_rest_in_one_statement() {
    // Conservative: a fragment we cannot confidently close is never split into
    // pieces that could be executed on their own.
    assert_eq!(
        texts("SELECT 'oops; SELECT 2;"),
        vec!["SELECT 'oops; SELECT 2;".to_string()]
    );
}

// ── comments ───────────────────────────────────────────────────────

#[test]
fn line_comments_are_not_splits_and_keep_their_semicolons() {
    assert_eq!(
        texts("-- a; comment\nSELECT 1;\n-- another; one\nSELECT 2;"),
        vec![
            "-- a; comment\nSELECT 1".to_string(),
            "-- another; one\nSELECT 2".to_string(),
        ]
    );
}

#[test]
fn a_hash_comment_apostrophe_cannot_swallow_following_statements() {
    // MySQL's `#` comment is not SQL-standard. Without it, the apostrophe in
    // "don't" opens a string literal that runs to EOF and silently merges every
    // later statement into one unsendable fragment.
    assert_eq!(
        texts("# don't; split here\nSELECT 1;\nSELECT 2;"),
        vec![
            "# don't; split here\nSELECT 1".to_string(),
            "SELECT 2".to_string(),
        ]
    );
}

#[test]
fn a_double_hyphen_without_whitespace_is_not_a_comment() {
    // MySQL requires whitespace after `--`; `1--2` is arithmetic, and treating
    // it as a comment would delete the rest of the statement.
    assert_eq!(
        texts("SELECT 1--2; SELECT 3;"),
        vec!["SELECT 1--2".to_string(), "SELECT 3".to_string(),]
    );
}

#[test]
fn block_comments_are_kept_but_comment_only_fragments_are_dropped() {
    assert_eq!(
        texts("/* header */\n;\n/* another */ SELECT 1;"),
        vec!["/* another */ SELECT 1".to_string()]
    );
}

// ── client directives (routines / triggers) ────────────────────────

#[test]
fn custom_delimiters_keep_a_routine_body_in_one_statement() {
    let script = "DELIMITER ;;\n\
                  CREATE PROCEDURE `p`() BEGIN SELECT 1; SELECT 2; END ;;\n\
                  DELIMITER ;\n\
                  SELECT 3;\n";
    assert_eq!(
        texts(script),
        vec![
            "CREATE PROCEDURE `p`() BEGIN SELECT 1; SELECT 2; END".to_string(),
            "SELECT 3".to_string(),
        ]
    );
}

#[test]
fn a_directive_inside_a_statement_does_not_leave_the_directive_in_the_text() {
    // mysqldump puts a `DELIMITER ;;` line between statements, but if one ever
    // lands mid-fragment the sent SQL must not contain the client directive.
    let script = "CREATE TRIGGER `g` BEFORE INSERT ON `t` FOR EACH ROW BEGIN\n\
                  DELIMITER ;;\n\
                  SET @x = 1; END ;;\n\
                  DELIMITER ;\n";
    let got = texts(script);
    assert_eq!(got.len(), 1, "got {got:#?}");
    assert!(!got[0].contains("DELIMITER"), "got {got:?}");
    assert!(got[0].contains("SET @x = 1;"), "got {got:?}");
}

#[test]
fn version_comments_alone_are_statements() {
    // mysqldump wraps routine/trigger definitions in executable comments with
    // no surrounding SQL; the server runs them.
    let script = "/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg` BEFORE INSERT ON `t` FOR EACH ROW BEGIN END */;;\n\
                  DELIMITER ;\n";
    let got = texts(script);
    assert_eq!(got.len(), 1, "got {got:#?}");
    assert!(got[0].contains("TRIGGER `trg`"), "got {got:?}");
}

// ── position ───────────────────────────────────────────────────────

#[test]
fn statements_report_their_index_and_starting_line() {
    let script = "CREATE TABLE a (id int);\n\nSELECT 1;\nSELECT 2;\n";
    let got: Vec<(usize, usize, String)> = MySqlScript::new(script)
        .map(|s| (s.index, s.line, s.text.into_owned()))
        .collect();
    assert_eq!(
        got,
        vec![
            (1, 1, "CREATE TABLE a (id int)".to_string()),
            (2, 3, "SELECT 1".to_string()),
            (3, 4, "SELECT 2".to_string()),
        ]
    );
}

#[test]
fn a_statement_after_a_multiline_comment_reports_the_sql_line() {
    let script = "/* one\ntwo\nthree */\nSELECT 1;";
    let got: Vec<(usize, usize)> = MySqlScript::new(script)
        .map(|s| (s.index, s.line))
        .collect();
    assert_eq!(got, vec![(1, 4)]);
}

// ── memory behavior ────────────────────────────────────────────────

#[test]
fn statements_borrow_from_the_script_without_copies() {
    // Criterion 3: a dump at the 100 MB cap must not be duplicated in memory.
    // Every statement is a borrowed slice of the one buffer that was read from
    // disk, so the extra memory is the statement index (16 bytes/statement),
    // never a second copy of the SQL text.
    let mut script = String::new();
    for i in 0..20_000 {
        script.push_str(&format!("INSERT INTO `t` VALUES ({i}, 'v{i};');\n"));
    }
    let src_start = script.as_ptr() as usize;
    let src_end = src_start + script.len();

    let mut borrowed = 0usize;
    let mut texts_bytes = 0usize;
    for stmt in MySqlScript::new(&script) {
        let text = stmt.text.as_ref();
        borrowed += usize::from(matches!(stmt.text, std::borrow::Cow::Borrowed(_)));
        texts_bytes += text.len();
        let p = text.as_ptr() as usize;
        assert!(
            p >= src_start && p + text.len() <= src_end,
            "statement text must point inside the source buffer"
        );
    }
    assert_eq!(borrowed, 20_000, "every statement must borrow, not copy");
    assert!(
        texts_bytes <= script.len(),
        "statements must not duplicate the source text ({texts_bytes} > {})",
        script.len()
    );
}

#[test]
fn only_a_statement_split_by_a_directive_is_owned() {
    let script = "CREATE TRIGGER `g` BEFORE INSERT ON `t` FOR EACH ROW BEGIN\n\
                  DELIMITER ;;\n\
                  SET @x = 1; END ;;\n\
                  DELIMITER ;\n\
                  SELECT 1;\n";
    let owned: Vec<bool> = MySqlScript::new(script)
        .map(|s| matches!(s.text, std::borrow::Cow::Owned(_)))
        .collect();
    // The trigger spans a directive line so its text is joined; `SELECT 1`
    // borrows straight out of the script.
    assert_eq!(owned, vec![true, false]);
}

#[test]
fn a_multibyte_character_after_a_backslash_stays_on_a_char_boundary() {
    // `\é` escapes one (two-byte) character; the scanner must not resume in the
    // middle of it and panic on a non-boundary slice.
    let got = texts("INSERT INTO t VALUES ('caf\\é; ok'); SELECT 2;");
    assert_eq!(
        got,
        vec![
            "INSERT INTO t VALUES ('caf\\é; ok')".to_string(),
            "SELECT 2".to_string(),
        ]
    );
}
