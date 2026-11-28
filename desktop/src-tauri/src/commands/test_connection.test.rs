use super::*;
use crate::commands::ssh::{Ssh2Backend, SshTunnelManager};
use crate::db::pool::DbConfig;
use crate::file_grant::{
    FileFilter, FileGrantStore, FileIntent, FilePicker, PickRequest, PickedFile, CODE_CONSUMED,
    CODE_EXPIRED, CODE_INVALID, CODE_WRONG_INTENT,
};
use std::sync::Arc;

/// SSH backend for tests that never reach a real SSH server: host trust is
/// an in-memory fake, so no endpoint needs enrolling.
fn test_ssh_backend() -> Ssh2Backend {
    Ssh2Backend::new(Arc::new(
        crate::commands::ssh_trust::fake::FakeHostTrust::default(),
    ))
}

#[tokio::test]
async fn postgres_probe_times_out_when_authentication_stalls_after_tcp_connect() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
        drop(socket);
    });
    let config = DbConfig {
        db_type: "postgresql".into(),
        host: "127.0.0.1".into(),
        port: Some(port.into()),
        ..Default::default()
    };
    let ssh = std::sync::Mutex::new(SshTunnelManager::new(Arc::new(test_ssh_backend())));
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(12),
        test_pg_connection(&config, &ssh),
    )
    .await;
    server.abort();
    let result = result.expect("probe must time out even after TCP connects");
    assert!(!result.ok);
    assert_eq!(
        result.error.as_deref(),
        Some("connection timed out after 10 seconds")
    );
}

fn mariadb_config(port: Option<i64>) -> DbConfig {
    DbConfig {
        db_type: "mariadb".into(),
        host: "127.0.0.1".into(),
        port,
        username: Some("root".into()),
        password: None,
        database: Some("test".into()),
        ..Default::default()
    }
}

#[test]
fn validate_test_input_accepts_mariadb_with_port() {
    assert_eq!(validate_test_input(&mariadb_config(Some(3306))), None);
}

#[test]
fn validate_test_input_rejects_mariadb_without_port() {
    assert!(validate_test_input(&mariadb_config(None)).is_some());
}

/// Live test against a real MariaDB server. Run with:
/// `GRIDLINE_TEST_MARIADB_HOST=… GRIDLINE_TEST_MARIADB_PORT=3306 \
///  GRIDLINE_TEST_MARIADB_USER=… GRIDLINE_TEST_MARIADB_PASSWORD=… \
///  GRIDLINE_TEST_MARIADB_DB=… cargo test -- --ignored mariadb_live`
#[test]
#[ignore]
fn mariadb_live_test_connection_reports_mariadb_version() {
    let config = DbConfig {
        host: std::env::var("GRIDLINE_TEST_MARIADB_HOST").expect("GRIDLINE_TEST_MARIADB_HOST"),
        port: std::env::var("GRIDLINE_TEST_MARIADB_PORT")
            .ok()
            .and_then(|p| p.parse::<i64>().ok()),
        username: std::env::var("GRIDLINE_TEST_MARIADB_USER").ok(),
        password: std::env::var("GRIDLINE_TEST_MARIADB_PASSWORD").ok(),
        database: std::env::var("GRIDLINE_TEST_MARIADB_DB").ok(),
        ..mariadb_config(None)
    };
    let rt = tokio::runtime::Runtime::new().unwrap();
    let ssh = std::sync::Mutex::new(SshTunnelManager::new(Arc::new(test_ssh_backend())));
    let result = rt.block_on(async { test_mysql_connection(&config, &ssh).await });
    assert!(result.ok, "connection failed: {:?}", result.error);
    let version = result.server_version.unwrap_or_default().to_lowercase();
    assert!(
        version.contains("mariadb"),
        "expected a MariaDB server, got version: {version:?}"
    );
}

// ---------------------------------------------------------------------------
// SQLite probe: never create a database, never bless an invalid file
// ---------------------------------------------------------------------------

/// A throwaway directory for one test, removed by the caller.
fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gridline-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn sqlite_config(path: &std::path::Path) -> DbConfig {
    DbConfig {
        db_type: "sqlite".into(),
        host: path.to_string_lossy().into_owned(),
        port: None,
        ..Default::default()
    }
}

