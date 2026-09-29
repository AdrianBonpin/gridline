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
