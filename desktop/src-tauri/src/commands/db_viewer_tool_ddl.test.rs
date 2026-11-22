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

// ---------------------------------------------------------------------------
// F1: this tool job enforces the connection's TLS decision
// ---------------------------------------------------------------------------
//
// Copying a table's schema is a `pg_dump` job like a backup, but this one used
// to spawn the tool with `PGPASSWORD` alone — so libpq ran at its default
// `prefer` and a `verify-full` connection could be stripped to plaintext by an
// attacker on the very network the user hardened against, password included.
//
// These tests drive the real invocation with a fake `pg_dump` and read back what
// *that* process actually received, so they fail if the environment stops being
// applied here (rather than in some other call site).

use crate::commands::backup::PgConnParams;

/// A `pg_dump` stand-in that records the environment and argv of its real
/// invocation while printing fixed DDL. `--version` is answered separately: the
/// availability probe must not count as "the dump ran".
#[cfg(unix)]
struct FakeDump {
    dir: std::path::PathBuf,
    path: String,
}

#[cfg(unix)]
impl FakeDump {
    fn new(tag: &str, ddl: &str) -> Self {
        use std::io::Write as _;
        use std::os::unix::fs::PermissionsExt as _;

        let dir = std::env::temp_dir().join(format!(
            "gridline_ddl_{tag}_{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let ddl_file = dir.join("ddl.sql");
        std::fs::write(&ddl_file, ddl).unwrap();
        let script = format!(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 'pg_dump (PostgreSQL) 16.4'; exit 0; fi\n\
             env > '{}'\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             cat '{}'\n",
            dir.join("env.txt").display(),
            dir.join("argv.txt").display(),
            ddl_file.display()
        );
        let path = dir.join("pg_dump");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(script.as_bytes()).unwrap();
        file.flush().unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&path, perms).unwrap();
        let path = path.to_string_lossy().to_string();
        Self { dir, path }
    }

    fn env(&self) -> String {
        std::fs::read_to_string(self.dir.join("env.txt")).expect("the dump ran")
    }

    fn argv(&self) -> String {
        std::fs::read_to_string(self.dir.join("argv.txt")).expect("the dump ran")
    }

    /// Whether the *dump* ran (the `--version` probe writes nothing here).
    fn ran(&self) -> bool {
        self.dir.join("env.txt").exists()
    }
}

#[cfg(unix)]
impl Drop for FakeDump {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[cfg(unix)]
fn env_value(env: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    env.lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .map(str::to_string)
}

#[cfg(unix)]
fn params_with(mode: Option<&str>) -> PgConnParams {
    PgConnParams::new(
        "db.example.com".into(),
        5432,
        "app".into(),
        "appdb".into(),
        "hunter2".into(),
    )
    .with_tls(
        mode.map(str::to_string),
        Some("/etc/ssl/ca.pem".into()),
        None,
        None,
    )
}

/// The copy's own `pg_dump` is told to verify TLS, with the connection's CA —
/// not left at libpq's `prefer`.
#[cfg(unix)]
#[test]
fn a_ddl_copy_tells_its_own_pg_dump_to_verify_tls() {
    let dump = FakeDump::new("tls_verify", "CREATE TABLE public.events (id bigint);\n");

    let ddl = get_pg_ddl_via_dump(
        "public",
        "events",
        &params_with(Some("verify-full")),
        &dump.path,
    )
    .expect("the copy runs");

    assert_eq!(
        ddl, "CREATE TABLE public.events (id bigint);\n",
        "the payload is still returned verbatim"
    );
    let env = dump.env();
    assert_eq!(
        env_value(&env, "PGSSLMODE").as_deref(),
        Some("verify-full"),
        "the tool must verify, not prefer:\n{env}"
    );
    assert_eq!(
        env_value(&env, "PGSSLROOTCERT").as_deref(),
        Some("/etc/ssl/ca.pem"),
        "the connection's CA bundle must reach this process:\n{env}"
    );
    assert_eq!(
        env_value(&env, "PGHOSTADDR"),
        None,
        "a direct connection dials --host; no separate address is injected:\n{env}"
    );
    let argv = dump.argv();
    assert!(
        argv.contains("--host=db.example.com"),
        "the saved server is what is dialed: {argv}"
    );
    assert!(
        argv.contains("--port=5432"),
        "a direct connection keeps the saved port: {argv}"
    );
    assert!(
        !argv.contains("hunter2"),
        "the credential still never reaches argv: {argv}"
    );
}

/// Through an SSH tunnel the tool dials the tunnel's loopback listener while the
/// *verification target* stays the saved server name.
///
/// This is the deliberate decision for the tunnel wrinkle: handing
/// `127.0.0.1` to `--host` would make `verify-full` authenticate the certificate
/// against loopback — fail, or invite the downgrade this fix exists to prevent —
/// so the address moves to libpq's `PGHOSTADDR` (the same split
/// `db::tls::PgConnectPlan` makes for the app's driver, which is what makes the
/// tools neither looser nor stricter than browsing).
///
/// libpq's split was measured, not assumed (PostgreSQL 18.6, CA-signed cert for
/// `pgtest.example`, server listening only on `127.0.0.1`):
///
/// * `--host=pgtest.example PGHOSTADDR=127.0.0.1 sslmode=verify-full` connects
///   (no DNS for the name, certificate verified);
/// * the same with `--host=other.example` fails with `server certificate for
///   "pgtest.example" does not match host name "other.example"` — so the
///   certificate is checked against `--host`, never against the dialed address;
/// * `--host=127.0.0.1` (what this path used to dial) fails the same way, which
///   is exactly the downgrade-into-failure this test pins down.
#[cfg(unix)]
#[test]
fn a_tunnelled_ddl_copy_verifies_the_saved_server_while_dialing_loopback() {
    let dump = FakeDump::new("tls_tunnel", "CREATE TABLE public.events (id bigint);\n");
    let params = params_with(Some("verify-full"))
        .through_tunnel(std::net::IpAddr::from([127, 0, 0, 1]), 5433);

    get_pg_ddl_via_dump("public", "events", &params, &dump.path).expect("the copy runs");

    let env = dump.env();
    assert_eq!(
        env_value(&env, "PGHOSTADDR").as_deref(),
        Some("127.0.0.1"),
        "the address actually dialed is the tunnel listener:\n{env}"
    );
    assert_eq!(
        env_value(&env, "PGSSLMODE").as_deref(),
        Some("verify-full"),
        "verification is unchanged by the tunnel:\n{env}"
    );
    let argv = dump.argv();
    assert!(
        argv.contains("--host=db.example.com"),
        "the certificate is verified against the saved server, not loopback: {argv}"
    );
    assert!(
        !argv.contains("127.0.0.1"),
        "loopback is the dialed address, never the verification target: {argv}"
    );
    assert!(
        argv.contains("--port=5433"),
        "the dialed port follows the tunnel: {argv}"
    );
}

/// With no mode configured nothing is exported: an ordinary local connection
/// keeps libpq's own `prefer` (attempt TLS, never insist) because no decision
/// was taken away from it. A tunnelled connection of the same kind still gets
/// its tunnel address — the plaintext-capable hop there is loopback, inside the
/// encrypted SSH session.
#[cfg(unix)]
#[test]
fn a_ddl_copy_without_a_configured_mode_leaves_libpq_prefer_alone() {
    let plain = FakeDump::new("tls_absent", "CREATE TABLE public.events (id bigint);\n");
    let params = PgConnParams::new(
        "localhost".into(),
        5432,
        "app".into(),
        "appdb".into(),
        "hunter2".into(),
    );
    get_pg_ddl_via_dump("public", "events", &params, &plain.path).expect("the copy runs");

    let env = plain.env();
    for key in [
        "PGSSLMODE",
        "PGSSLROOTCERT",
        "PGSSLCERT",
        "PGSSLKEY",
        "PGHOSTADDR",
    ] {
        assert_eq!(
            env_value(&env, key),
            None,
            "an unconfigured connection exports no {key}, so nothing is relaxed:\n{env}"
        );
    }

    let tunnelled = FakeDump::new(
        "tls_absent_tunnel",
        "CREATE TABLE public.events (id bigint);\n",
    );
    let params = PgConnParams::new(
        "localhost".into(),
        5432,
        "app".into(),
        "appdb".into(),
        "hunter2".into(),
    )
    .through_tunnel(std::net::IpAddr::from([127, 0, 0, 1]), 5433);
    get_pg_ddl_via_dump("public", "events", &params, &tunnelled.path).expect("the copy runs");
    let env = tunnelled.env();
    assert_eq!(
        env_value(&env, "PGHOSTADDR").as_deref(),
        Some("127.0.0.1"),
        "the tunnel address is still routed:\n{env}"
    );
    assert_eq!(
        env_value(&env, "PGSSLMODE"),
        None,
        "no mode was configured, so libpq's `prefer` stands:\n{env}"
    );
}

/// A stored mode libpq cannot enforce fails the copy *before* the tool runs,
/// instead of silently reaching libpq as `prefer`.
#[cfg(unix)]
#[test]
fn an_unenforceable_mode_fails_the_copy_before_pg_dump_runs() {
    let dump = FakeDump::new("tls_unknown", "CREATE TABLE public.events (id bigint);\n");

    let err = get_pg_ddl_via_dump("public", "events", &params_with(Some("prefer")), &dump.path)
        .expect_err("an unknown mode must fail closed");

    assert!(
        err.contains("unknown TLS mode") && err.contains("verify-full"),
        "the error names the valid set: {err}"
    );
    assert!(
        !dump.ran(),
        "the dump must not run with a mode that cannot be enforced"
    );
}