#[test]
fn sqlite_probe_fails_for_missing_file_and_never_creates_it() {
    let dir = temp_dir("sqlite-missing");
    let path = dir.join("absent.db");
    let result = test_sqlite_connection(&sqlite_config(&path));
    assert!(!result.ok, "a missing database must not test as online");
    assert!(
        result
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("does not exist"),
        "error must name the missing file: {:?}",
        result.error
    );
    assert!(
        !path.exists(),
        "testing a connection must never create the database file"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_probe_fails_for_invalid_existing_file() {
    // A file that exists but is not a SQLite database must fail: only the
    // header read proves it is one, so a not-a-database file cannot pass.
    let dir = temp_dir("sqlite-invalid");
    let path = dir.join("garbage.db");
    std::fs::write(&path, b"this is not a sqlite database, it is just text\n").unwrap();
    let result = test_sqlite_connection(&sqlite_config(&path));
    assert!(!result.ok, "an invalid file must not test as online");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_probe_reports_version_for_existing_database() {
    let dir = temp_dir("sqlite-valid");
    let path = dir.join("valid.db");
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);")
        .unwrap();
    let result = test_sqlite_connection(&sqlite_config(&path));
    assert!(result.ok, "valid database failed: {:?}", result.error);
    assert!(
        result
            .server_version
            .as_deref()
            .unwrap_or_default()
            .starts_with('3'),
        "expected a SQLite version, got {:?}",
        result.server_version
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_is_a_separate_explicit_action() {
    let dir = temp_dir("sqlite-create");
    let path = dir.join("new.db");

    create_sqlite_database_at(path.to_str().unwrap()).expect("explicit creation must succeed");
    assert!(path.exists(), "creation writes the file");

    // The created file is a real database the probe accepts.
    let result = test_sqlite_connection(&sqlite_config(&path));
    assert!(result.ok, "created database failed: {:?}", result.error);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_refuses_to_overwrite_an_existing_file() {
    let dir = temp_dir("sqlite-create-existing");
    let path = dir.join("keep.db");
    std::fs::write(&path, b"precious bytes").unwrap();

    let err = create_sqlite_database_at(path.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("exist"),
        "error must explain the refusal: {err}"
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"precious bytes",
        "existing file content must be untouched"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_requires_a_directory_that_exists() {
    let dir = temp_dir("sqlite-create-nodir");
    let path = dir.join("nested").join("new.db");
    assert!(create_sqlite_database_at(path.to_str().unwrap()).is_err());
    assert!(!path.exists());
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// Creating a database consumes a Write File Grant
//
// A path is not authorization (see `GLOSSARY.md` → File Grant): the destination
// is whatever the backend brokered native dialog produced, and the create
// command can only be reached with the grant id that selection issued.
// ---------------------------------------------------------------------------

/// A grant store whose clock the test advances, so expiry is proven rather than
/// inferred.
fn advancing_grants() -> (
    FileGrantStore,
    std::sync::Arc<std::sync::Mutex<std::time::Duration>>,
) {
    let base = std::time::Instant::now();
    let offset = std::sync::Arc::new(std::sync::Mutex::new(std::time::Duration::ZERO));
    let clock_offset = offset.clone();
    let store = FileGrantStore::with_clock(
        crate::file_grant::GRANT_TTL,
        Box::new(move || base + *clock_offset.lock().unwrap()),
    );
    (store, offset)
}

/// The picker reports that the user closed the dialog without choosing.
struct CancellingPicker;

impl FilePicker for CancellingPicker {
    fn pick(&self, _request: &PickRequest) -> Result<Option<PickedFile>, String> {
        Ok(None)
    }
}

/// Every refusal must also say what the user can do about it; the recovery
/// action is choosing the file again.
fn assert_recovery_is_named(err: &str) {
    assert!(
        err.contains("Choose the file again"),
        "the refusal must name its recovery action, got: {err}"
    );
}

#[test]
fn sqlite_create_refuses_a_renderer_supplied_path() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-bare-path");
    let path = dir.join("bare.db");

    let err = create_sqlite_database_from_grant(&grants, path.to_str().unwrap())
        .expect_err("a path is not a grant and authorizes nothing");
    assert!(
        err.starts_with(CODE_INVALID),
        "the refusal must name the grant state, got: {err}"
    );
    assert_recovery_is_named(&err);
    assert!(!path.exists(), "nothing may be created at a bare path");

    // The empty string is not a grant either.
    let empty = create_sqlite_database_from_grant(&grants, "").expect_err("empty id");
    assert!(empty.starts_with(CODE_INVALID), "got: {empty}");
    assert_eq!(
        std::fs::read_dir(&dir).unwrap().count(),
        0,
        "the directory stays empty"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_refuses_an_unknown_grant() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-unknown");

    let err = create_sqlite_database_from_grant(&grants, "not-a-grant-id")
        .expect_err("an id the store never issued authorizes nothing");
    assert!(err.starts_with(CODE_INVALID), "got: {err}");
    assert_recovery_is_named(&err);
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_refuses_an_expired_grant() {
    let (grants, offset) = advancing_grants();
    let dir = temp_dir("sqlite-create-expired");
    let path = dir.join("expired.db");
    let grant = grants.mint(path.clone(), FileIntent::Write);

    *offset.lock().unwrap() = crate::file_grant::GRANT_TTL + std::time::Duration::from_secs(1);

    let err = create_sqlite_database_from_grant(&grants, &grant.id)
        .expect_err("an expired selection authorizes nothing");
    assert!(err.starts_with(CODE_EXPIRED), "got: {err}");
    assert_recovery_is_named(&err);
    assert!(!path.exists(), "nothing may be created");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_refuses_a_grant_minted_for_a_different_intent() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-read-grant");
    let path = dir.join("read-grant.db");
    let grant = grants.mint(path.clone(), FileIntent::Read);

    let err = create_sqlite_database_from_grant(&grants, &grant.id)
        .expect_err("a read selection must not authorize a write");
    assert!(err.starts_with(CODE_WRONG_INTENT), "got: {err}");
    assert_recovery_is_named(&err);
    assert!(!path.exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_consumes_the_grant_so_a_replay_is_refused() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-replay");
    let path = dir.join("once.db");
    let grant = grants.mint(path.clone(), FileIntent::Write);

    create_sqlite_database_from_grant(&grants, &grant.id).expect("the granted creation succeeds");

    let err = create_sqlite_database_from_grant(&grants, &grant.id)
        .expect_err("a selection is single-use");
    assert!(err.starts_with(CODE_CONSUMED), "got: {err}");
    assert_recovery_is_named(&err);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn sqlite_create_refusals_are_distinguishable_from_one_another() {
    let (grants, offset) = advancing_grants();
    let dir = temp_dir("sqlite-create-distinct");

    let expired = grants.mint(dir.join("expired.db"), FileIntent::Write);
    *offset.lock().unwrap() = crate::file_grant::GRANT_TTL + std::time::Duration::from_secs(1);
    let wrong_intent = grants.mint(dir.join("wrong-intent.db"), FileIntent::Read);
    let consumed = grants.mint(dir.join("consumed.db"), FileIntent::Write);
    create_sqlite_database_from_grant(&grants, &consumed.id).expect("first use succeeds");

    let messages = [
        create_sqlite_database_from_grant(&grants, "unknown").unwrap_err(),
        create_sqlite_database_from_grant(&grants, &expired.id).unwrap_err(),
        create_sqlite_database_from_grant(&grants, &wrong_intent.id).unwrap_err(),
        create_sqlite_database_from_grant(&grants, &consumed.id).unwrap_err(),
    ];

    for (i, a) in messages.iter().enumerate() {
        for b in messages.iter().skip(i + 1) {
            assert_ne!(a, b, "each refusal must be distinguishable: {a}");
        }
    }
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_cancelled_selection_creates_nothing() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-cancelled");
    let request = PickRequest {
        intent: FileIntent::Write,
        title: "Create SQLite database".into(),
        default_name: Some("new.db".into()),
        filters: vec![FileFilter {
            name: "SQLite database".into(),
            extensions: vec!["db".into()],
        }],
    };

    let picked = crate::file_grant::grant_selection(&grants, &CancellingPicker, &request)
        .expect("closing the dialog is not an error");
    assert!(picked.is_none(), "a cancelled dialog issues no grant");
    assert_eq!(grants.active_grants(), 0, "nothing was minted");

    // With no selection there is no id to present, and the empty string — the
    // only thing a cancelled flow can hand over — authorizes nothing.
    let err = create_sqlite_database_from_grant(&grants, "").unwrap_err();
    assert!(err.starts_with(CODE_INVALID), "got: {err}");
    assert_eq!(
        std::fs::read_dir(&dir).unwrap().count(),
        0,
        "a cancelled action leaves no side effect"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_write_grant_creates_a_real_database_at_the_selected_destination() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-granted");
    let path = dir.join("granted.db");
    let grant = grants.mint(path.clone(), FileIntent::Write);

    let created =
        create_sqlite_database_from_grant(&grants, &grant.id).expect("creation must succeed");

    assert_eq!(
        created,
        path.to_string_lossy(),
        "the created path is reported"
    );
    assert!(path.exists(), "the database file exists");
    assert!(
        !std::fs::read(&path).unwrap().is_empty(),
        "a real database, not an empty placeholder"
    );
    let probe = test_sqlite_connection(&sqlite_config(&path));
    assert!(probe.ok, "the created database must connect: {probe:?}");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_write_grant_still_refuses_an_existing_destination() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-granted-existing");
    let path = dir.join("keep.db");
    std::fs::write(&path, b"precious bytes").unwrap();
    let grant = grants.mint(path.clone(), FileIntent::Write);

    let err = create_sqlite_database_from_grant(&grants, &grant.id).unwrap_err();
    assert!(
        err.to_lowercase().contains("exist"),
        "error must explain the refusal: {err}"
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"precious bytes",
        "an existing file is never truncated or replaced"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_write_grant_still_refuses_a_missing_parent_directory() {
    let grants = FileGrantStore::new();
    let dir = temp_dir("sqlite-create-granted-nodir");
    let path = dir.join("nested").join("new.db");
    let grant = grants.mint(path.clone(), FileIntent::Write);

    let err = create_sqlite_database_from_grant(&grants, &grant.id)
        .expect_err("creation does not build directory trees");
    assert!(
        err.contains("directory does not exist"),
        "error must explain the refusal: {err}"
    );
    assert!(!path.exists());
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// Redis probe: credentials with reserved characters
// ---------------------------------------------------------------------------

/// Parse one complete RESP array of bulk strings from the front of `buf`.
/// Returns the arguments and how many bytes were consumed, or `None` when the
/// buffer does not yet hold a whole command.
fn parse_resp_command(buf: &[u8]) -> Option<(Vec<Vec<u8>>, usize)> {
    if buf.first() != Some(&b'*') {
        return None;
    }
    let mut pos = 0usize;
    let read_line = |from: usize| -> Option<(String, usize)> {
        let end = buf[from..].windows(2).position(|w| w == b"\r\n")? + from;
        Some((
            String::from_utf8_lossy(&buf[from..end]).into_owned(),
            end + 2,
        ))
    };
    let (count_line, after_count) = read_line(pos)?;
    let count: usize = count_line[1..].parse().ok()?;
    pos = after_count;
    let mut args = Vec::with_capacity(count);
    for _ in 0..count {
        let (len_line, after_len) = read_line(pos)?;
        if !len_line.starts_with('$') {
            return None;
        }
        let len: usize = len_line[1..].parse().ok()?;
        let start = after_len;
        let end = start + len;
        if buf.len() < end + 2 {
            return None;
        }
        args.push(buf[start..end].to_vec());
        pos = end + 2;
    }
    Some((args, pos))
}

/// A minimal RESP2 server: authenticates only the expected password and
/// acknowledges every other command, enough for a connect probe.
async fn serve_fake_redis(
    listener: tokio::net::TcpListener,
    expected_password: String,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = socket.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        while let Some((args, used)) = parse_resp_command(&buf) {
            buf.drain(..used);
            let command = args
                .first()
                .map(|c| String::from_utf8_lossy(c).to_ascii_uppercase())
                .unwrap_or_default();
            let reply: Vec<u8> = match command.as_str() {
                "AUTH" => {
                    let supplied = args.last().cloned().unwrap_or_default();
                    if supplied == expected_password.as_bytes() {
                        b"+OK\r\n".to_vec()
                    } else {
                        // Never echo the credential: report only its length.
                        format!(
                            "-ERR invalid password ({} bytes received)\r\n",
                            supplied.len()
                        )
                        .into_bytes()
                    }
                }
                "PING" => b"+PONG\r\n".to_vec(),
                _ => b"+OK\r\n".to_vec(),
            };
            socket.write_all(&reply).await.map_err(|e| e.to_string())?;
        }
    }
}

async fn redis_probe_against(password: &str, expected: &str) -> TestConnectionResult {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(serve_fake_redis(listener, expected.to_string()));
    let config = DbConfig {
        db_type: "redis".into(),
        host: "127.0.0.1".into(),
        port: Some(port as i64),
        password: Some(password.to_string()),
        ..Default::default()
    };
    let ssh = std::sync::Mutex::new(SshTunnelManager::new(Arc::new(test_ssh_backend())));
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        test_redis_connection(&config, &ssh),
    )
    .await
    .expect("redis probe must finish within its own deadline");
    server.abort();
    result
}

#[tokio::test]
async fn redis_probe_sends_password_with_reserved_characters_intact() {
    // Every one of these characters changes meaning inside a URL: userinfo
    // delimiters, a path separator, a query/fragment marker and a percent
    // escape. The probe must hand the password to Redis exactly as stored.
    let password = "p@ss:w/ord?#%41";
    let result = redis_probe_against(password, password).await;
    assert!(
        result.ok,
        "reserved-character password must authenticate: {:?}",
        result.error
    );
}

#[tokio::test]
async fn redis_probe_reports_authentication_failure() {
    // Guards the test above: a password that does arrive mangled is rejected
    // by the server, so a passing probe really did send the stored value.
    let result = redis_probe_against("correct-horse", "different-password").await;
    assert!(!result.ok, "a rejected password must not test as online");
    let error = result.error.unwrap_or_default().to_lowercase();
    assert!(
        error.contains("password") || error.contains("auth"),
        "error must describe the authentication failure: {error}"
    );
}

// ---------------------------------------------------------------------------
// Tunnelled MySQL probe: the reported version comes from the real target
// ---------------------------------------------------------------------------

/// A length-encoded integer (MySQL wire format).
fn lenenc_int(n: u64) -> Vec<u8> {
    if n < 251 {
        vec![n as u8]
    } else {
        let mut v = vec![0xfc];
        v.extend_from_slice(&(n as u16).to_le_bytes());
        v
    }
}

fn lenenc_str(s: &str) -> Vec<u8> {
    let mut v = lenenc_int(s.len() as u64);
    v.extend_from_slice(s.as_bytes());
    v
}

/// One MySQL packet: 3-byte little-endian length, sequence id, payload.
fn mysql_packet(seq: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 4);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes()[..3]);
    out.push(seq);
    out.extend_from_slice(payload);
    out
}

const MYSQL_OK: [u8; 7] = [0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00];

fn mysql_eof(seq: u8) -> Vec<u8> {
    // 0xfe, no warnings, SERVER_STATUS_AUTOCOMMIT.
    mysql_packet(seq, &[0xfe, 0x00, 0x00, 0x02, 0x00])
}

/// A single-column `VERSION()` result-set column definition (VAR_STRING).
fn mysql_column_definition(seq: u8) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&lenenc_str("def")); // catalog
    p.extend_from_slice(&lenenc_str("")); // schema
    p.extend_from_slice(&lenenc_str("")); // table alias
    p.extend_from_slice(&lenenc_str("")); // table
    p.extend_from_slice(&lenenc_str("VERSION()")); // column alias (name)
    p.extend_from_slice(&lenenc_str("VERSION()")); // column name
    p.push(0x0c); // fixed-length field marker
    p.extend_from_slice(&33u16.to_le_bytes()); // character set
    p.extend_from_slice(&255u32.to_le_bytes()); // max display size
    p.push(0xfd); // VAR_STRING
    p.extend_from_slice(&0u16.to_le_bytes()); // flags
    p.push(0x00); // decimals
    p.extend_from_slice(&[0x00, 0x00]); // filler
    mysql_packet(seq, &p)
}

/// Read one MySQL packet, or `None` when the socket closed or the tunnel was
/// torn down while waiting.
async fn mysql_read_packet(
    socket: &mut tokio::net::TcpStream,
    closed: &tokio::sync::Notify,
) -> Option<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let read = async {
        let mut header = [0u8; 4];
        socket.read_exact(&mut header).await.ok()?;
        let len = u32::from_le_bytes([header[0], header[1], header[2], 0]) as usize;
        let mut payload = vec![0u8; len];
        socket.read_exact(&mut payload).await.ok()?;
        Some(payload)
    };
    tokio::pin!(read);
    tokio::select! {
        _ = closed.notified() => None,
        packet = &mut read => packet,
    }
}

async fn mysql_write(socket: &mut tokio::net::TcpStream, bytes: &[u8]) -> Option<()> {
    use tokio::io::AsyncWriteExt;
    socket.write_all(bytes).await.ok()
}

/// A minimal MySQL server: greeting, auth OK, ping OK, and a one-row
/// `SELECT VERSION()` result for a prepared statement. Only this much protocol
/// is needed to prove which server a probe really talked to.
async fn serve_fake_mysql(
    listener: tokio::net::TcpListener,
    version: String,
    closed: Arc<tokio::sync::Notify>,
) {
    let Ok((mut socket, _)) = listener.accept().await else {
        return;
    };

    // HandshakeV10. The greeting advertises a different version than the query
    // answers, so a reported version proves the query ran against this server.
    let capabilities: u32 = 0x0200 /* PROTOCOL_41 */ | 0x8000 /* SECURE_CONNECTION */ | 0x0008_0000 /* PLUGIN_AUTH */;
    let mut greeting = vec![0x0a];
    greeting.extend_from_slice(b"8.0.41-greeting\0");
    greeting.extend_from_slice(&7u32.to_le_bytes()); // connection id
    greeting.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]); // auth data part 1
    greeting.push(0x00); // filler
    greeting.extend_from_slice(&((capabilities & 0xffff) as u16).to_le_bytes());
    greeting.push(33); // character set
    greeting.extend_from_slice(&0x0002u16.to_le_bytes()); // status flags
    greeting.extend_from_slice(&(((capabilities >> 16) & 0xffff) as u16).to_le_bytes());
    greeting.push(21); // auth plugin data length
    greeting.extend_from_slice(&[0u8; 10]); // reserved
    greeting.extend_from_slice(&[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    greeting.push(0x00); // auth data part 2 terminator
    greeting.extend_from_slice(b"mysql_native_password\0");
    if mysql_write(&mut socket, &mysql_packet(0, &greeting))
        .await
        .is_none()
    {
        return;
    }
    // Handshake response, then auth OK.
    if mysql_read_packet(&mut socket, &closed).await.is_none() {
        return;
    }
    if mysql_write(&mut socket, &mysql_packet(2, &MYSQL_OK))
        .await
        .is_none()
    {
        return;
    }

    while let Some(packet) = mysql_read_packet(&mut socket, &closed).await {
        let Some(command) = packet.first().copied() else {
            return;
        };
        match command {
            // COM_QUIT
            0x01 => return,
            // COM_QUERY: answer in the text protocol.
            0x03 => {
                let text_row = lenenc_str(&version);
                let replies = [
                    mysql_packet(1, &[0x01]),
                    mysql_column_definition(2),
                    mysql_eof(3),
                    mysql_packet(4, &text_row),
                    mysql_eof(5),
                ];
                for reply in replies {
                    if mysql_write(&mut socket, &reply).await.is_none() {
                        return;
                    }
                }
            }
            // COM_PING
            0x0e => {
                if mysql_write(&mut socket, &mysql_packet(1, &MYSQL_OK))
                    .await
                    .is_none()
                {
                    return;
                }
            }
            // COM_STMT_PREPARE: one output column, no parameters.
            0x16 => {
                let mut ok = vec![0x00];
                ok.extend_from_slice(&1u32.to_le_bytes()); // statement id
                ok.extend_from_slice(&1u16.to_le_bytes()); // columns
                ok.extend_from_slice(&0u16.to_le_bytes()); // params
                ok.push(0x00); // reserved
                ok.extend_from_slice(&0u16.to_le_bytes()); // warnings
                let replies = [
                    mysql_packet(1, &ok),
                    mysql_column_definition(2),
                    mysql_eof(3),
                ];
                for reply in replies {
                    if mysql_write(&mut socket, &reply).await.is_none() {
                        return;
                    }
                }
            }
            // COM_STMT_EXECUTE: one binary-protocol row.
            0x17 => {
                let mut row = vec![0x00, 0x00]; // header + null bitmap
                row.extend_from_slice(&lenenc_str(&version));
                let replies = [
                    mysql_packet(1, &[0x01]),
                    mysql_column_definition(2),
                    mysql_eof(3),
                    mysql_packet(4, &row),
                    mysql_eof(5),
                ];
                for reply in replies {
                    if mysql_write(&mut socket, &reply).await.is_none() {
                        return;
                    }
                }
            }
            // COM_STMT_CLOSE has no reply.
            0x19 => {}
            _ => return,
        }
    }
}

/// A tunnel backend whose "tunnel" is the fake MySQL server's own loopback
/// address. Closing the tunnel makes that server stop answering, exactly like
/// tearing down a real forwarded connection.
struct FakeMysqlTunnelBackend {
    target_port: u16,
    closed: Arc<tokio::sync::Notify>,
}

impl crate::commands::ssh::TunnelBackend for FakeMysqlTunnelBackend {
    fn open(
        &self,
        _key: &str,
        _cfg: &crate::models::SshConfig,
        _remote_host: &str,
        _remote_port: u16,
        _password: Option<&str>,
        _passphrase: Option<&str>,
    ) -> Result<crate::commands::ssh::Tunnel, crate::commands::ssh_trust::SshTunnelError> {
        let closed = Arc::clone(&self.closed);
        Ok(crate::commands::ssh::Tunnel::with_closer(
            self.target_port,
            Box::new(move || closed.notify_waiters()),
        ))
    }

    fn probe_host_trust(
        &self,
        _host: &str,
        _port: u16,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        Err("not used".into())
    }

    fn enroll_host_trust(
        &self,
        _host: &str,
        _port: u16,
        _accepted: &crate::models::ssh_trust::HostKeyFingerprint,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        Err("not used".into())
    }

    fn reenroll_host_trust(
        &self,
        _host: &str,
        _port: u16,
        _accepted: &crate::models::ssh_trust::HostKeyFingerprint,
    ) -> Result<crate::models::ssh_trust::SshHostTrustState, String> {
        Err("not used".into())
    }
}

#[tokio::test]
async fn tunnelled_mysql_probe_reports_the_target_servers_version() {
    let version = "8.0.42-from-the-real-target";
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let closed = Arc::new(tokio::sync::Notify::new());
    let server = tokio::spawn(serve_fake_mysql(
        listener,
        version.to_string(),
        Arc::clone(&closed),
    ));

    let ssh = std::sync::Mutex::new(SshTunnelManager::new(Arc::new(FakeMysqlTunnelBackend {
        target_port: port,
        closed,
    })));
    let config = DbConfig {
        db_type: "mysql".into(),
        host: "db.internal".into(),
        port: Some(3306),
        username: Some("app".into()),
        database: Some("appdb".into()),
        ssh_host: Some("bastion.internal".into()),
        ssh_port: Some(22),
        ssh_user: Some("tunnel".into()),
        ssh_auth_method: Some("password".into()),
        ..Default::default()
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        test_mysql_connection(&config, &ssh),
    )
    .await
    .expect("tunnelled probe must finish within its own deadline");
    server.abort();

    assert!(result.ok, "tunnelled probe failed: {:?}", result.error);
    assert_eq!(
        result.server_version.as_deref(),
        Some(version),
        "the reported version must come from the target through the still-open tunnel"
    );
}
