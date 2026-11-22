use super::*;
use crate::file_grant::{FileGrantStore, FileIntent};

fn store() -> Mutex<Store> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrations::run_migrations(&conn).unwrap();
    Mutex::new(Store::from_connection(conn).expect("test store"))
}

/// A destination inside its own temp directory, so "did this write land?" and
/// "was a partial sibling left behind?" are answerable from the directory.
fn temp_destination(tag: &str, name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "gridline_file_io_{tag}_{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    (dir, path)
}

/// A grant store whose clock the test advances, so expiry is proven instead of
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

fn partial_siblings(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".gridline-partial-"))
        .collect()
}

// ── A bare path is not authorization ─────────────────────────────────
//
// These are the exact strings a pre-fix renderer handed to `plugin-fs`. None of
// them may authorize anything, in any of the three flows.

#[test]
fn a_raw_renderer_path_authorizes_no_connection_export() {
    let grants = FileGrantStore::new();
    let st = store();
    let (dir, path) = temp_destination("export-bare", "connections.json");

    let err = export_connections_to_granted_path(&grants, &st, path.to_str().unwrap())
        .expect_err("a renderer-supplied path must not authorize a write");

    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "the refusal must name the grant state, got: {err}"
    );
    assert!(!path.exists(), "nothing may be written to a bare path");
    assert!(partial_siblings(&dir).is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_raw_renderer_path_authorizes_no_connection_import() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("import-bare", "connections.json");
    std::fs::write(&path, b"{\"version\":1,\"connections\":[]}").unwrap();

    let err = read_connections_from_granted_path(&grants, path.to_str().unwrap())
        .expect_err("a renderer-supplied path must not authorize a read");
    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "got: {err}"
    );

    // The empty string is not a grant either.
    let empty = read_connections_from_granted_path(&grants, "").expect_err("empty grant id");
    assert!(
        empty.starts_with(crate::file_grant::CODE_INVALID),
        "got: {empty}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_raw_renderer_path_authorizes_no_byte_write() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("bytes-bare", "public.png");

    let err = write_granted_bytes(&grants, path.to_str().unwrap(), b"\x89PNG")
        .expect_err("a renderer-supplied path must not authorize a write");
    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "got: {err}"
    );
    assert!(!path.exists(), "nothing may be written to a bare path");
    let _ = std::fs::remove_dir_all(dir);
}

// ── The happy path, with the pre-migration behaviour preserved ───────

