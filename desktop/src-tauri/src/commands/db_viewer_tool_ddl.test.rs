//! Ticket 28 — copied table DDL is the payload, verbatim.
//!
//! `pg_dump`'s stdout *is* the `CREATE TABLE` statement the user asked to copy.
//! It is **payload**, not a diagnostic, so it must not pass through the
//! error-path sanitizer: redaction rewrites legal SQL (a `DEFAULT
//! 'postgresql://…'`, a comment, a check constraint), and the error-path cap cut
//! every statement at 400 bytes, so anything but a trivial table was copied
//! truncated and unusable.
//!
//! What the same job's failure *is* — stderr — stays a diagnostic: redacted,
//! Unicode-safe, and bounded. And because a panic while holding shared state
//! poisons a `std::sync::Mutex` for the rest of the process, the DDL path
//! recovers a poisoned guard instead of failing every later copy forever.

use super::*;
use std::sync::{Arc, Mutex as StdMutex};

// ---------------------------------------------------------------------------
// Payload: complete and faithful
// ---------------------------------------------------------------------------

/// A realistic table DDL (several KiB: columns, constraints, indexes, comments)
/// is returned exactly as `pg_dump` wrote it.
#[test]
fn a_long_create_table_is_returned_in_full() {
    let mut ddl =
        String::from("--\n-- PostgreSQL database dump\n--\n\nCREATE TABLE public.events (\n");
    for i in 0..120 {
        ddl.push_str(&format!(
            "    column_{i} character varying(255) DEFAULT 'v{i}'::character varying,\n"
        ));
    }
    ddl.push_str("    id bigint NOT NULL,\n    created_at timestamp with time zone DEFAULT now() NOT NULL\n);\n\n");
    ddl.push_str("ALTER TABLE ONLY public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);\n\n");
    for i in 0..20 {
        ddl.push_str(&format!(
            "CREATE INDEX events_idx_{i} ON public.events USING btree (column_{i});\n"
        ));
    }
    ddl.push_str("COMMENT ON TABLE public.events IS 'audit trail';\n");
    assert!(ddl.len() > 8_000, "a statement no 400-byte cap could hold");

    let payload = ddl_from_dump_output(
        "public.events",
        true,
        ddl.as_bytes(),
        b"pg_dump: warning: no privileges could be revoked\n",
    )
    .expect("a successful dump is a payload");

    assert_eq!(payload, ddl, "the payload is returned verbatim");
    assert!(
        payload
            .trim_end()
            .ends_with("COMMENT ON TABLE public.events IS 'audit trail';"),
        "the statement survives to its last line"
    );
    assert!(
        payload.contains("column_119"),
        "the last column of a wide table is present"
    );
    assert!(
        payload.contains("events_idx_19"),
        "the last index is present"
    );
    assert_eq!(
        payload.matches('(').count(),
        payload.matches(')').count(),
        "balanced parentheses: the SQL is still valid"
    );
}

/// Connection-string-shaped text inside the DDL is SQL, not a credential leak:
/// it is neither redacted nor rewritten.
#[test]
fn ddl_containing_connection_strings_is_not_redacted() {
    let ddl = concat!(
        "CREATE TABLE public.app_settings (\n",
        "    key text NOT NULL,\n",
        "    value text DEFAULT 'postgresql://app:hunter2@db.internal:5432/app?sslmode=require'::text,\n",
        "    note text DEFAULT 'password=hunter2 user=admin'\n",
        ");\n\n",
        "-- mirrors redis://:hunter2@cache.internal:6379/0\n",
        "COMMENT ON COLUMN public.app_settings.value IS 'postgresql://app:hunter2@db.internal/app';\n",
    );

    let payload =
        ddl_from_dump_output("public.app_settings", true, ddl.as_bytes(), b"").expect("payload");

    assert_eq!(
        payload, ddl,
        "DDL is payload: the statement is copied byte for byte"
    );
    assert!(
        payload.contains("postgresql://app:hunter2@db.internal:5432/app?sslmode=require"),
        "the DEFAULT is untouched"
    );
    assert!(
        payload.contains("password=hunter2 user=admin"),
        "a literal that looks like a credential key is untouched"
    );
    assert!(
        !payload.contains("[redacted"),
        "no redaction marker may appear in a payload: {payload}"
    );
}

