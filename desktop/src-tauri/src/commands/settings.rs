use crate::models::Settings;
use crate::store::settings_schema;
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
    let map = settings_document_to_map(json)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    store.apply_settings(&map)
}

/// Judge a whole settings document, and return the key/value map to apply.
///
/// A settings file is untrusted input, and the store's rule table is the only
/// judge of a settings value (ADR 0003, `store::settings_schema`). Three things
/// follow, and the previous per-field handling satisfied none of them:
///
/// - The **document's own keys** are judged, not the fields of the typed
///   `Settings` struct. serde drops a key the struct does not declare, so
///   validating the deserialised struct let a file carrying a setting nothing
///   reads import silently; `store::settings_schema` refuses it by name instead.
/// - **Every** entry is judged before any is written, and **every** refusal is
///   reported — not the first — so a user correcting a file sees all of its
///   problems at once instead of one per attempt.
/// - An out-of-range value is **refused rather than clamped**: a settings file
///   states what the user wants, and silently changing it hides the disagreement.
///
/// Nothing is applied unless the whole document is accepted: `Store::apply_settings`
/// is reached only with a map that already passed every rule.
fn settings_document_to_map(json: &str) -> Result<HashMap<String, String>, String> {
    let document: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid settings file: {e}"))?;
    if document
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .is_none()
    {
        return Err(
            "invalid settings file: schemaVersion is missing or is not a whole number".to_string(),
        );
    }
    let settings = document
        .get("settings")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "invalid settings file: it has no settings object".to_string())?;

    let mut refused: Vec<settings_schema::SettingRefused> = Vec::new();
    let mut map = HashMap::new();
    for (key, value) in settings {
        match settings_schema::check_document_entry(key, value) {
            Ok(stored) => {
                map.insert(key.clone(), stored);
            }
            Err(refusal) => refused.push(refusal),
        }
    }
    // A key this build knows but the file omits would leave that setting neither
    // the file's nor the previous one's — the half-changed state a whole-file
    // refusal exists to prevent.
    for rule in settings_schema::SETTING_RULES {
        if !settings.contains_key(rule.key) {
            refused.push(settings_schema::SettingRefused {
                key: rule.key.to_string(),
                detail: "is missing from the file, so nothing was imported".to_string(),
            });
        }
    }
    if !refused.is_empty() {
        return Err(import_refusal_report(&refused));
    }
    Ok(map)
}