#[test]
fn connection_export_writes_the_granted_path_and_reports_it() {
    let grants = FileGrantStore::new();
    let st = store();
    let (dir, path) = temp_destination("export", "connections.json");
    // An existing destination is replaced, not appended to.
    std::fs::write(&path, b"STALE").unwrap();

    let grant = grants.mint(path.clone(), FileIntent::Write);
    let written = export_connections_to_granted_path(&grants, &st, &grant.id).unwrap();

    // Same value the UI shows in its notification: the path the user selected.
    assert_eq!(written, path.to_string_lossy());
    let text = std::fs::read_to_string(&path).unwrap();
    // Byte-for-byte what the backend's own exporter produced: nothing re-wraps
    // or trims the versioned envelope on the way to disk.
    assert_eq!(
        text,
        crate::commands::import_export::export_connections_inner(&st).unwrap()
    );
    assert!(text.contains("\"version\"") && text.contains("\"connections\""));
    assert!(
        partial_siblings(&dir).is_empty(),
        "no partial output may survive a successful write"
    );

    // Single use: the second job needs its own selection.
    let replay = export_connections_to_granted_path(&grants, &st, &grant.id)
        .expect_err("a consumed grant must not authorize a second export");
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "got: {replay}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn connection_import_returns_the_file_text_for_the_existing_validator() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("import", "connections.json");
    let document = "{\"version\":1,\"connections\":[]}";
    std::fs::write(&path, document).unwrap();

    let grant = grants.mint(path.clone(), FileIntent::Read);
    // Exactly the text `import_connections` validates, so import reporting
    // (imported / skipped / warnings) is unchanged.
    assert_eq!(
        read_connections_from_granted_path(&grants, &grant.id).unwrap(),
        document
    );

    let replay = read_connections_from_granted_path(&grants, &grant.id)
        .expect_err("a consumed grant must not authorize a second import");
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "got: {replay}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn granted_bytes_land_verbatim_on_the_granted_path() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("bytes", "public.png");
    let bytes = [0x89u8, b'P', b'N', b'G', 0x00, 0xFF];

    let grant = grants.mint(path.clone(), FileIntent::Write);
    let written = write_granted_bytes(&grants, &grant.id, &bytes).unwrap();

    assert_eq!(written, path.to_string_lossy());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert!(partial_siblings(&dir).is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

// ── Wrong intent and expiry are visible states, never a fallback ─────

#[test]
fn a_read_grant_cannot_authorize_a_connection_export() {
    let grants = FileGrantStore::new();
    let st = store();
    let (dir, path) = temp_destination("wrong-intent-export", "connections.json");

    let grant = grants.mint(path.clone(), FileIntent::Read);
    let err = export_connections_to_granted_path(&grants, &st, &grant.id)
        .expect_err("a read grant must not authorize an export write");
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "got: {err}"
    );
    assert!(!path.exists(), "a refused write must leave no file");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_write_grant_cannot_authorize_a_connection_import() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("wrong-intent-import", "connections.json");
    std::fs::write(&path, b"{}").unwrap();

    let grant = grants.mint(path.clone(), FileIntent::Write);
    let err = read_connections_from_granted_path(&grants, &grant.id)
        .expect_err("a write grant must not authorize an import read");
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "got: {err}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_read_grant_cannot_authorize_a_byte_write() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("wrong-intent-bytes", "public.png");

    let grant = grants.mint(path.clone(), FileIntent::Read);
    let err = write_granted_bytes(&grants, &grant.id, b"\x89PNG")
        .expect_err("a read grant must not authorize an image write");
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "got: {err}"
    );
    assert!(!path.exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_expired_grant_reports_expiry_in_every_flow() {
    let (grants, offset) = advancing_grants();
    let st = store();
    let (dir, export_path) = temp_destination("expired-export", "connections.json");
    let (in_dir, import_path) = temp_destination("expired-import", "connections.json");
    let (bytes_dir, bytes_path) = temp_destination("expired-bytes", "public.png");
    std::fs::write(&import_path, b"{}").unwrap();

    let export_grant = grants.mint(export_path.clone(), FileIntent::Write);
    let import_grant = grants.mint(import_path.clone(), FileIntent::Read);
    let bytes_grant = grants.mint(bytes_path.clone(), FileIntent::Write);

    // Past the five-minute window.
    *offset.lock().unwrap() = crate::file_grant::GRANT_TTL + std::time::Duration::from_secs(1);

    for err in [
        export_connections_to_granted_path(&grants, &st, &export_grant.id)
            .err()
            .expect("expired export grant"),
        read_connections_from_granted_path(&grants, &import_grant.id)
            .err()
            .expect("expired import grant"),
        write_granted_bytes(&grants, &bytes_grant.id, b"\x89PNG")
            .err()
            .expect("expired byte write grant"),
    ] {
        assert!(
            err.starts_with(crate::file_grant::CODE_EXPIRED),
            "an expired grant must report expiry, got: {err}"
        );
    }
    assert!(!export_path.exists(), "an expired grant writes nothing");
    assert!(!bytes_path.exists(), "an expired grant writes nothing");

    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(in_dir);
    let _ = std::fs::remove_dir_all(bytes_dir);
}

// ── Caps ────────────────────────────────────────────────────────────

#[test]
fn an_oversized_connection_file_is_refused_before_it_is_buffered() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("import-large", "connections.json");
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(MAX_CONNECTIONS_FILE_BYTES + 1).unwrap();
    drop(file);

    let grant = grants.mint(path.clone(), FileIntent::Read);
    let err = read_connections_from_granted_path(&grants, &grant.id)
        .expect_err("a file over the cap must be refused");
    assert!(err.contains("too large"), "got: {err}");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_oversized_byte_write_is_refused_without_spending_the_grant() {
    let grants = FileGrantStore::new();
    let (dir, path) = temp_destination("bytes-large", "public.png");
    let grant = grants.mint(path.clone(), FileIntent::Write);

    let err = write_granted_bytes(&grants, &grant.id, &vec![0u8; MAX_GRANTED_WRITE_BYTES + 1])
        .expect_err("a payload over the cap must be refused");
    assert!(err.contains("too large"), "got: {err}");
    assert!(!path.exists(), "nothing may be written");

    // The selection is still usable: the cap is checked before consumption, so
    // the user can retry with a smaller export instead of starting over.
    write_granted_bytes(&grants, &grant.id, b"\x89PNG").expect("the grant was not consumed");
    assert_eq!(std::fs::read(&path).unwrap(), b"\x89PNG");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_granted_read_refuses_a_path_that_is_not_a_regular_file() {
    let grants = FileGrantStore::new();
    let (dir, _file) = temp_destination("import-dir", "unused.json");

    let grant = grants.mint(dir.clone(), FileIntent::Read);
    let err = read_connections_from_granted_path(&grants, &grant.id)
        .expect_err("a directory is not a connection file");
    assert!(err.contains("regular file"), "got: {err}");
    let _ = std::fs::remove_dir_all(dir);
}
