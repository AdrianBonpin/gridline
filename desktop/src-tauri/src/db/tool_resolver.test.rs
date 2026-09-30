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

#[test]
fn resolve_prefers_a_trusted_dir_and_the_first_candidate_name() {
    let req = mysql_dump_request();
    let trusted = vec![PathBuf::from("/trusted")];
    let path_lookup = |_n: &str| -> Option<PathBuf> { None };
    let r = resolve_with(&req, &trusted, &path_lookup, None, |_p: &Path| true).unwrap();
    assert_eq!(r.source, ToolSource::TrustedDir);
    assert_eq!(r.name, "mariadb-dump");
    assert_eq!(r.program, format!("/trusted/{}", bundled_bin_name("mariadb-dump")));
}

#[test]
fn resolve_falls_through_to_the_inherited_path() {
    let req = mysql_dump_request();
    let trusted = vec![PathBuf::from("/trusted")];
    let path_lookup = |name: &str| -> Option<PathBuf> {
        if name == "mysqldump" { Some(PathBuf::from("/usr/bin/mysqldump")) } else { None }
    };
    let probe = |p: &Path| p == Path::new("/usr/bin/mysqldump");
    let r = resolve_with(&req, &trusted, &path_lookup, None, probe).unwrap();
    assert_eq!(r.source, ToolSource::Path);
    assert_eq!(r.name, "mysqldump");
    assert_eq!(r.program, "/usr/bin/mysqldump");
}

#[test]
fn resolve_prefers_any_system_tool_over_the_bundled_one() {
    let req = mysql_dump_request();
    let trusted = vec![PathBuf::from("/trusted")];
    let path_lookup = |_n: &str| -> Option<PathBuf> { None };
    let bundled = Path::new("/rd/resources/mysql_tools/mariadb-dump");
    let probe = |p: &Path| p != bundled; // only the trusted candidate runs
    let r = resolve_with(&req, &trusted, &path_lookup, Some(bundled), probe).unwrap();
    assert_eq!(r.source, ToolSource::TrustedDir);
}

#[test]
fn resolve_uses_the_bundled_binary_when_no_system_tool_runs() {
    let req = mysql_dump_request();
    let bundled = Path::new("/rd/resources/mysql_tools/mariadb-dump");
    let path_lookup = |_n: &str| -> Option<PathBuf> { None };
    let probe = |p: &Path| p == bundled;
    let r = resolve_with(&req, &[], &path_lookup, Some(bundled), probe).unwrap();
    assert_eq!(r.source, ToolSource::Bundled);
    assert_eq!(r.name, "mariadb-dump");
    assert_eq!(r.program, "/rd/resources/mysql_tools/mariadb-dump");
}

#[test]
fn resolve_skips_a_candidate_that_fails_the_probe() {
    let req = mysql_dump_request();
    let trusted = vec![PathBuf::from("/trusted")];
    let target = PathBuf::from("/trusted").join(bundled_bin_name("mysqldump"));
    let probe = move |p: &Path| p == target.as_path();
    let path_lookup = |_n: &str| -> Option<PathBuf> { None };
    let r = resolve_with(&req, &trusted, &path_lookup, None, probe).unwrap();
    assert_eq!(r.name, "mysqldump");
    assert_eq!(r.source, ToolSource::TrustedDir);
}