/// A successful dump that printed nothing is not a silent empty copy.
#[test]
fn a_dump_without_output_is_reported_not_returned_empty() {
    let err = ddl_from_dump_output("public.missing", true, b"  \n\t\n", b"").unwrap_err();
    assert!(
        err.contains("public.missing"),
        "the missing table is named: {err}"
    );
    assert!(
        !err.contains("[redacted"),
        "an empty payload is not a diagnostic: {err}"
    );
}

/// The SQLite branch is a payload path too: the stored statement comes back
/// whole, no matter how long it is.
#[test]
fn a_long_sqlite_table_definition_is_returned_in_full() {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
    let columns: Vec<String> = (0..100)
        .map(|i| format!("column_{i} TEXT DEFAULT 'v{i}'"))
        .collect();
    let create = format!("CREATE TABLE wide (\n  {}\n)", columns.join(",\n  "));
    conn.execute_batch(&create).expect("create the wide table");

    let stored: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='wide'",
            [],
            |row| row.get(0),
        )
        .expect("stored definition");
    assert!(stored.len() > 2_000, "a definition no cap could hold");

    let ddl = get_sqlite_ddl(&conn, "wide").expect("the table DDL");
    assert_eq!(ddl, stored, "the stored statement is returned verbatim");
    assert!(ddl.contains("column_99"), "the last column is present");
}

// ---------------------------------------------------------------------------
// Diagnostics: the failure path of the same job
// ---------------------------------------------------------------------------

/// A failed dump reports a redacted, bounded diagnostic — the credentials on
/// `pg_dump`'s stderr never reach the renderer, and the detail survives.
#[test]
fn a_failed_dump_is_a_redacted_bounded_diagnostic() {
    let stderr = "pg_dump: error: connection to server at \"db.internal\" failed: \
                  password=hunter2 postgresql://app:hunter2@db.internal:5432/app refused"
        .repeat(200);
    let err = ddl_from_dump_output("public.events", false, b"", stderr.as_bytes()).unwrap_err();

    assert!(!err.contains("hunter2"), "no credential survives: {err}");
    assert!(
        err.len() <= crate::diagnostics::MAX_ERROR_BYTES,
        "bounded at the error cap, was {} bytes",
        err.len()
    );
    assert!(
        err.starts_with("pg_dump: error:"),
        "the tool's own message leads: {err}"
    );
}

/// A diagnostic whose cap lands inside a multi-byte character is truncated at a
/// character boundary instead of panicking.
#[test]
fn a_failed_dump_truncates_at_a_character_boundary() {
    // 396 ASCII bytes, then a 3-byte character straddling the cut index 397.
    let stderr = format!("pg_dump: error: {}日本語", "x".repeat(382));
    let err = ddl_from_dump_output("public.events", false, b"", stderr.as_bytes()).unwrap_err();
    assert!(err.len() <= crate::diagnostics::MAX_ERROR_BYTES, "{err}");
    assert!(err.starts_with("pg_dump: error:"), "{err}");
}

/// A failed dump with no diagnostic text still fails visibly.
#[test]
fn a_failed_dump_without_a_diagnostic_is_not_a_silent_success() {
    let err = ddl_from_dump_output("public.events", false, b"", b"").unwrap_err();
    assert!(err.contains("pg_dump"), "the failure names the tool: {err}");
}

// ---------------------------------------------------------------------------
// Shared state: one failure must not wedge DDL copy forever
// ---------------------------------------------------------------------------

/// A panic on a diagnostic path poisons its `Mutex`; the DDL path must still be
/// able to read the shared state afterwards instead of failing every copy.
#[test]
fn a_poisoned_shared_lock_does_not_wedge_ddl_copy() {
    let shared = Arc::new(StdMutex::new(vec!["public.events".to_string()]));
    let poisoner = shared.clone();
    let panicked = std::thread::spawn(move || {
        let _guard = poisoner.lock().expect("uncontended");
        panic!("a diagnostic path panicked while holding the shared lock");
    })
    .join();
    assert!(panicked.is_err(), "the fixture poisoned the lock");
    assert!(
        shared.lock().is_err(),
        "a plain `lock()` now reports the poison"
    );

    // The DDL path's reader recovers the guard: the store holds no invariant a
    // panic could have left half-updated, so the data is still usable.
    let rows = lock_recovering_poison(&shared);
    assert_eq!(rows.len(), 1, "the state is still readable");
    assert_eq!(rows[0], "public.events");
}
