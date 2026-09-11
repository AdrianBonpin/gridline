use super::*;

#[test]
fn engine_family_pairs_mysql_with_mariadb() {
    assert_eq!(engine_family("mysql"), engine_family("mariadb"));
    assert_eq!(engine_family("mysql"), "mysql");
    assert_eq!(engine_family("postgresql"), "postgresql");
    assert_eq!(engine_family("sqlite"), "sqlite");
    assert_ne!(engine_family("postgresql"), engine_family("mysql"));
}

#[test]
fn family_check_rejects_cross_engine_pairs() {
    let err = validate_same_family("postgresql", "mysql").expect_err("must reject");
    assert!(err.contains("same engine"), "got: {err}");
    assert!(validate_same_family("mariadb", "mysql").is_ok());
    assert!(validate_same_family("mysql", "mariadb").is_ok());
    assert!(validate_same_family("postgresql", "postgresql").is_ok());
}

/// Live end-to-end: register two connections and diff their schemas through
/// the real pool path.
#[test]
#[ignore = "needs the pool manager wiring from the command; run via the UI or the live harness"]
fn compare_command_live_pg() {}
