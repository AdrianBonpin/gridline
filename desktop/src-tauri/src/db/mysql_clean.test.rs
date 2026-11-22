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

// ---------------------------------------------------------------------------
// Confinement: replay and the clean plan must agree about which schema an
// object lives in.
// ---------------------------------------------------------------------------

fn confined(target: &str, sql: &str) -> Result<(), String> {
    check_confined(
        target,
        &crate::db::mysql_script::MySqlScript::new(sql).collect::<Vec<_>>(),
    )
}

#[test]
fn confinement_refuses_a_use_of_another_schema() {
    // What `mysqldump --databases shop` emits. Replaying this verbatim wrote
    // into `shop` while the clean plan dropped `target`.`t`.
    let err = confined("target", "USE `shop`;\nCREATE TABLE `t` (id int);")
        .expect_err("a dump that switches schema must be refused");
    assert!(
        err.contains("`shop`"),
        "the message must name the schema: {err}"
    );
    assert!(
        err.contains("`target`"),
        "the message must name the target: {err}"
    );
    assert!(
        !err.contains("CREATE TABLE"),
        "the statement text must never be echoed: {err}"
    );
}

#[test]
fn confinement_accepts_a_use_of_the_target_schema() {
    confined("shop", "USE `shop`;\nCREATE TABLE `t` (id int);")
        .expect("the target schema is allowed");
    confined("SHOP", "USE `shop`;").expect("schema names compare case-insensitively");
}

#[test]
fn confinement_refuses_a_create_in_another_schema() {
    let err = confined("target", "CREATE TABLE `other`.`t` (id int);")
        .expect_err("a qualified CREATE escapes the target");
    assert!(err.contains("`other`"), "got: {err}");
    assert!(
        err.contains("Statement 1"),
        "the message must point at the statement: {err}"
    );
}

#[test]
fn confinement_refuses_a_drop_of_another_schema() {
    let err = confined("target", "DROP TABLE IF EXISTS `other`.`t`;")
        .expect_err("a qualified DROP escapes the target");
    assert!(err.contains("`other`"), "got: {err}");
}

#[test]
fn confinement_refuses_a_create_database() {
    let err = confined(
        "target",
        "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `other`;",
    )
    .expect_err("creating another database is outside the target");
    assert!(err.contains("`other`"), "got: {err}");
}

#[test]
fn confinement_accepts_the_shapes_a_mysqldump_script_actually_has() {
    // Aliases, string literals with dots, view bodies, routines wrapped in
    // executable comments and a comma-separated DROP list must all pass: the
    // check reads object-name positions only.
    let dump = "\
SET NAMES utf8mb4;
CREATE TABLE `orders` (id int, note varchar(10));
INSERT INTO `orders` VALUES (1, 'a.b');
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v` AS SELECT `o`.`id` AS `id` FROM `orders` `o`;
/*!50003 CREATE*/ /*!50020 DEFINER=`root`@`localhost`*/ /*!50003 PROCEDURE `p`() BEGIN DROP TABLE `scratch`; END */;;
DROP TABLE IF EXISTS `a`, `b`;
ALTER TABLE `orders` ADD COLUMN extra int;
USE `target`;
";
    confined("target", dump).expect("a plain single-database dump is confined by construction");
}

#[test]
fn confinement_keeps_the_clean_plan_inside_the_target_schema() {
    // The agreement the finding is about: every DROP the clean phase plans names
    // the target schema, for a script the replay accepts.
    let sql = "USE `shop`;\nCREATE TABLE `orders` (id int);\nCREATE TABLE `users` (id int);";
    confined("shop", sql).expect("confined");
    let drops = plan_clean_drops(
        "shop",
        &crate::db::mysql_script::MySqlScript::new(sql).collect::<Vec<_>>(),
    );
    assert_eq!(
        drops,
        vec![
            "DROP TABLE IF EXISTS `shop`.`orders`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`users`".to_string(),
        ]
    );
}

#[test]
fn confinement_points_at_the_offending_statement() {
    let err = confined("target", "CREATE TABLE `a` (id int);\nUSE `other`;\n")
        .expect_err("the second statement switches schema");
    assert!(err.contains("Statement 2"), "got: {err}");
}

/// The clean plan qualifies an unqualified name with the **target**, which is
/// only correct because the replay is confined: this script is refused before
/// either phase runs. The test pins both halves of that agreement so the
/// confinement cannot be dropped as "cosmetic" — without it, the DROP below would
/// hit `target.orders` while the replay created `shop.orders`.
#[test]
fn the_clean_plan_is_only_meaningful_because_the_replay_is_confined() {
    let sql = "USE `shop`;\nCREATE TABLE `orders` (id int);";
    let statements = crate::db::mysql_script::MySqlScript::new(sql).collect::<Vec<_>>();

    assert!(
        check_confined("target", &statements).is_err(),
        "the replay must refuse to switch schema"
    );
    assert_eq!(
        plan_clean_drops("target", &statements),
        vec!["DROP TABLE IF EXISTS `target`.`orders`".to_string()],
        "the plan names the target schema, so it must never run against a script \
         whose replay would write into `shop`"
    );
}
