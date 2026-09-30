use super::*;

#[test]
fn bundled_bin_name_appends_exe_only_on_windows() {
    let expected = if cfg!(windows) { "pg_dump.exe" } else { "pg_dump" };
    assert_eq!(bundled_bin_name("pg_dump"), expected);
}

#[test]
fn pg_request_maps_known_tool_names() {
    assert_eq!(pg_request("pg_dump").unwrap(), ToolRequest::new("pg_tools", &["pg_dump"]));
    assert_eq!(pg_request("pg_restore").unwrap(), ToolRequest::new("pg_tools", &["pg_restore"]));
    assert_eq!(pg_request("psql").unwrap(), ToolRequest::new("pg_tools", &["psql"]));
    assert!(pg_request("not_a_tool").is_none());
}

#[test]
fn mysql_dump_request_prefers_mariadb_dump_then_mysqldump() {
    let req = mysql_dump_request();
    assert_eq!(req.subdir, "mysql_tools");
    assert_eq!(req.names, vec!["mariadb-dump", "mysqldump"]);
    assert_eq!(req.bundled_name(), "mariadb-dump");
}

#[test]
fn mysql_client_request_prefers_mariadb_then_mysql() {
    let req = mysql_client_request();
    assert_eq!(req.names, vec!["mariadb", "mysql"]);
    assert_eq!(req.bundled_name(), "mariadb");
}

#[test]
fn cache_key_is_stable_and_name_ordered() {
    assert_eq!(mysql_dump_request().cache_key(), "mysql_tools::mariadb-dump,mysqldump");
    assert_eq!(pg_dump_request().cache_key(), "pg_tools::pg_dump");
}

#[test]
fn tool_source_maps_to_ui_string() {
    assert_eq!(ToolSource::TrustedDir.as_str(), "system");
    assert_eq!(ToolSource::Path.as_str(), "system");
    assert_eq!(ToolSource::Bundled.as_str(), "bundled");
}

#[cfg(target_os = "macos")]
#[test]
fn trusted_dirs_include_homebrew_and_postgres_app_on_macos() {
    let dirs = trusted_dirs();
    assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")), "{dirs:?}");
    assert!(dirs.contains(&PathBuf::from("/opt/homebrew/opt/mysql-client/bin")), "{dirs:?}");
    assert!(dirs.contains(&PathBuf::from("/usr/local/opt/libpq/bin")), "{dirs:?}");
    assert!(dirs.iter().any(|d| d.ends_with("Postgres.app/Contents/Versions/latest/bin")), "{dirs:?}");
}

#[cfg(target_os = "linux")]
#[test]
fn trusted_dirs_include_usr_bin_on_linux() {
    assert!(trusted_dirs().contains(&PathBuf::from("/usr/bin")));
}

#[cfg(windows)]
#[test]
fn trusted_dirs_are_empty_on_windows() {
    assert!(trusted_dirs().is_empty());
}

#[test]
fn bundled_tool_path_includes_the_nested_resources_prefix() {
    // THE BUG FROM ISSUE #44: the shipped app stores the tool at
    // <resource_dir>/resources/mysql_tools/mariadb-dump, never at
    // <resource_dir>/mysql_tools/mariadb-dump.
    let p = bundled_tool_path(Path::new("/app/Contents/Resources"), "mysql_tools", "mariadb-dump");
    assert_eq!(
        p,
        PathBuf::from("/app/Contents/Resources/resources/mysql_tools").join(bundled_bin_name("mariadb-dump"))
    );
    assert!(p.to_string_lossy().ends_with("resources/mysql_tools/mariadb-dump"));
}

#[test]
fn bundled_tool_path_works_for_postgres_tools_too() {
    let p = bundled_tool_path(Path::new("/app/Contents/Resources"), "pg_tools", "pg_dump");
    assert!(p.to_string_lossy().ends_with("resources/pg_tools/pg_dump"));
}

