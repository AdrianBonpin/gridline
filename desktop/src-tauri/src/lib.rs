// Infrastructure modules: types, introspection, and DB viewer commands are built ahead
// of runtime usage, producing expected dead_code/unused warnings during development.
#![allow(dead_code)]

mod cancel;
mod commands;
mod db;
mod file_grant;
mod job;
mod keychain_acl;
mod models;
mod session_credential;
mod store;

use commands::ssh::{Ssh2Backend, SshTunnelManager};
use db::pool::ConnectionPoolManager;
use std::sync::{Arc, Mutex as StdMutex};
use store::Store;
use tauri::{Emitter, Manager};

pub struct AppState {
    /// Shared so SSH host trust (ADR 0001) can read and write enrollments
    /// through the same connection as every other command.
    pub db_store: Arc<StdMutex<Store>>,
    pub pool_manager: tokio::sync::Mutex<ConnectionPoolManager>,
    pub ssh_manager: StdMutex<SshTunnelManager>,
    pub cancel_registry: crate::cancel::CancelRegistry,
    /// Process-lifetime ownership of running tool jobs (backup / restore /
    /// sync). Shared so a cancel command and the app-exit hook can reach a job
    /// that is running on another thread.
    pub jobs: Arc<crate::job::JobRegistry>,
    /// Backend-issued File Grants. The only authorization a file-touching
    /// command accepts; a renderer-supplied path authorizes nothing.
    pub file_grants: Arc<crate::file_grant::FileGrantStore>,
    /// Memory-only credentials for connections whose keychain persistence is
    /// off, keyed by the saved connection (the Change Origin). Tool jobs that
    /// cannot reach the OS keychain authenticate from here; a missing entry
    /// prompts instead of running with an empty password.
    pub session_credentials: Arc<crate::session_credential::SessionCredentialStore>,
}

