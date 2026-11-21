use super::*;

fn tmp_sql(name: &str, repeats: usize) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gridline-open-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("sample.sql");
    std::fs::write(&file, "SELECT 1;".repeat(repeats.max(1))).unwrap();
    file
}

#[test]
fn rejects_a_relative_path() {
    assert!(open_sql_file_with_cap(std::path::Path::new("student_db.sql"), 1024).is_none());
}

#[test]
fn rejects_a_non_sql_extension() {
    let f = tmp_sql("ext", 1);
    let renamed = f.with_extension("txt");
    std::fs::rename(&f, &renamed).unwrap();
    assert!(open_sql_file_with_cap(&renamed, 1024).is_none());
}

#[test]
fn rejects_a_directory() {
    let dir = std::env::temp_dir().join("gridline-open-dir");
    std::fs::create_dir_all(dir.join("not-a-file.sql")).unwrap();
    assert!(open_sql_file_with_cap(&dir.join("not-a-file.sql"), 1024).is_none());
}

#[test]
fn rejects_a_missing_file() {
    let p = std::env::temp_dir().join("gridline-definitely-missing-xyz.sql");
    assert!(open_sql_file_with_cap(&p, 1024).is_none());
}

#[test]
fn rejects_a_file_over_the_cap() {
    let f = tmp_sql("big", 200);
    assert!(open_sql_file_with_cap(&f, 16).is_none());
}

#[test]
fn rejects_a_symlink() {
    #[cfg(unix)]
    {
        let f = tmp_sql("sym", 1);
        let link = f.with_file_name("link.sql");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&f, &link).unwrap();
        assert!(
            open_sql_file_with_cap(&link, 1024).is_none(),
            "a symlink must not be accepted (spec §6)"
        );
    }
}

#[test]
fn accepts_a_valid_sql_file_with_an_uppercase_extension() {
    let f = tmp_sql("ok", 1);
    let upper = f.with_file_name("SAMPLE.SQL");
    std::fs::rename(&f, &upper).unwrap();
    assert!(open_sql_file_with_cap(&upper, 1024).is_some());
}

#[test]
fn accept_path_dedupes_the_same_path() {
    let buffer = PendingOpenFiles::default();
    let f = tmp_sql("dedupe", 1);
    let s = f.to_string_lossy().to_string();
    assert!(accept_path(&buffer, &s));
    assert!(!accept_path(&buffer, &s), "second accept must be deduped");
}

#[test]
fn accept_path_ignores_an_invalid_path() {
    let buffer = PendingOpenFiles::default();
    assert!(!accept_path(&buffer, "relative.sql"));
}

#[test]
fn take_returns_contents_then_drains() {
    let buffer = PendingOpenFiles::default();
    let f = tmp_sql("drain", 1);
    assert!(accept_path(&buffer, &f.to_string_lossy()));

    let first = take_from_buffer(&buffer).expect("first drain");
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].name, "sample.sql");
    assert_eq!(first[0].content, "SELECT 1;");

    let second = take_from_buffer(&buffer).expect("second drain");
    assert!(second.is_empty(), "buffer must be drained, not reread");
}

#[test]
fn rejects_a_non_utf8_file() {
    let dir = std::env::temp_dir().join("gridline-open-binary");
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("binary.sql");
    std::fs::write(&f, [0xff, 0xfe, 0x00]).unwrap();
    let buffer = PendingOpenFiles::default();
    assert!(accept_path(&buffer, &f.to_string_lossy()));
    assert!(
        take_from_buffer(&buffer).is_err(),
        "non-UTF8 must fail closed"
    );
}

/// A private directory per test, so a test that replaces or renames files
/// cannot race another test sharing the same name.
fn unique_dir(tag: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "gridline-open-{tag}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn drain_reads_the_file_that_was_validated_not_whatever_the_path_names_later() {
    let dir = unique_dir("race");
    let script = dir.join("script.sql");
    std::fs::write(&script, "SELECT 'validated';").unwrap();

    let buffer = PendingOpenFiles::default();
    assert!(accept_path(&buffer, &script.to_string_lossy()));

    // Swap the path to a different file after validation. A validation that
    // is separated from the read by a path re-resolution would now hand the
    // app whatever the path happens to name.
    let replacement = dir.join("replacement.sql");
    std::fs::write(&replacement, "DROP TABLE accounts;").unwrap();
    std::fs::rename(&replacement, &script).unwrap();

    let drained = take_from_buffer(&buffer).expect("drained");
    assert_eq!(drained.len(), 1);
    assert_eq!(
        drained[0].content, "SELECT 'validated';",
        "the read must come from the validated file handle, not from the swapped path"
    );
}

#[cfg(unix)]
fn make_fifo(path: &std::path::Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `c_path` is a valid, NUL-terminated C string for the call.
    unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) == 0 }
}

#[test]
fn startup_reads_process_arguments_as_os_strings() {
    // `std::env::args()` panics on a non-UTF-8 argument, and on Unix argv is
    // arbitrary bytes. Startup must go through OS strings, and the argument
    // list must be handed to the shared helper so it can be tested here.
    let lib_rs = include_str!("../lib.rs");
    assert!(
        !lib_rs.contains("std::env::args()"),
        "startup must not read argv as UTF-8: std::env::args() panics on a non-Unicode argument"
    );
    assert!(
        lib_rs.contains("std::env::args_os()"),
        "startup must read argv with std::env::args_os()"
    );
    assert!(
        lib_rs.contains("accept_process_args"),
        "startup argv must go through accept_process_args"
    );
}

