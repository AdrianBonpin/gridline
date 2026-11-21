use super::*;

fn plan(sql: &str) -> Vec<String> {
    plan_clean_drops("shop", &crate::db::sql_split::split_statements(sql))
}

#[test]
fn plans_a_drop_for_each_recreated_table() {
    let got = plan("CREATE TABLE `orders` (id int);\nCREATE TABLE IF NOT EXISTS users (id int);");
    assert_eq!(
        got,
        vec![
            "DROP TABLE IF EXISTS `shop`.`orders`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`users`".to_string(),
        ]
    );
}

#[test]
fn qualifies_unqualified_names_with_the_target_schema() {
    assert_eq!(
        plan("CREATE TABLE orders (id int);"),
        vec!["DROP TABLE IF EXISTS `shop`.`orders`".to_string()]
    );
}

#[test]
fn keeps_an_explicit_schema_qualifier() {
    assert_eq!(
        plan("CREATE TABLE `other`.`orders` (id int);"),
        vec!["DROP TABLE IF EXISTS `other`.`orders`".to_string()]
    );
}

#[test]
fn unwraps_mysqldump_version_comments_for_routines_and_triggers() {
    // This is the shape mysqldump actually emits for routines/triggers.
    let got = plan(
        "/*!50003 CREATE*/ /*!50020 DEFINER=`root`@`localhost`*/ /*!50003 PROCEDURE `p`() BEGIN END */;;\n\
         /*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg` BEFORE INSERT ON `orders` FOR EACH ROW BEGIN END */;;",
    );
    assert_eq!(
        got,
        vec![
            "DROP TRIGGER IF EXISTS `shop`.`trg`".to_string(),
            "DROP PROCEDURE IF EXISTS `shop`.`p`".to_string(),
        ]
    );
}

#[test]
fn deduplicates_repeated_objects() {
    let got = plan("CREATE TABLE a (id int);\nCREATE TABLE a (id int);");
    assert_eq!(got, vec!["DROP TABLE IF EXISTS `shop`.`a`".to_string()]);
}

#[test]
fn orders_dependents_before_tables() {
    let got = plan("CREATE TABLE t (id int);\nCREATE VIEW v AS SELECT 1;\nCREATE TRIGGER g BEFORE INSERT ON t FOR EACH ROW BEGIN END;");
    let kinds: Vec<&str> = got
        .iter()
        .map(|s| s.split_whitespace().nth(1).unwrap())
        .collect();
    assert_eq!(kinds, vec!["TRIGGER", "VIEW", "TABLE"]);
}

#[test]
fn ignores_non_create_statements() {
    let got = plan("INSERT INTO t VALUES (1);\nDROP TABLE x;\nALTER TABLE t ADD c int;\nSELECT 1;");
    assert!(got.is_empty(), "got {got:?}");
}

#[test]
fn skips_a_create_whose_name_cannot_be_determined() {
    // Fail closed: if we cannot name the object we must not guess at a DROP.
    let got = plan("CREATE TABLE (id int);");
    assert!(got.is_empty(), "got {got:?}");
}

#[test]
fn quoted_name_containing_a_dot_is_one_name() {
    // `` `my.table` `` is a single table called `my.table`, not schema `my`
    // plus table `table` — splitting on the dot would name a different object.
    assert_eq!(
        plan("CREATE TABLE `my.table` (id int);"),
        vec!["DROP TABLE IF EXISTS `shop`.`my.table`".to_string()]
    );
}

#[test]
fn quoted_dotted_name_after_an_explicit_schema_is_preserved() {
    assert_eq!(
        plan("CREATE TABLE `other`.`my.table` (id int);"),
        vec!["DROP TABLE IF EXISTS `other`.`my.table`".to_string()]
    );
}

#[test]
fn doubled_backtick_inside_a_name_is_emitted_once() {
    // MySQL escapes an embedded backtick by doubling it inside the identifier
    // quotes; re-quoting must not double it twice.
    assert_eq!(
        plan("CREATE TABLE `we``ird` (id int);"),
        vec!["DROP TABLE IF EXISTS `shop`.`we``ird`".to_string()]
    );
}

#[test]
fn drops_only_objects_the_dump_recreates() {
    // A clean restore drops what the dump creates and nothing else: data rows
    // mentioning a table, or objects already in the target, must not appear.
    let got = plan(
        "CREATE TABLE `orders` (id int);\n\
         INSERT INTO `orders` VALUES (1);\n\
         INSERT INTO `audit` VALUES ('CREATE TABLE unrelated (id int)');\n\
         DROP TABLE `legacy`;\n\
         CREATE VIEW `shop`.`report` AS SELECT 1;",
    );
    assert_eq!(
        got,
        vec![
            "DROP VIEW IF EXISTS `shop`.`report`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`orders`".to_string(),
        ]
    );
}

#[test]
fn recognises_a_comment_led_create() {
    // mysqldump prefixes statements with comment headers; the cheap "is this a
    // CREATE?" probe must skip them rather than reject the statement.
    assert_eq!(
        plan("-- setup\n/* note */ CREATE TABLE c (id int);"),
        vec!["DROP TABLE IF EXISTS `shop`.`c`".to_string()]
    );
}
