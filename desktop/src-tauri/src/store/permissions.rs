//! Filesystem protection for the local store.
//!
//! The store holds connection metadata (hosts, users, SSH/TLS paths) and query
//! history, so its directory, database file and SQLite sidecars are restricted
//! to the current OS account. This runs on every [`super::Store::open`], which
//! means an installation created by an older build is tightened the next time
//! the app starts instead of keeping its permissive modes forever.
//!
//! Modes are only meaningful on platforms with Unix-style permissions; on other
//! platforms the store relies on the platform's own ACL behaviour and these
//! functions are no-ops.

use std::path::{Path, PathBuf};

/// SQLite sidecars that can accompany the store file: the rollback journal and
/// the two WAL files. They hold the same data as the store file itself.
const SIDECAR_SUFFIXES: [&str; 3] = ["-journal", "-wal", "-shm"];

/// Owner read/write only.
#[cfg(unix)]
const STORE_FILE_MODE: u32 = 0o600;

/// Owner read/write/execute only.
#[cfg(unix)]
const STORE_DIR_MODE: u32 = 0o700;

/// The store file plus its sidecars, in a stable order.
pub fn store_file_paths(db_path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(SIDECAR_SUFFIXES.len() + 1);
    paths.push(db_path.to_path_buf());
    let name = db_path.as_os_str().to_os_string();
    for suffix in SIDECAR_SUFFIXES {
        let mut sidecar = name.clone();
        sidecar.push(suffix);
        paths.push(PathBuf::from(sidecar));
    }
    paths
}

/// Create the store directory if needed and restrict it to the current account.
pub fn secure_store_directory(db_path: &Path) -> Result<(), String> {
    let dir = db_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            format!(
                "local store path {} has no directory to secure",
                db_path.display()
            )
        })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(STORE_DIR_MODE)
            .create(dir)
            .map_err(|e| {
                format!(
                    "failed to create local store directory {}: {e}",
                    dir.display()
                )
            })?;
        let meta = std::fs::metadata(dir).map_err(|e| {
            format!(
                "failed to inspect local store directory {}: {e}",
                dir.display()
            )
        })?;
        if !meta.is_dir() {
            return Err(format!(
                "local store directory {} is not a directory",
                dir.display()
            ));
        }
        if meta.permissions().mode() & 0o777 != STORE_DIR_MODE {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(STORE_DIR_MODE))
                .map_err(|e| {
                    format!(
                        "failed to restrict local store directory {} to the current account: {e}",
                        dir.display()
                    )
                })?;
        }
    }
    #[cfg(not(unix))]
    let _ = dir;

    Ok(())
}

/// Restrict the store file and any sidecars left behind to the current account.
///
/// Missing sidecars are normal (SQLite removes them when it closes cleanly) and
/// links are never followed, so the store only ever tightens its own files.
pub fn secure_store_files(db_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in store_file_paths(db_path) {
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    return Err(format!(
                        "failed to inspect local store file {}: {e}",
                        path.display()
                    ))
                }
            };
            if !meta.file_type().is_file() {
                continue;
            }
            if meta.permissions().mode() & 0o777 == STORE_FILE_MODE {
                continue;
            }
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(STORE_FILE_MODE))
                .map_err(|e| {
                    format!(
                        "failed to restrict local store file {} to the current account: {e}",
                        path.display()
                    )
                })?;
        }
    }
    #[cfg(not(unix))]
    let _ = db_path;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    fn temp_store(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "gridline_store_perm_{tag}_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("gridline.db");
        (dir, db)
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    fn set_mode(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    fn touch(path: &Path) {
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(b"").unwrap();
    }

    #[test]
    fn store_file_paths_cover_the_database_and_its_sidecars() {
        let paths = store_file_paths(Path::new("/tmp/gridline.db"));
        let names: Vec<String> = paths
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names,
            vec![
                "gridline.db".to_string(),
                "gridline.db-journal".to_string(),
                "gridline.db-wal".to_string(),
                "gridline.db-shm".to_string(),
            ],
            "the store file, rollback journal and WAL sidecars must all be covered"
        );
    }

    #[cfg(unix)]
    #[test]
    fn existing_directory_file_and_sidecars_are_restricted_to_the_current_account() {
        let (dir, db) = temp_store("existing");
        // A pre-existing installation: permissive modes from a plain umask.
        touch(&db);
        let journal = PathBuf::from(format!("{}-journal", db.display()));
        let wal = PathBuf::from(format!("{}-wal", db.display()));
        let shm = PathBuf::from(format!("{}-shm", db.display()));
        for sidecar in [&journal, &wal, &shm] {
            touch(sidecar);
            set_mode(sidecar, 0o644);
        }
        set_mode(&db, 0o644);
        set_mode(&dir, 0o755);

        secure_store_directory(&db).unwrap();
        secure_store_files(&db).unwrap();

        assert_eq!(mode(&dir), 0o700, "the store directory must be owner-only");
        assert_eq!(mode(&db), 0o600, "the store file must be owner-only");
        for sidecar in [&journal, &wal, &shm] {
            assert_eq!(
                mode(sidecar),
                0o600,
                "sidecar {} must be owner-only",
                sidecar.display()
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn restricting_permissions_is_idempotent() {
        let (dir, db) = temp_store("idempotent");
        touch(&db);
        secure_store_directory(&db).unwrap();
        secure_store_files(&db).unwrap();
        secure_store_directory(&db).unwrap();
        secure_store_files(&db).unwrap();
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&db), 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_regular_file_where_the_directory_belongs_is_reported() {
        let (dir, _db) = temp_store("blocked");
        // The parent of the store file is a file, so the directory cannot be
        // created or restricted: this must fail rather than continue with an
        // unsecured store path.
        let blocked = dir.join("not-a-directory");
        touch(&blocked);
        let nested = blocked.join("gridline.db");

        let err = secure_store_directory(&nested)
            .expect_err("an unsecurable store directory must be reported");
        assert!(
            err.contains("store directory"),
            "the failure must name what could not be secured, got: {err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(not(unix))]
    #[test]
    fn restricting_permissions_is_a_no_op_without_unix_modes() {
        let (dir, db) = temp_store("non_unix");
        touch(&db);
        secure_store_directory(&db).unwrap();
        secure_store_files(&db).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