#[test]
#[cfg(unix)]
fn a_non_unicode_process_argument_does_not_panic_and_is_ignored() {
    use std::os::unix::ffi::OsStrExt;

    let dir = unique_dir("argv");
    let good = dir.join("good.sql");
    std::fs::write(&good, "SELECT 'good';").unwrap();

    // Bytes that are not valid UTF-8, exactly what a Unix argv element may be.
    let hostile = std::ffi::OsStr::from_bytes(b"/tmp/\xff\xfe-not-a-path.sql");
    let buffer = PendingOpenFiles::default();
    let accepted = accept_process_args(
        &buffer,
        vec![
            std::ffi::OsString::from("/path/to/binary"),
            hostile.to_os_string(),
            good.clone().into_os_string(),
        ],
    );

    assert!(accepted, "the valid argument must still be queued");
    let drained = take_from_buffer(&buffer).expect("drained");
    assert_eq!(drained.len(), 1, "only the valid argument is queued");
    assert_eq!(drained[0].content, "SELECT 'good';");
}

#[test]
#[cfg(unix)]
fn rejects_a_fifo_without_blocking() {
    let dir = unique_dir("fifo");
    let fifo = dir.join("pipe.sql");
    assert!(make_fifo(&fifo), "could not create the FIFO fixture");

    // Opening a FIFO read-only blocks until a writer appears. Validation must
    // answer "no" instead of wedging the app, so give it a bounded window and
    // report a hang as the failure rather than letting the test run forever.
    let (tx, rx) = std::sync::mpsc::channel();
    let path = fifo.clone();
    std::thread::spawn(move || {
        let buffer = PendingOpenFiles::default();
        let _ = tx.send(accept_os_path(&buffer, &path));
    });
    match rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(accepted) => assert!(!accepted, "a FIFO is not a SQL file"),
        Err(_) => panic!("validating a FIFO blocked instead of failing closed"),
    }
}

// Linux-only: APFS/HFS+ refuse to create a non-UTF-8 file name at all
// (EILSEQ), so the fixture cannot exist on macOS.
#[test]
#[cfg(target_os = "linux")]
fn opens_a_non_unicode_file_name_by_its_real_name() {
    use std::os::unix::ffi::OsStrExt;

    let dir = unique_dir("nonutf8-name");
    // "café-script.sql" with a Latin-1 é (0xE9) — a real file name on Unix
    // that is not valid UTF-8, so a lossy string round-trip would name a
    // different (or non-existent) file.
    let file = dir.join(std::ffi::OsStr::from_bytes(b"caf\xe9-script.sql"));
    std::fs::write(&file, "SELECT 'cafe';").unwrap();

    let buffer = PendingOpenFiles::default();
    assert!(
        accept_os_path(&buffer, &file),
        "the file must be opened by its real OS name"
    );
    let drained = take_from_buffer(&buffer).expect("drained");
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].content, "SELECT 'cafe';");
}

#[test]
fn refuses_a_file_that_grew_past_the_cap_after_it_was_accepted() {
    use std::io::Write;

    let dir = unique_dir("grew");
    let file = dir.join("grows.sql");
    std::fs::write(&file, "SELECT 1;").unwrap();

    let buffer = PendingOpenFiles::default();
    assert!(accept_path(&buffer, &file.to_string_lossy()));

    // The handle stays pinned to the file that was validated; a writer may
    // still append to it before the webview drains the queue.
    let mut grow = std::fs::OpenOptions::new()
        .append(true)
        .open(&file)
        .unwrap();
    grow.write_all(&[b'-'; 4096]).unwrap();
    drop(grow);

    let err = take_from_buffer_with_cap(&buffer, 64).expect_err("over-cap read must fail closed");
    assert!(err.contains("editor limit"), "{err}");
}

#[test]
fn ignores_requests_that_are_not_sql_files_without_queuing_anything() {
    let dir = unique_dir("invalid");
    let not_sql = dir.join("notes.txt");
    std::fs::write(&not_sql, "SELECT 'not a sql file';").unwrap();

    let buffer = PendingOpenFiles::default();
    assert!(!accept_path(&buffer, "/etc/passwd"));
    assert!(!accept_path(&buffer, &not_sql.to_string_lossy()));
    assert!(
        take_from_buffer(&buffer).expect("drained").is_empty(),
        "an ignored request must not be queued"
    );
}

#[test]
#[cfg(unix)]
fn a_symlink_swapped_in_after_validation_cannot_redirect_the_read() {
    let dir = unique_dir("race-symlink");
    let script = dir.join("script.sql");
    std::fs::write(&script, "SELECT 'validated';").unwrap();

    let buffer = PendingOpenFiles::default();
    assert!(accept_path(&buffer, &script.to_string_lossy()));

    // Replace the validated path with a symlink to an unrelated script.
    let elsewhere = dir.join("elsewhere.sql");
    std::fs::write(&elsewhere, "DROP TABLE accounts;").unwrap();
    std::fs::remove_file(&script).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &script).unwrap();

    let drained = take_from_buffer(&buffer).expect("drained");
    assert_eq!(drained.len(), 1);
    assert_eq!(
        drained[0].content, "SELECT 'validated';",
        "a symlink swapped in later must not redirect the read to its target"
    );
}
