use super::*;
use crate::file_grant::{FileGrantStore, FileIntent};

fn temp_file(tag: &str, contents: &[u8]) -> std::path::PathBuf {
    let path =
        std::env::temp_dir().join(format!("gridline-import-{tag}-{}.csv", std::process::id()));
    std::fs::write(&path, contents).unwrap();
    path
}

#[test]
fn a_raw_renderer_path_authorizes_no_import_source() {
    let grants = FileGrantStore::new();

    // The exact string a pre-fix renderer sent to the file plugin as the path.
    let err = resolve_import_source(&grants, "/tmp/renderer-chosen.csv").unwrap_err();

    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "a bare path must be rejected as an invalid grant, got: {err}"
    );
}

#[test]
fn an_import_grant_resolves_its_source_exactly_once() {
    let grants = FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/gridline-granted.csv"),
        FileIntent::Read,
    );

    assert_eq!(
        resolve_import_source(&grants, &grant.id).unwrap(),
        "/tmp/gridline-granted.csv"
    );

    let replay = resolve_import_source(&grants, &grant.id).unwrap_err();
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "a replayed grant must report the consumed state, got: {replay}"
    );
}

#[test]
fn a_write_grant_cannot_authorize_an_import_read() {
    let grants = FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/export.csv"),
        FileIntent::Write,
    );

    let err = resolve_import_source(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "a write grant must not authorize an import read, got: {err}"
    );
}

#[test]
fn read_import_source_returns_the_text_with_its_display_name() {
    let path = temp_file("happy", b"a,b\n1,2\n");
    let source = read_import_source(&path, MAX_IMPORT_BYTES).expect("reads a granted file");

    assert_eq!(source.text, "a,b\n1,2\n");
    assert!(source.display_name.ends_with(".csv"));
    assert_eq!(source.bytes, 8);
    let _ = std::fs::remove_file(&path);
}

/// The byte cap is checked from the file's metadata *before* the file is read,
/// so an oversized file is never buffered (spec §"Large results … Existing
/// import limits of 100,000 rows and 100 MB remain, with byte size enforced
/// before full buffering"). The fixture is sparse: actually reading it would
/// allocate and fill 512 MiB, which the assertion below never allows to happen.
#[test]
fn an_oversized_import_file_is_refused_before_it_is_buffered() {
    let path =
        std::env::temp_dir().join(format!("gridline-import-sparse-{}.csv", std::process::id()));
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(512 * 1024 * 1024).unwrap();
    drop(file);

    let err = read_import_source(&path, 1024).expect_err("a file over the cap must be refused");
    assert!(
        err.contains("limit"),
        "the cap error must name the limit, got: {err}"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn read_import_source_refuses_a_path_that_is_not_a_regular_file() {
    let err = read_import_source(std::path::Path::new("/tmp"), MAX_IMPORT_BYTES)
        .expect_err("a directory is not an import source");
    assert!(err.contains("regular file"), "got: {err}");
}

#[test]
fn read_import_source_refuses_a_file_that_is_not_utf8() {
    let path = temp_file("binary", &[0xFF, 0xFE, 0x00, 0x01]);
    let err =
        read_import_source(&path, MAX_IMPORT_BYTES).expect_err("binary is not an import file");
    assert!(err.contains("Cannot read the import file"), "got: {err}");
    let _ = std::fs::remove_file(&path);
}