/// The refusal a settings import reports: the count, then one line per key.
///
/// Every offending key is named because the user edits the file and retries; a
/// report of one problem per attempt would turn that into guesswork. The lines
/// are newline-separated so the settings page can show them as written.
fn import_refusal_report(refused: &[settings_schema::SettingRefused]) -> String {
    let mut report = format!(
        "invalid settings file: {} {} refused, so nothing was imported",
        refused.len(),
        if refused.len() == 1 {
            "entry was"
        } else {
            "entries were"
        },
    );
    for refusal in refused {
        report.push_str("\n- ");
        report.push_str(&refusal.to_string());
    }
    report
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
/// text and forwards it to `import_settings`, where the store's rule table judges
/// every entry and refuses the whole document if any of it is invalid.
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

    // ── A settings import is judged as a whole, by the store's rules ─────
    //
    // A settings file is untrusted input, and ADR 0003 makes the store the only
    // judge of a settings value. So a document is judged entry by entry, every
    // offending key is reported, and a refused file leaves settings untouched.

    /// The settings a valid document carries: every key set away from its
    /// default, so "imports completely" is observable key by key.
    fn imported_settings() -> crate::models::Settings {
        let mut ports = HashMap::new();
        ports.insert("postgresql".to_string(), Some(6543));
        let mut shortcuts = HashMap::new();
        shortcuts.insert("open_command_palette".to_string(), "Cmd+K".to_string());
        crate::models::Settings {
            confirm_before_delete: false,
            default_folder_id: Some("folder-1".into()),
            theme: "light".into(),
            font_size: "large".into(),
            default_ports: ports,
            tag_order: Some("[\"b\",\"a\"]".into()),
            table_refresh_rate: 5000,
            table_page_size: 500,
            shortcuts,
            accent_color: "#EF4444".into(),
            editor_font_size: 22,
            editor_font_family: "JetBrains Mono".into(),
            editor_word_wrap: "on".into(),
            editor_minimap: true,
            editor_tab_size: 8,
        }
    }

    /// A settings file in the exported shape, carrying `settings`.
    fn settings_file(settings: crate::models::Settings) -> String {
        serde_json::to_string(&crate::models::settings::SettingsExport {
            schema_version: 1,
            settings,
        })
        .unwrap()
    }

    /// The same document as a mutable value, so a test can inject exactly the
    /// defect it argues about and leave every other entry valid.
    fn settings_doc() -> serde_json::Value {
        serde_json::from_str(&settings_file(imported_settings())).unwrap()
    }

    fn doc_text(doc: &serde_json::Value) -> String {
        serde_json::to_string(doc).unwrap()
    }

    /// What the store holds, read back through the command the interface uses.
    /// "Unchanged" is compared, never inferred from the refusal. Going through a
    /// `serde_json::Value` sorts the object keys, so a `HashMap` whose iteration
    /// order varies cannot make an unchanged settings set look changed.
    fn snapshot(store: &Mutex<Store>) -> String {
        let settings = serde_json::to_value(get_settings_inner(store).unwrap()).unwrap();
        serde_json::to_string(&settings).unwrap()
    }

    /// A valid file imports completely: every key it carries reaches the store.
    #[test]
    fn a_valid_document_imports_completely() {
        let st = state();
        import_settings_text(&st, &settings_file(imported_settings())).unwrap();

        let stored = get_settings_inner(&st).unwrap();
        assert!(!stored.confirm_before_delete);
        assert_eq!(stored.default_folder_id.as_deref(), Some("folder-1"));
        assert_eq!(stored.theme, "light");
        assert_eq!(stored.font_size, "large");
        assert_eq!(stored.default_ports.get("postgresql"), Some(&Some(6543)));
        assert_eq!(stored.tag_order.as_deref(), Some("[\"b\",\"a\"]"));
        assert_eq!(stored.table_refresh_rate, 5000);
        assert_eq!(stored.table_page_size, 500);
        assert_eq!(
            stored.shortcuts.get("open_command_palette"),
            Some(&"Cmd+K".to_string())
        );
        assert_eq!(stored.accent_color, "#EF4444");
        assert_eq!(stored.editor_font_size, 22);
        assert_eq!(stored.editor_font_family, "JetBrains Mono");
        assert_eq!(stored.editor_word_wrap, "on");
        assert!(stored.editor_minimap);
        assert_eq!(stored.editor_tab_size, 8);
        // The regression that started this: a stored page size browse accepts.
        assert_eq!(
            crate::commands::db_viewer::page_window(Some(1), Some(stored.table_page_size)),
            Ok((1, 500, 0))
        );
    }

    /// An exported document imports into an identical settings set: the store form
    /// a document is judged as is the store form it is written as, key for key.
    #[test]
    fn an_exported_document_round_trips_into_identical_settings() {
        let source = state();
        import_settings_text(&source, &settings_file(imported_settings())).unwrap();
        let exported = settings_export_json(&source).unwrap();

        let fresh = state();
        import_settings_text(&fresh, &exported).unwrap();
        assert_eq!(snapshot(&fresh), snapshot(&source));
    }

    /// A wholly invalid file imports none of itself.
    #[test]
    fn a_wholly_invalid_document_is_refused_and_changes_nothing() {
        let st = state();
        update_setting_inner(&st, "theme", "light").unwrap();
        let before = snapshot(&st);

        let mut doc = settings_doc();
        let settings = doc["settings"].as_object_mut().unwrap();
        settings.insert("theme".into(), "purple".into());
        settings.insert("font_size".into(), 12.into());
        settings.insert("accent_color".into(), "blue".into());

        let err = import_settings_text(&st, &doc_text(&doc))
            .expect_err("a wholly invalid file must be refused");
        for key in ["theme", "font_size", "accent_color"] {
            assert!(err.contains(key), "the report must name {key}: {err}");
        }
        assert_eq!(
            snapshot(&st),
            before,
            "a refused import must change nothing"
        );
    }

    /// One bad entry is enough to refuse the file — and only that entry is at
    /// fault, so the rest of the document is valid but must not be applied.
    #[test]
    fn a_document_with_exactly_one_invalid_entry_is_refused_and_changes_nothing() {
        let st = state();
        update_setting_inner(&st, "editor_tab_size", "4").unwrap();
        let before = snapshot(&st);

        let mut doc = settings_doc();
        doc["settings"]["editor_tab_size"] = 9.into();

        let err = import_settings_text(&st, &doc_text(&doc))
            .expect_err("one invalid entry must refuse the file");
        assert!(err.contains("editor_tab_size"), "got: {err}");
        assert!(err.contains("between 2 and 8"), "got: {err}");
        assert_eq!(
            snapshot(&st),
            before,
            "a refused import must change nothing"
        );
    }

    /// The document's own keys are judged, not the fields of the typed struct:
    /// serde drops a key `Settings` does not declare, so a validator that only
    /// looked at the struct would import this file happily and silently.
    #[test]
    fn an_unknown_key_is_refused_by_name() {
        let st = state();
        let before = snapshot(&st);

        let mut doc = settings_doc();
        doc["settings"]["future_setting"] = true.into();
        let text = doc_text(&doc);
        assert!(
            serde_json::from_str::<crate::models::settings::SettingsExport>(&text).is_ok(),
            "the typed settings struct silently drops keys it does not declare"
        );

        let err = import_settings_text(&st, &text)
            .expect_err("a key this build does not know must be refused");
        assert!(err.contains("future_setting"), "got: {err}");
        assert_eq!(
            snapshot(&st),
            before,
            "a refused import must change nothing"
        );
    }

    /// The report names every offending key, not the first one `check_batch`
    /// would have stopped at.
    #[test]
    fn the_report_names_every_offending_key() {
        let st = state();
        let mut doc = settings_doc();
        let settings = doc["settings"].as_object_mut().unwrap();
        settings.insert("table_page_size".into(), 100_000.into());
        settings.insert("theme".into(), "purple".into());
        settings.insert("future_setting".into(), true.into());

        let err = import_settings_text(&st, &doc_text(&doc)).expect_err("three bad entries");
        for key in ["table_page_size", "theme", "future_setting"] {
            assert!(err.contains(key), "the report must name {key}: {err}");
        }
        assert!(err.contains("3 entries were refused"), "got: {err}");
    }

    /// An out-of-range value is refused, never clamped: the settings file says
    /// what the user wants, and silently changing it hides the disagreement.
    #[test]
    fn an_out_of_range_value_is_refused_rather_than_clamped() {
        let out_of_range = crate::commands::db_viewer::MAX_TABLE_PAGE_SIZE + 1;
        for bad in [out_of_range, 100_000] {
            let st = state();
            update_setting_inner(&st, "table_page_size", "100").unwrap();
            let before = snapshot(&st);

            let mut doc = settings_doc();
            doc["settings"]["table_page_size"] = bad.into();
            let err = import_settings_text(&st, &doc_text(&doc))
                .expect_err("an out-of-range page size must be refused, not clamped");
            assert!(err.contains("table_page_size"), "got: {err}");
            assert!(err.contains(&bad.to_string()), "got: {err}");
            assert_eq!(snapshot(&st), before, "nothing may be stored");
        }
    }

    /// A page size that names no page cannot be salvaged into one: it is refused,
    /// and the store keeps what it had.
    #[test]
    fn importing_a_non_positive_page_size_is_refused() {
        let st = state();
        update_setting_inner(&st, "table_page_size", "100").unwrap();

        for bad in [0, -50] {
            let mut settings = imported_settings();
            settings.table_page_size = bad;
            let err = import_settings_text(&st, &settings_file(settings))
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
            let mut settings = imported_settings();
            settings.table_page_size = size;
            import_settings_text(&st, &settings_file(settings)).unwrap();
            assert_eq!(get_settings_inner(&st).unwrap().table_page_size, size);
        }
    }

    /// A document that omits a key this build knows would leave that setting
    /// neither the file's nor the previous one's — the half-changed state the
    /// whole-file refusal exists to prevent.
    #[test]
    fn a_document_missing_a_declared_key_is_refused() {
        let st = state();
        let before = snapshot(&st);

        let mut doc = settings_doc();
        doc["settings"].as_object_mut().unwrap().remove("theme");

        let err = import_settings_text(&st, &doc_text(&doc))
            .expect_err("an incomplete document must be refused");
        assert!(err.contains("theme"), "got: {err}");
        assert!(err.contains("missing"), "got: {err}");
        assert_eq!(
            snapshot(&st),
            before,
            "a refused import must change nothing"
        );
    }

    /// A file that is not a settings document is refused before anything is read
    /// out of it.
    #[test]
    fn a_file_that_is_not_a_settings_document_is_refused() {
        for bad in ["not json", "[]", "null", "{}", "{\"schemaVersion\":1}"] {
            let st = state();
            let before = snapshot(&st);
            let err = import_settings_text(&st, bad).expect_err("not a settings file");
            assert!(err.starts_with("invalid settings file"), "{bad}: {err}");
            assert_eq!(snapshot(&st), before, "{bad} must change nothing");
        }

        let mut doc = settings_doc();
        doc.as_object_mut().unwrap().remove("schemaVersion");
        let standalone = state();
        let before = snapshot(&standalone);
        let err = import_settings_text(&standalone, &doc_text(&doc)).expect_err("no schemaVersion");
        assert!(err.contains("schemaVersion"), "got: {err}");
        assert_eq!(snapshot(&standalone), before, "nothing may be stored");
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