#[test]
fn resolve_returns_none_when_nothing_runs() {
    let req = mysql_dump_request();
    let path_lookup = |_n: &str| -> Option<PathBuf> { None };
    let r = resolve_with(&req, &[PathBuf::from("/trusted")], &path_lookup, Some(Path::new("/rd/x")), |_p: &Path| false);
    assert!(r.is_none());
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

#[test]
fn parse_major_handles_common_version_strings() {
    assert_eq!(parse_major("8.0.36"), Some(8));
    assert_eq!(parse_major("8.4.0"), Some(8));
    assert_eq!(parse_major("11.4.5-MariaDB"), Some(11));
    assert_eq!(parse_major("5.7.44-log"), Some(5));
    assert_eq!(parse_major("26.7.0"), Some(26));
    assert_eq!(parse_major("mariadb-dump from 11.4.5-MariaDB, client 10.19"), Some(11));
}

#[test]
fn parse_major_unwraps_the_legacy_mariadb_compat_prefix() {
    // MariaDB historically reported 5.5.5-<real version>-MariaDB for compat
    // with MySQL-era clients; the real major is the 4th group.
    assert_eq!(parse_major("5.5.5-10.4.11-MariaDB"), Some(10));
    assert_eq!(parse_major("5.5.5-10.11.6-MariaDB-log"), Some(10));
    // A genuine 5.5.5 has only three groups and must stay 5.
    assert_eq!(parse_major("5.5.5"), Some(5));
}

#[test]
fn parse_major_returns_none_for_garbage() {
    assert_eq!(parse_major("no digits here"), None);
    assert_eq!(parse_major(""), None);
}

#[test]
fn compat_flags_only_a_clearly_older_client() {
    assert_eq!(compat(Some(8), Some(26)), Compat::ClientOlder);
    assert_eq!(compat(Some(11), Some(8)), Compat::Ok);
    assert_eq!(compat(Some(8), Some(8)), Compat::Ok);
    assert_eq!(compat(None, Some(8)), Compat::Unknown);
    assert_eq!(compat(Some(8), None), Compat::Unknown);
}

#[test]
fn warning_for_is_silent_unless_the_client_is_older() {
    assert!(warning_for("mariadb-dump 11.4.5-MariaDB", "8.0.36", "mariadb-dump").is_none());
    assert!(warning_for("unknown", "8.0.36", "mariadb-dump").is_none());
    let w = warning_for("mariadb-dump 11.4.5-MariaDB", "26.7.0", "mariadb-dump").unwrap();
    assert!(w.contains("11.4.5-MariaDB"), "{w}");
    assert!(w.contains("26.7.0"), "{w}");
    assert!(w.contains("mariadb-dump"), "{w}");
    // The `\` continuation in the format literal must not leave stray leading
    // indentation, so assert the exact single-line render (no newline, no run
    // of consecutive spaces).
    assert!(!w.contains('\n'), "warning must be one line: {w:?}");
    assert!(!w.contains("  "), "warning must not contain double spaces: {w:?}");
    assert_eq!(
        w,
        concat!(
            "Client/server version mismatch: the resolved dump tool `mariadb-dump` reports ",
            "mariadb-dump 11.4.5-MariaDB, but the server is 26.7.0. ",
            "The backup may fail or omit data — installing a matching MySQL client is recommended."
        )
    );
}

#[test]
fn parse_major_never_panics_on_hostile_input() {
    // A digit group that overflows u32 yields None, never a panic.
    assert_eq!(parse_major("99999999999999999999.1.1"), None);
    assert_eq!(parse_major(&"9".repeat(4096)), None);
    // Non-ASCII digits, unicode and control characters are simply skipped.
    assert_eq!(parse_major("\u{fc}nicode ٨.٠.٣٦"), None);
    assert_eq!(parse_major("\u{1F600}"), None);
    assert_eq!(parse_major("\u{0}\u{1}\u{2}"), None);
    assert_eq!(parse_major("....."), None);
    // Long adversarial input: the group collector is capped at six, and only
    // the first group decides the major.
    assert_eq!(parse_major(&"1.2.3.4.".repeat(1000)), Some(1));
    // An overflowing *trailing* group is skipped by the final flush, so a
    // genuine-looking `5.5.5` prefix still yields 5 rather than panicking.
    // Harmless: no real tool prints such a version, and the result is advisory.
    assert_eq!(parse_major("5.5.5-99999999999999999999"), Some(5));
}

#[test]
fn adapt_resolution_returns_program_and_source() {
    let res = ToolResolution {
        resolved: Some(Resolution {
            program: "/x/mariadb-dump".into(),
            source: ToolSource::Bundled,
            name: "mariadb-dump".into(),
        }),
        bundled_path: Some(PathBuf::from("/x/mariadb-dump")),
        bundled_available: true,
        version: Some("11.4.5".into()),
    };
    assert_eq!(
        adapt_resolution(&res, "mariadb-dump"),
        ("/x/mariadb-dump".to_string(), Some("bundled".to_string()))
    );
}

#[test]
fn adapt_resolution_falls_back_to_the_requested_name() {
    assert_eq!(
        adapt_resolution(&ToolResolution::none(), "pg_dump"),
        ("pg_dump".to_string(), None)
    );
}

#[test]
fn cache_round_trips_and_clears() {
    cache_clear();
    let res = ToolResolution {
        resolved: Some(Resolution {
            program: "/c/tool".into(),
            source: ToolSource::Path,
            name: "tool".into(),
        }),
        bundled_path: None,
        bundled_available: false,
        version: None,
    };
    assert!(cache_get("k_task6_unique").is_none());
    cache_put("k_task6_unique", res.clone());
    assert_eq!(cache_get("k_task6_unique"), Some(res));
    cache_clear();
    assert!(cache_get("k_task6_unique").is_none());
}

#[test]
fn bundled_present_is_true_only_for_a_regular_file() {
    let dir = unique_dir();
    assert!(!bundled_present(&dir), "a directory is not a present bundled tool");
    let file = dir.join("mariadb-dump");
    std::fs::write(&file, b"x").unwrap();
    assert!(bundled_present(&file));
}
