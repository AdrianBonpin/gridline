use crate::commands::db_viewer::MAX_TABLE_PAGE_SIZE;
use crate::models::Settings;
use crate::store::Store;
use std::collections::HashMap;
use std::sync::Mutex;

pub fn get_settings_inner(state: &Mutex<Store>) -> Result<Settings, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_settings()
}

/// Write one setting.
///
/// Validation is not repeated here: `Store::update_setting` judges every key
/// against the one declared rule table (`store::settings_schema`, ADR 0003), so
/// the command layer holds no range of its own and a caller that bypasses this
/// layer is governed identically.
pub fn update_setting_inner(state: &Mutex<Store>, key: &str, value: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.update_setting(key, value)
}

/// Why a page size is not one the browse path could use.
fn page_size_error(size: i64) -> String {
    format!("table_page_size {size} must be between 1 and {MAX_TABLE_PAGE_SIZE}")
}

/// Validate an imported settings document, in place, before anything is stored.
///
/// A settings file is untrusted input that arrives through a File Grant, and the
/// renderer that reads it is not the boundary: its own clamp was computed and
/// then discarded (the raw file text was forwarded, never the validated
/// document), so importing `table_page_size: 100000` stored 100000 and made
/// every subsequent browse fail. The backend clamps/refuses here so the stored
/// value is always one the browse path accepts, whichever client sent it.
///
/// A value that names no page (`<= 0`) is refused rather than salvaged; an
/// oversized one is clamped to the largest page the grid offers, because an
/// imported document states a preference ("as many rows as you can show") and
/// clamping keeps the app usable instead of failing the whole import.
pub(crate) fn validate_imported_settings(settings: &mut Settings) -> Result<(), String> {
    if settings.table_page_size <= 0 {
        return Err(page_size_error(settings.table_page_size));
    }
    if settings.table_page_size > MAX_TABLE_PAGE_SIZE {
        settings.table_page_size = MAX_TABLE_PAGE_SIZE;
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<crate::AppState>) -> Result<Settings, String> {
    get_settings_inner(&state.db_store)
}

#[tauri::command]
pub fn update_setting(
    state: tauri::State<crate::AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    update_setting_inner(&state.db_store, &key, &value)
}

// ---------------------------------------------------------------------------
// Settings export / import (v0.7.8)
// ---------------------------------------------------------------------------

/// Flatten a `Settings` struct into the store's key/value map. Keys and value
/// formats must round-trip through `Store::get_settings` (e.g. a `None`
/// `default_folder_id` is stored as the literal `"null"` sentinel, which
/// `get_settings` filters back to `None`).
fn settings_to_kv(s: &crate::models::Settings) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert(
        "confirm_before_delete".into(),
        s.confirm_before_delete.to_string(),
    );
    if let Some(f) = &s.default_folder_id {
        m.insert("default_folder_id".into(), f.clone());
    } else {
        m.insert("default_folder_id".into(), "null".into());
    }
    m.insert("theme".into(), s.theme.clone());
    m.insert("font_size".into(), s.font_size.clone());
    m.insert("accent_color".into(), s.accent_color.clone());
    m.insert(
        "table_refresh_rate".into(),
        s.table_refresh_rate.to_string(),
    );
    m.insert("table_page_size".into(), s.table_page_size.to_string());
    m.insert("editor_font_size".into(), s.editor_font_size.to_string());
    m.insert("editor_font_family".into(), s.editor_font_family.clone());
    m.insert("editor_word_wrap".into(), s.editor_word_wrap.clone());
    m.insert("editor_minimap".into(), s.editor_minimap.to_string());
    m.insert("editor_tab_size".into(), s.editor_tab_size.to_string());
    if let Some(o) = &s.tag_order {
        m.insert("tag_order".into(), o.clone());
    }
    m.insert(
        "default_ports".into(),
        serde_json::to_string(&s.default_ports).unwrap_or_default(),
    );
    m.insert(
        "shortcuts".into(),
        serde_json::to_string(&s.shortcuts).unwrap_or_default(),
    );
    m
}

