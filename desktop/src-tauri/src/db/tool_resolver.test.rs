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