use commands::{
    backup, connections, credentials, db_viewer, demo, folders, import_export, import_file,
    keychain, maintenance, objects, query, query_export, schema_diff, schema_graph, settings, ssh,
    tags,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the ring crypto provider so rustls `ClientConfig::builder()` works (no-op if
    // another provider is already installed).
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keyring_store::init())
        // OS "open with" paths are queued here before the webview exists.
        .manage(crate::commands::open_files::PendingOpenFiles::default());

    // Shadowed, not `mut`: on macOS this cfg block is compiled out, so a
    // mutable binding would only earn an `unused_mut` warning. The plugin
    // itself stays a Windows/Linux-only, target-scoped dependency.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let pending = app.state::<crate::commands::open_files::PendingOpenFiles>();
        let mut accepted = false;
        for arg in argv.iter().skip(1) {
            if crate::commands::open_files::accept_path(&pending, arg) {
                accepted = true;
            }
        }
        if accepted {
            let _ = app.emit("sql-file-opened", ());
        }
    }));

    builder
        .setup(move |app| {
            // Open the local store under the OS app-data directory. When the
            // app is launched from Finder/LaunchServices the working directory
            // is `/`, so a relative "gridline.db" path panics ("failed to
            // open db", exit 101) before the UI ever starts. The demo DB uses
            // the same directory (see commands/demo.rs).
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("failed to create app data dir: {e}"))?;
            let store = Arc::new(StdMutex::new(
                Store::open(&data_dir.join("gridline.db").to_string_lossy())
                    .expect("failed to open db"),
            ));
            // SSH host trust: system known-hosts files plus the enrollments this
            // user accepted (non-secret metadata in the same local store).
            let ssh_trust = Arc::new(commands::ssh_trust::StoreHostTrust::new(store.clone()));

            // Cold-start "open with": the path arrived as a process argument
            // before the webview existed, so queue it here. macOS uses
            // RunEvent::Opened instead. `args_os`, never `args`: a Unix argv
            // element is arbitrary bytes, and `args()` panics on a non-UTF-8
            // one — before the UI exists, so the app would never start.
            let pending_files = app.state::<crate::commands::open_files::PendingOpenFiles>();
            let _ = crate::commands::open_files::accept_process_args(
                &pending_files,
                std::env::args_os().skip(1),
            );

            app.manage(AppState {
                db_store: store.clone(),
                pool_manager: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
                ssh_manager: StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend::new(
                    ssh_trust,
                )))),
                cancel_registry: crate::cancel::CancelRegistry::default(),
                jobs: Arc::new(crate::job::JobRegistry::new()),
                file_grants: Arc::new(crate::file_grant::FileGrantStore::new()),
                session_credentials: Arc::new(
                    crate::session_credential::SessionCredentialStore::new(),
                ),
            });

            let state = app.state::<AppState>();
            demo::ensure_demo_db(app.handle(), &state.db_store)
                .map_err(|e| {
                    eprintln!("Failed to set up demo DB: {e}");
                })
                .ok();

            // Close the SSH tunnel for a connection when its pool is evicted
            // (LRU overflow or max-pool shrink). The hook captures a clone of
            // the app handle and resolves AppState through the manager.
            let handle = app.handle().clone();
            state
                .pool_manager
                .blocking_lock()
                .set_on_evict(Box::new(move |id: &str| {
                    if let Some(s) = handle.try_state::<AppState>() {
                        if let Ok(mut mgr) = s.ssh_manager.lock() {
                            mgr.close_tunnel(id);
                        }
                        // Drop the cancel handles for the evicted connection
                        // (tokens/interrupts outlive the pool otherwise).
                        s.cancel_registry.remove(id);
                    }
                }));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connections::get_connections,
            connections::create_connection,
            connections::update_connection,
            connections::delete_connection,
            connections::add_connection_tags,
            connections::set_connection_favorite,
            connections::record_recent_connection,
            connections::get_recent_connections,
            connections::clear_recent_connections,
            folders::get_folders,
            folders::create_folder,
            folders::delete_folder,
            folders::update_folder,
            folders::add_folder_tags,
            tags::get_tags,
            tags::create_tag,
            tags::delete_tag,
            tags::update_tag,
            settings::get_settings,
            settings::update_setting,
            import_export::import_connections,
            import_export::export_connections,
            commands::test_connection::test_connection,
            commands::test_connection::create_sqlite_database,
            db_viewer::db_connect,
            db_viewer::db_disconnect,
            db_viewer::get_databases,
            db_viewer::get_schemas,
            db_viewer::get_tables,
            db_viewer::get_table_data,
            db_viewer::get_table_columns,
            db_viewer::get_fk_preview,
            db_viewer::search_fk_options,
            db_viewer::execute_change,
            db_viewer::get_table_ddl,
            db_viewer::refresh_connection,
            db_viewer::get_functions,
            db_viewer::get_triggers,
            db_viewer::get_sequences,
            db_viewer::get_enums,
            db_viewer::get_extensions,
            db_viewer::get_indexes,
            db_viewer::get_constraints,
            db_viewer::get_hypertables,
            objects::create_schema,
            objects::rename_schema,
            objects::drop_schema,
            objects::search_objects,
            objects::get_object_ddl,
            objects::get_object_dependencies,
            objects::build_object_ddl,
            objects::build_rebuild_script,
            objects::get_available_extensions,
            objects::get_roles,
            objects::get_role_privileges,
            objects::get_table_rebuild_readiness,
            objects::get_tablespaces,
            maintenance::run_maintenance,
            keychain::save_connection_password,
            keychain::get_connection_password,
            keychain::delete_connection_password,
            credentials::store_session_credential,
            credentials::forget_session_credential,
            ssh::ssh_host_trust_state,
            ssh::ssh_host_trust_enroll,
            ssh::ssh_host_trust_reenroll,
            keychain::save_connection_ssh_password,
            keychain::get_connection_ssh_password,
            keychain::delete_connection_ssh_password,
            keychain::save_connection_ssh_passphrase,
            keychain::get_connection_ssh_passphrase,
            keychain::delete_connection_ssh_passphrase,
            demo::recreate_demo_db,
            demo::regenerate_demo_db,
            commands::file_grant::select_file_for_grant,
            backup::detect_pg_tools,
            backup::pg_dump,
            backup::pg_restore,
            backup::db_sync,
            backup::cancel_tool_job,
            backup::detect_mysql_tools,
            backup::mysql_dump,
            backup::mysql_restore,
            backup::mysql_sync,
            backup::sqlite_dump,
            backup::sqlite_restore,
            backup::sqlite_sync,
            settings::export_settings,
            settings::import_settings,
            schema_graph::get_schema_graph,
            schema_diff::compare_schemas,
            query::execute_query,
            query::execute_query_multi,
            query_export::export_query_to_file,
            import_file::read_import_file,
            query::cancel_query,
            crate::commands::open_files::take_pending_sql_files,
            query::get_query_history,
            query::clear_query_history,
            query::set_history_favorite,
            query::save_query,
            query::get_saved_queries,
            query::update_saved_query,
            query::delete_saved_query,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // macOS: Finder / LaunchServices "open with". File URLs only.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let pending = app_handle.state::<crate::commands::open_files::PendingOpenFiles>();
                let mut accepted = false;
                for url in urls {
                    // The file URL carries an OS path, not necessarily valid
                    // UTF-8: hand the path itself to validation instead of a
                    // lossy string that could name a different file.
                    if let Ok(path) = url.to_file_path() {
                        if crate::commands::open_files::accept_os_path(&pending, &path) {
                            accepted = true;
                        }
                    }
                }
                if accepted {
                    let _ = app_handle.emit("sql-file-opened", ());
                }
            }
            // Close all SSH tunnels and terminate every running tool job on
            // exit: ExitRequested fires before the event loop ends, Exit fires
            // after it has. A cancelled job's whole child tree is terminated,
            // so quitting cannot leave a pg_dump/pg_restore/mysqldump behind.
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                if let Ok(mut mgr) = app_handle.state::<AppState>().ssh_manager.lock() {
                    mgr.close_all();
                }
                app_handle.state::<AppState>().jobs.cancel_all();
            }
            _ => {}
        });
}