#[test]
fn bundled_prefix_matches_tauri_config_resources() {
    let conf = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
        .expect("tauri.conf.json must be readable");
    let json: serde_json::Value = serde_json::from_str(&conf).unwrap();
    let resources = json["bundle"]["resources"]
        .as_array()
        .expect("bundle.resources must be an array");
    assert!(!resources.is_empty(), "bundle.resources must not be empty");
    for entry in resources {
        let glob = entry.as_str().unwrap();
        let top = Path::new(glob).components().next().unwrap();
        assert_eq!(
            top.as_os_str().to_str().unwrap(),
            BUNDLED_RESOURCE_PREFIX,
            "resource glob `{glob}` must start with `{BUNDLED_RESOURCE_PREFIX}/`"
        );
    }
}

#[test]
fn path_lookup_finds_an_executable_by_name() {
    let dir = unique_dir();
    let exe = dir.join(bundled_bin_name("mysqldump"));
    std::fs::write(&exe, b"").unwrap();
    let path_var = std::env::join_paths([&dir]).unwrap();
    assert_eq!(path_lookup_in("mysqldump", &path_var), Some(exe));
}

#[test]
fn path_lookup_skips_empty_entries_and_missing_names() {
    let dir = unique_dir();
    let path_var = std::env::join_paths([PathBuf::from(""), dir.clone()]).unwrap();
    assert_eq!(path_lookup_in("definitely-absent-tool", &path_var), None);
}

#[test]
fn probe_rejects_a_missing_file_and_a_directory() {
    let dir = unique_dir();
    assert!(!probe(&dir.join("absent-tool")));
    assert!(!probe(&dir), "a directory must never be reported as a runnable tool");
}

#[cfg(unix)]
#[test]
fn run_version_is_true_for_zero_exit_and_false_for_nonzero() {
    let ok = unique_dir().join("ok_tool");
    write_exe(&ok, "#!/bin/sh\nexit 0\n");
    assert!(run_version(&ok, Duration::from_secs(1)));

    let bad = unique_dir().join("bad_tool");
    write_exe(&bad, "#!/bin/sh\nexit 3\n");
    assert!(!run_version(&bad, Duration::from_secs(1)));
}

#[cfg(unix)]
#[test]
fn run_version_kills_a_hung_process_at_the_timeout() {
    let slow = unique_dir().join("slow_tool");
    write_exe(&slow, "#!/bin/sh\nsleep 5\n");
    assert!(!run_version(&slow, Duration::from_millis(50)));
}

#[cfg(unix)]
#[test]
fn probe_accepts_a_runnable_script() {
    let tool = unique_dir().join(bundled_bin_name("mariadb-dump"));
    write_exe(&tool, "#!/bin/sh\necho 'mariadb-dump 11.4.5-MariaDB'\nexit 0\n");
    assert!(probe(&tool));
}

#[cfg(unix)]
#[test]
fn version_of_reads_the_version_from_stdout() {
    let tool = unique_dir().join("versioned_tool");
    write_exe(&tool, "#!/bin/sh\necho 'mariadb-dump 11.4.5-MariaDB'\n");
    let v = version_of(tool.to_str().unwrap()).unwrap();
    assert!(v.contains("11.4.5-MariaDB"), "got {v}");
}

#[cfg(unix)]
#[test]
fn probe_within_returns_false_once_the_aggregate_deadline_passed() {
    let tool = unique_dir().join("ok_tool");
    write_exe(&tool, "#!/bin/sh\nexit 0\n");
    let past = Instant::now() - Duration::from_secs(10);
    assert!(!probe_within(past, Duration::from_secs(3), &tool));
    assert!(probe_within(Instant::now(), Duration::from_secs(3), &tool));
}

#[cfg(unix)]
fn write_exe(path: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, body).unwrap();
    let mut perms = std::fs::metadata(path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).unwrap();
}

fn unique_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir()
        .join(format!("gridline_tool_resolver_{}_{}", std::process::id(), nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