/// The JSON document an exported settings file contains.
fn settings_export_json(store: &Mutex<Store>) -> Result<String, String> {
    let s = get_settings_inner(store)?;
    serde_json::to_string(&crate::models::settings::SettingsExport {
        schema_version: 1,
        settings: s,
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_settings(state: tauri::State<crate::AppState>) -> Result<String, String> {
    settings_export_json(&state.db_store)
}

#[tauri::command]
pub fn import_settings(json: String, state: tauri::State<crate::AppState>) -> Result<(), String> {
    import_settings_text(&state.db_store, &json)
}

fn import_settings_text(store: &Mutex<Store>, json: &str) -> Result<(), String> {
    let mut env: crate::models::settings::SettingsExport =
        serde_json::from_str(json).map_err(|e| format!("invalid settings file: {e}"))?;
    validate_imported_settings(&mut env.settings)?;
    let map = settings_to_kv(&env.settings);
    let store = store.lock().map_err(|e| e.to_string())?;
    store.apply_settings(&map)
}

// ---------------------------------------------------------------------------
// Settings import / export through File Grants
//
// A settings file is a file like any other: the renderer cannot name one. Both
// directions consume a File Grant minted by the Rust-brokered native picker
// (`select_file_for_grant`), so a raw renderer-supplied path authorizes nothing
// and `plugin-fs` is not needed for this flow at all. Grant expiry, intent and
// single-use semantics are the store's (see `crate::file_grant`).
// ---------------------------------------------------------------------------

/// Hard cap on a settings file. Real settings are a few kilobytes of key/value
/// data; a larger file is a mistake (or an attack), not a legitimate import.
pub const MAX_SETTINGS_FILE_BYTES: u64 = 1024 * 1024;

/// Write settings JSON to the path a **write-intent** grant authorized.
///
/// Atomic publication: the document is written to a temporary sibling, flushed
/// and synced, then renamed over the destination — a failed export leaves any
/// existing file intact and no partial artifact behind (see
/// [`crate::commands::file_io::write_atomically`]).
pub(crate) fn export_settings_to_granted_path(
    grants: &crate::file_grant::FileGrantStore,
    store: &Mutex<Store>,
    grant_id: &str,
) -> Result<String, String> {
    let path = crate::file_grant::consume_granted_path(
        grants,
        grant_id,
        crate::file_grant::FileIntent::Write,
    )?;
    let json = settings_export_json(store)?;
    crate::commands::file_io::write_atomically(std::path::Path::new(&path), json.as_bytes())?;
    Ok(path)
}

/// Read a settings file through a **read-intent** grant.
///
/// The file must be a regular file within the size cap; the renderer receives its
/// text, which it validates before applying (`import_settings`).
pub(crate) fn read_settings_from_granted_path(
    grants: &crate::file_grant::FileGrantStore,
    grant_id: &str,
) -> Result<String, String> {
    let path = crate::file_grant::consume_granted_path(
        grants,
        grant_id,
        crate::file_grant::FileIntent::Read,
    )?;
    crate::commands::file_io::read_text_capped(
        std::path::Path::new(&path),
        MAX_SETTINGS_FILE_BYTES,
        "settings file",
    )
}

/// Export settings to the file the user selected. `file_grant` is the id from
/// `select_file_for_grant` (write intent) and is consumed by this call.
#[tauri::command]
pub fn export_settings_to_file(
    file_grant: String,
    state: tauri::State<crate::AppState>,
) -> Result<String, String> {
    export_settings_to_granted_path(&state.file_grants, &state.db_store, &file_grant)
}

/// Read the text of the settings file the user selected. `file_grant` is the id
/// from `select_file_for_grant` (read intent) and is consumed by this call.
#[tauri::command]
pub fn read_settings_file(
    file_grant: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    read_settings_from_granted_path(&state.file_grants, &file_grant)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn).expect("test store"))
    }

    #[test]
    fn get_settings_returns_defaults() {
        let st = state();
        let s = get_settings_inner(&st).unwrap();
        assert_eq!(s.theme, "system");
        assert_eq!(s.font_size, "medium");
        assert_eq!(s.accent_color, "#2563EB");
    }

    #[test]
    fn update_setting_persists() {
        let st = state();
        update_setting_inner(&st, "theme", "light").unwrap();
        assert_eq!(get_settings_inner(&st).unwrap().theme, "light");
    }

    #[test]
    fn update_accent_color_persists() {
        let st = state();
        update_setting_inner(&st, "accent_color", "#EF4444").unwrap();
        assert_eq!(get_settings_inner(&st).unwrap().accent_color, "#EF4444");
    }

    #[test]
    fn settings_export_envelope_camel_case() {
        use std::collections::HashMap;
        let env = crate::models::settings::SettingsExport {
            schema_version: 1,
            settings: crate::models::Settings {
                confirm_before_delete: true,
                default_folder_id: None,
                theme: "dark".into(),
                font_size: "medium".into(),
                default_ports: HashMap::new(),
                tag_order: None,
                table_refresh_rate: 5,
                table_page_size: 50,
                shortcuts: HashMap::new(),
                accent_color: "#2563EB".into(),
                editor_font_size: 14,
                editor_font_family: "Menlo".into(),
                editor_word_wrap: "off".into(),
                editor_minimap: true,
                editor_tab_size: 2,
            },
        };
        let json = serde_json::to_string(&env).unwrap();
        assert!(json.contains("\"schemaVersion\":1"));
        assert!(json.contains("\"settings\":"));
    }

    // ── File-Grant gated settings import/export (F4) ──────────────────

    fn temp_settings_path(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gridline_settings_{tag}_{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("gridline-settings.json")
    }

    #[test]
    fn export_settings_requires_a_grant() {
        let grants = crate::file_grant::FileGrantStore::new();
        let st = state();
        // A path the renderer supplies is not a grant: nothing is written, and the
        // refusal names the grant state rather than silently succeeding.
        let err = export_settings_to_granted_path(&grants, &st, "/tmp/not-a-grant.json")
            .expect_err("a bare path must not authorize a write");
        assert!(
            err.contains("file-grant-invalid"),
            "the refusal must name the grant state: {err}"
        );
        assert!(
            !std::path::Path::new("/tmp/not-a-grant.json").exists(),
            "nothing may be written"
        );
    }

    #[test]
    fn export_settings_writes_the_granted_path_atomically() {
        let grants = crate::file_grant::FileGrantStore::new();
        let st = state();
        update_setting_inner(&st, "theme", "light").unwrap();
        let path = temp_settings_path("export");
        // An existing destination must survive a successful export only as the new
        // content, and no partial sibling may be left behind.
        std::fs::write(&path, b"OLD").unwrap();
        let grant = grants.mint(path.clone(), crate::file_grant::FileIntent::Write);

        let written = export_settings_to_granted_path(&grants, &st, &grant.id).unwrap();
        assert_eq!(written, path.to_string_lossy());
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains("\"theme\"") && text.contains("light"),
            "{text}"
        );
        let siblings: Vec<String> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".gridline-partial-"))
            .collect();
        assert!(
            siblings.is_empty(),
            "no partial output may survive: {siblings:?}"
        );

        // Single use: replaying the grant is refused.
        assert!(export_settings_to_granted_path(&grants, &st, &grant.id).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_write_grant_cannot_be_used_to_read_settings() {
        let grants = crate::file_grant::FileGrantStore::new();
        let path = temp_settings_path("wrong-intent");
        std::fs::write(&path, b"{}").unwrap();
        let grant = grants.mint(path.clone(), crate::file_grant::FileIntent::Write);
        let err = read_settings_from_granted_path(&grants, &grant.id)
            .expect_err("a write grant must not authorize a read");
        assert!(err.contains("file-grant"), "{err}");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn read_settings_requires_a_grant_and_honors_the_size_cap() {
        let grants = crate::file_grant::FileGrantStore::new();
        let path = temp_settings_path("read");
        std::fs::write(&path, b"{\"schemaVersion\":1}").unwrap();

        assert!(read_settings_from_granted_path(&grants, "/tmp/bare-path.json").is_err());

        let grant = grants.mint(path.clone(), crate::file_grant::FileIntent::Read);
        assert_eq!(
            read_settings_from_granted_path(&grants, &grant.id).unwrap(),
            "{\"schemaVersion\":1}"
        );

        // Oversized input is refused before it is read into memory.
        std::fs::write(&path, vec![b' '; (MAX_SETTINGS_FILE_BYTES + 1) as usize]).unwrap();
        let big = grants.mint(path.clone(), crate::file_grant::FileIntent::Read);
        let err = read_settings_from_granted_path(&grants, &big.id).expect_err("too large");
        assert!(err.contains("too large"), "{err}");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn store_apply_settings_writes_all_keys() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = crate::store::Store::from_connection(conn).expect("test store");
        let mut map = std::collections::HashMap::new();
        map.insert("theme".to_string(), "light".to_string());
        map.insert("accent_color".to_string(), "#EF4444".to_string());
        store.apply_settings(&map).unwrap();
        assert_eq!(store.get_settings().unwrap().theme, "light");
        assert_eq!(store.get_settings().unwrap().accent_color, "#EF4444");
    }

    // ── An imported page size must stay inside the range browse accepts ──

    /// A settings file with one `table_page_size` value, in the exported shape.
    fn settings_file(page_size: i64) -> String {
        let env = crate::models::settings::SettingsExport {
            schema_version: 1,
            settings: crate::models::Settings {
                confirm_before_delete: true,
                default_folder_id: None,
                theme: "dark".into(),
                font_size: "medium".into(),
                default_ports: HashMap::new(),
                tag_order: None,
                table_refresh_rate: 0,
                table_page_size: page_size,
                shortcuts: HashMap::new(),
                accent_color: "#2563EB".into(),
                editor_font_size: 14,
                editor_font_family: "Menlo".into(),
                editor_word_wrap: "off".into(),
                editor_minimap: false,
                editor_tab_size: 2,
            },
        };
        serde_json::to_string(&env).unwrap()
    }

    /// The regression: importing an oversized page size used to store it verbatim,
    /// after which `page_window` rejected every table browse with
    /// "page size 100000 must be between 1 and 500" — the app was broken by a
    /// settings import. The stored value must be one browse accepts.
    #[test]
    fn importing_an_oversized_page_size_leaves_a_usable_page_size() {
        let st = state();
        import_settings_text(&st, &settings_file(100_000)).unwrap();

        let stored = get_settings_inner(&st).unwrap();
        assert_eq!(stored.table_page_size, MAX_TABLE_PAGE_SIZE);
        // Browse works afterwards: the stored size is inside the accepted window.
        assert_eq!(
            crate::commands::db_viewer::page_window(Some(1), Some(stored.table_page_size)),
            Ok((1, 500, 0)),
            "a table browse must still be possible after the import"
        );
    }

    /// A page size that names no page cannot be salvaged into one: it is refused,
    /// and the store keeps what it had.
    #[test]
    fn importing_a_non_positive_page_size_is_refused() {
        let st = state();
        update_setting_inner(&st, "table_page_size", "100").unwrap();

        for bad in [0, -50] {
            let err = import_settings_text(&st, &settings_file(bad))
                .expect_err("a non-positive page size must be refused");
            assert!(err.contains("table_page_size"), "got: {err}");
            assert!(err.contains(&bad.to_string()), "got: {err}");
            assert_eq!(
                get_settings_inner(&st).unwrap().table_page_size,
                100,
                "a refused import must store nothing"
            );
        }
    }

    /// The bounds themselves are valid, and are kept exactly.
    #[test]
    fn importing_an_in_range_page_size_is_kept() {
        for size in [1, 500] {
            let st = state();
            import_settings_text(&st, &settings_file(size)).unwrap();
            assert_eq!(get_settings_inner(&st).unwrap().table_page_size, size);
        }
    }

    /// The same range holds for a direct setting write: the renderer is not the
    /// only client that can reach this key.
    #[test]
    fn update_setting_rejects_an_out_of_range_page_size() {
        let st = state();
        for bad in ["100000", "0", "-50", "ten"] {
            assert!(
                update_setting_inner(&st, "table_page_size", bad).is_err(),
                "{bad} must be refused"
            );
        }
        assert_eq!(get_settings_inner(&st).unwrap().table_page_size, 50);
        update_setting_inner(&st, "table_page_size", "500").unwrap();
        assert_eq!(get_settings_inner(&st).unwrap().table_page_size, 500);
    }
}
