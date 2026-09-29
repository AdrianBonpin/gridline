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
    assert!(validate_sql_path_with_cap("student_db.sql", 1024).is_none());
}

#[test]
fn rejects_a_non_sql_extension() {
    let f = tmp_sql("ext", 1);
    let renamed = f.with_extension("txt");
    std::fs::rename(&f, &renamed).unwrap();
    assert!(validate_sql_path_with_cap(&renamed.to_string_lossy(), 1024).is_none());
}

#[test]
fn rejects_a_directory() {
    let dir = std::env::temp_dir().join("gridline-open-dir");
    std::fs::create_dir_all(dir.join("not-a-file.sql")).unwrap();
    assert!(
        validate_sql_path_with_cap(&dir.join("not-a-file.sql").to_string_lossy(), 1024).is_none()
    );
}

#[test]
fn rejects_a_missing_file() {
    let p = std::env::temp_dir().join("gridline-definitely-missing-xyz.sql");
    assert!(validate_sql_path_with_cap(&p.to_string_lossy(), 1024).is_none());
}

#[test]
fn rejects_a_file_over_the_cap() {
    let f = tmp_sql("big", 200);
    assert!(validate_sql_path_with_cap(&f.to_string_lossy(), 16).is_none());
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
            validate_sql_path_with_cap(&link.to_string_lossy(), 1024).is_none(),
            "a symlink must not be accepted (spec §6)"
        );
    }
}

#[test]
fn accepts_a_valid_sql_file_with_an_uppercase_extension() {
    let f = tmp_sql("ok", 1);
    let upper = f.with_file_name("SAMPLE.SQL");
    std::fs::rename(&f, &upper).unwrap();
    assert!(validate_sql_path_with_cap(&upper.to_string_lossy(), 1024).is_some());
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
    assert!(take_from_buffer(&buffer).is_err(), "non-UTF8 must fail closed");
}
