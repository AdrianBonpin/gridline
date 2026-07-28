use super::*;

// ------------------------------------------------------------------
// build_args_for_test  (unit tests for arg construction logic)
// ------------------------------------------------------------------

#[test]
fn build_pg_dump_args_plain_format() {
    let args = build_args_for_test(
        "pg_dump",
        "mydb",
        "plain",
        "/tmp/dump.sql",
        true,
        None,
        None,
    );
    assert!(
        args.iter().any(|a| a.contains("--no-owner")),
        "should include --no-owner"
    );
    assert!(
        args.iter().any(|a| a == "--file=/tmp/dump.sql"),
        "should include --file flag"
    );
    // plain format should NOT add a --format flag
    assert!(
        !args.iter().any(|a| a.starts_with("--format")),
        "plain format should not emit --format"
    );
}

#[test]
fn build_pg_dump_args_custom_format() {
    let args = build_args_for_test(
        "pg_dump",
        "mydb",
        "custom",
        "/tmp/dump.bak",
        true,
        Some("public"),
        None,
    );
    assert!(
        args.iter().any(|a| a == "--format=c"),
        "custom format should emit --format=c"
    );
    assert!(
        args.iter().any(|a| a == "--schema=public"),
        "should include --schema flag"
    );
}

#[test]
fn build_pg_dump_args_tar_format() {
    let args = build_args_for_test(
        "pg_dump",
        "testdb",
        "tar",
        "/tmp/test.tar",
        false,
        None,
        None,
    );
    assert!(
        args.iter().any(|a| a == "--format=t"),
        "should emit --format=t"
    );
    assert!(
        !args.iter().any(|a| a.contains("--no-owner")),
        "should NOT include --no-owner when false"
    );
}

#[test]
fn build_pg_dump_args_directory_format() {
    let args = build_args_for_test(
        "pg_dump",
        "proddb",
        "directory",
        "/tmp/dumpdir",
        false,
        None,
        Some(vec!["users", "orders"]),
    );
    assert!(
        args.iter().any(|a| a == "--format=d"),
        "should emit --format=d"
    );
    assert!(args.iter().any(|a| a == "--table=users"));
    assert!(args.iter().any(|a| a == "--table=orders"));
}

#[test]
fn build_pg_restore_args() {
    let args = build_args_for_test(
        "pg_restore",
        "targetdb",
        "custom",
        "/tmp/dump.bak",
        false,
        None,
        None,
    );
    // pg_restore should NOT emit --file=, it should pass the path as positional
    assert!(
        !args.iter().any(|a| a.starts_with("--file")),
        "pg_restore should not use --file flag"
    );
    assert!(
        args.iter().any(|a| a == "/tmp/dump.bak"),
        "pg_restore should include file path as positional arg"
    );
}

#[test]
fn build_pg_restore_args_with_schema() {
    let args = build_args_for_test(
        "pg_restore",
        "mydb",
        "plain",
        "/tmp/dump.sql",
        false,
        Some("public"),
        None,
    );
    assert!(args.iter().any(|a| a == "--schema=public"));
}

// ------------------------------------------------------------------
// detect_pg_tools
// ------------------------------------------------------------------

#[test]
fn detect_pg_tools_does_not_panic() {
    let status = detect_pg_tools();
    // May or may not find tools, but the call itself must not panic
    let _ = status.pg_dump_found;
    let _ = status.pg_restore_found;
    let _ = status.pg_dump_version;
    let _ = status.pg_restore_version;
}

#[test]
fn pg_tool_status_serialization() {
    let status = PgToolStatus {
        pg_dump_found: true,
        pg_restore_found: false,
        pg_dump_version: Some("pg_dump (PostgreSQL) 16.0".into()),
        pg_restore_version: None,
    };
    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("pg_dump_found"));
    assert!(json.contains("pg_restore_found"));
    assert!(json.contains("pg_dump (PostgreSQL) 16.0"));
}

// ------------------------------------------------------------------
// BackupProgressEvent serialization
// ------------------------------------------------------------------

#[test]
fn backup_progress_event_completed() {
    let evt = BackupProgressEvent {
        job_id: "job-1".into(),
        status: "completed".into(),
        progress: Some(1.0),
        output_line: None,
        error: None,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"completed\""));
    assert!(json.contains("\"progress\":1.0"));
}

#[test]
fn backup_progress_event_failed() {
    let evt = BackupProgressEvent {
        job_id: "job-2".into(),
        status: "failed".into(),
        progress: None,
        output_line: None,
        error: Some("connection refused".into()),
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"failed\""));
    assert!(json.contains("\"connection refused\""));
}