use rusqlite::{types::ValueRef, Connection};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::tool_resolver::{self, ToolRequest, ToolResolution};
use crate::job::{self, JobControl, JobError};
use crate::models::backup::*;

// ---------------------------------------------------------------------------
// Connection params (decoupled from store/keychain so logic is headless-testable)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PgConnParams {
    pub host: String,
    pub port: i64,
    pub username: String,
    pub database: String,
    pub password: String,
    /// The connection's stored TLS settings. Carried here so the external client
    /// tools enforce the same decision the app's own driver does; the CLI tools
    /// otherwise default to libpq's `prefer` and would dump over plaintext for a
    /// `verify-full` connection.
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    /// The SSH tunnel endpoint the tools must dial, when the server is only
    /// reachable through one.
    ///
    /// `host`/`port` stay the *saved* values and keep naming the server for
    /// authentication and certificate verification; the tunnel only replaces the
    /// address that gets dialed (libpq's `PGHOSTADDR`, the same split the app's
    /// own driver makes in [`crate::db::tls::PgConnectPlan`]). Handing the
    /// tunnel's `127.0.0.1` to `--host` instead would make a `verify-*`
    /// connection authenticate the certificate against loopback and fail — or,
    /// worse, tempt a downgrade to `prefer`.
    pub tunnel: Option<(std::net::IpAddr, u16)>,
}

impl PgConnParams {
    pub fn new(
        host: String,
        port: i64,
        username: String,
        database: String,
        password: String,
    ) -> Self {
        Self {
            host,
            port,
            username,
            database,
            password,
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            tunnel: None,
        }
    }

    /// Reach this connection through an SSH tunnel's loopback listener.
    ///
    /// `hostaddr` is the address actually dialed; `host` remains the server name
    /// that credentials and the certificate are checked against.
    pub fn through_tunnel(mut self, hostaddr: std::net::IpAddr, port: u16) -> Self {
        self.tunnel = Some((hostaddr, port));
        self
    }

    /// The port the tools must dial: the tunnel's listener when tunnelled, the
    /// saved port otherwise.
    pub fn dial_port(&self) -> i64 {
        match self.tunnel {
            Some((_, port)) => port as i64,
            None => self.port,
        }
    }

    /// Attach the saved connection's TLS configuration.
    pub fn with_tls(
        mut self,
        ssl_mode: Option<String>,
        ssl_ca_path: Option<String>,
        ssl_cert_path: Option<String>,
        ssl_key_path: Option<String>,
    ) -> Self {
        self.ssl_mode = ssl_mode;
        self.ssl_ca_path = ssl_ca_path;
        self.ssl_cert_path = ssl_cert_path;
        self.ssl_key_path = ssl_key_path;
        self
    }

    /// The libpq environment that makes `pg_dump`/`pg_restore`/`psql` enforce this
    /// connection's TLS decision.
    ///
    /// The mode is resolved exactly as the app's own connections resolve it
    /// (`db::tls::resolve_ssl_mode`): an explicit mode wins, a managed provider
    /// with no stored mode defaults to `require`, and an unrecognized non-empty
    /// mode is an **error** — it can never reach libpq as `prefer` (which dumps in
    /// plaintext when the server allows it) or as an accidental downgrade.
    ///
    /// Both Gridline verify modes map to libpq's `verify-full`: the app's driver
    /// checks the certificate chain *and* the hostname for `verify-ca` in v1 (see
    /// `db::tls`), so the tools must not be looser than browsing.
    ///
    /// With no mode configured the environment is left alone: libpq's own default
    /// (`prefer`) attempts TLS without insisting on it, so nothing the user chose
    /// is relaxed.
    pub fn tls_env(&self) -> Result<Vec<(String, String)>, String> {
        let Some(mode) = crate::db::tls::resolve_ssl_mode(&self.host, self.ssl_mode.as_deref())?
        else {
            return Ok(Vec::new());
        };

        let pgsslmode = match mode.as_str() {
            "disable" => "disable",
            "require" => "require",
            "verify-ca" | "verify-full" => "verify-full",
            other => {
                return Err(format!(
                    "unsupported TLS mode \"{other}\" for the PostgreSQL client tools; valid \
                     modes are: {}",
                    crate::db::tls::VALID_SSL_MODES.join(", ")
                ))
            }
        };

        let mut env = vec![("PGSSLMODE".to_string(), pgsslmode.to_string())];
        // Certificate material only matters when the connection speaks TLS at all.
        if pgsslmode != "disable" {
            if let Some(ca) = self.ssl_ca_path.as_deref().filter(|p| !p.trim().is_empty()) {
                env.push(("PGSSLROOTCERT".to_string(), ca.to_string()));
            }
            if let Some(cert) = self
                .ssl_cert_path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
            {
                env.push(("PGSSLCERT".to_string(), cert.to_string()));
            }
            if let Some(key) = self
                .ssl_key_path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
            {
                env.push(("PGSSLKEY".to_string(), key.to_string()));
            }
        }
        Ok(env)
    }

    /// The libpq variable that routes the TCP connection through a tunnel.
    ///
    /// libpq takes the address to dial from `hostaddr` and keeps using `host` for
    /// authentication and certificate verification, so a `verify-full` connection
    /// through a tunnel is verified against the server the user saved — never
    /// against `127.0.0.1`, and never silently relaxed to encryption-only. (The
    /// MySQL CLI cannot be told a separate verification name, which is why
    /// [`mysql_cli_tls_mode`] refuses a verify mode through a tunnel instead.)
    pub fn tunnel_env(&self) -> Vec<(String, String)> {
        match self.tunnel {
            Some((hostaddr, _)) => vec![("PGHOSTADDR".to_string(), hostaddr.to_string())],
            None => Vec::new(),
        }
    }

    /// Everything a client tool needs to reach this connection exactly as the
    /// app's own driver would: the TLS decision *and* the tunnel endpoint.
    ///
    /// One call so a spawn site cannot apply the mode and forget the routing (or
    /// the other way round). Fails closed on an unknown mode.
    pub(crate) fn apply_tool_env(&self, cmd: &mut Command) -> Result<(), String> {
        for (key, value) in self.tls_env()?.into_iter().chain(self.tunnel_env()) {
            cmd.env(key, value);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sanitize_error(s: &str) -> String {
    crate::commands::test_connection::sanitize_error(s)
}

/// The message a cancelled job reports. Shared by the managed (child-process)
/// and in-process engines so the command boundary can keep a cancellation
/// distinct from a tool failure.
pub const CANCEL_MESSAGE: &str = "Job cancelled";
/// The in-process MySQL restore reports a `KILL QUERY` cancellation with this
/// text (see `run_mysql_restore_on`).
pub const QUERY_CANCEL_MESSAGE: &str = "Query cancelled";

/// Why a tool job stopped, keeping cancellation distinguishable from a genuine
/// tool failure. The UI shows a cancelled job as *cancelled* (with a retry),
/// never as a failed restore.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobFailure {
    pub message: String,
    pub cancelled: bool,
}

impl JobFailure {
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            cancelled: false,
        }
    }

    /// Wrap an in-process engine error, recognising the cancellation sentinels
    /// those engines return when their cancellation flag flips.
    pub fn from_engine(message: String) -> Self {
        Self {
            cancelled: message == CANCEL_MESSAGE || message == QUERY_CANCEL_MESSAGE,
            message,
        }
    }
}

impl From<JobError> for JobFailure {
    fn from(e: JobError) -> Self {
        Self {
            cancelled: e.is_cancelled(),
            message: e.message(),
        }
    }
}

impl std::fmt::Display for JobFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// A cancellation check handed to the in-process engines.
pub type CancelCheck<'a> = &'a (dyn Fn() -> bool + Sync);

/// Consume the File Grant that authorizes a backup write and return the output
/// path.
///
/// This is the only way a path reaches a dump engine. A path the renderer
/// supplied is not a grant (see `GLOSSARY.md` → File Grant), so handing one in
/// here fails closed with the `file-grant-invalid` state instead of naming a
/// file for `pg_dump`/`mysqldump`/the SQLite dumper to write.
///
/// The grant is consumed on success, before any job is created: an invalid,
/// expired, replayed or wrong-intent grant starts nothing.
pub fn resolve_backup_output(
    grants: &crate::file_grant::FileGrantStore,
    grant_id: &str,
) -> Result<String, String> {
    crate::file_grant::consume_granted_path(grants, grant_id, crate::file_grant::FileIntent::Write)
}

/// Consume the File Grant that authorizes reading a restore input and return its
/// path.
///
/// Restore reads a file, so the grant has to carry the `Read` intent: a backup
/// write grant is refused here (and a restore grant is refused by
/// [`resolve_backup_output`]). A path the renderer supplied is not a grant, so
/// handing one in fails closed with the `file-grant-invalid` state instead of
/// naming a file for `pg_restore`/`psql`/the MySQL or SQLite restorers to read.
///
/// The grant is consumed on success, before any job is created: an invalid,
/// expired, replayed or wrong-intent grant starts nothing.
pub fn resolve_restore_input(
    grants: &crate::file_grant::FileGrantStore,
    grant_id: &str,
) -> Result<String, String> {
    crate::file_grant::consume_granted_path(grants, grant_id, crate::file_grant::FileIntent::Read)
}

/// Cancellation check that never fires, for headless/legacy callers.
fn never_cancel() -> bool {
    false
}

/// Tauri-facing one-shot resolution with the process-lifetime cache.
/// `force` bypasses the cache for an explicit user re-check.
fn resolve_request(app: &AppHandle, request: &ToolRequest, force: bool) -> ToolResolution {
    resolve_request_detailed(app, request, force).0
}

/// One detection pass, plus — when nothing resolved — the reason the last
/// candidate probe failed.
///
/// Every probe is bounded (`probe_outcome`), so a binary that hangs on
/// `--version` cannot block detection. That failure is reported rather than
/// silently looking like "not installed", so the UI can say the tool was found
/// but did not answer.
fn resolve_request_detailed(
    app: &AppHandle,
    request: &ToolRequest,
    force: bool,
) -> (ToolResolution, Option<String>) {
    let key = request.cache_key();
    if !force {
        if let Some(hit) = tool_resolver::cache_get(&key) {
            return (hit, None);
        }
    }

    let resource_dir = app.path().resource_dir().ok();
    let bundled = resource_dir
        .as_ref()
        .map(|rd| tool_resolver::bundled_tool_path(rd, request.subdir, request.bundled_name()));
    let trusted = tool_resolver::trusted_dirs();
    let start = std::time::Instant::now();
    let note: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
    let probe = |p: &std::path::Path| {
        if start.elapsed() >= tool_resolver::AGGREGATE_DEADLINE {
            return false;
        }
        match tool_resolver::probe_outcome(p, tool_resolver::PROBE_TIMEOUT) {
            Ok(ok) => ok,
            Err(e) => {
                if note.borrow().is_none() {
                    *note.borrow_mut() = Some(format!("{} — {}", p.display(), e.message()));
                }
                false
            }
        }
    };
    let resolved = tool_resolver::resolve_with(
        request,
        &trusted,
        &tool_resolver::path_lookup,
        bundled.as_deref(),
        probe,
    );
    let probe_error = note.into_inner();
    let version = resolved
        .as_ref()
        .and_then(|r| tool_resolver::version_of(&r.program));
    let bundled_available = bundled
        .as_deref()
        .map(tool_resolver::bundled_present)
        .unwrap_or(false);

    let out = ToolResolution {
        resolved,
        bundled_path: bundled,
        bundled_available,
        version,
    };
    // Only a success is cached: a miss has to be re-probed so its reason is
    // reported again instead of being frozen as a silent "not found".
    if out.resolved.is_some() {
        tool_resolver::cache_put(&key, out.clone());
    }
    (out, probe_error)
}

/// System-first, bundled-fallback resolver. Returns (command_to_invoke, source).
pub fn resolve_tool(app: &AppHandle, tool: &str) -> (String, Option<String>) {
    match tool_resolver::pg_request(tool) {
        Some(request) => {
            tool_resolver::adapt_resolution(&resolve_request(app, &request, false), tool)
        }
        None => (tool.to_string(), None),
    }
}

pub fn resolve_tool_paths(app: &AppHandle) -> PgToolPaths {
    PgToolPaths {
        pg_dump: resolve_tool(app, "pg_dump").0,
        pg_restore: resolve_tool(app, "pg_restore").0,
        psql: resolve_tool(app, "psql").0,
    }
}

// ---------------------------------------------------------------------------
// detect_pg_tools
// ---------------------------------------------------------------------------

/// Shapes both PG statuses from resolved tools. Headless so the Tauri command
/// stays thin and the shaping logic stays unit-testable.
fn build_pg_tool_status(dump: &ToolResolution, restore: &ToolResolution) -> PgToolStatus {
    build_pg_tool_status_with(dump, restore, None, None)
}

fn build_pg_tool_status_with(
    dump: &ToolResolution,
    restore: &ToolResolution,
    dump_probe_error: Option<String>,
    restore_probe_error: Option<String>,
) -> PgToolStatus {
    PgToolStatus {
        pg_dump_found: dump.resolved.is_some(),
        pg_restore_found: restore.resolved.is_some(),
        pg_dump_version: dump.version.clone(),
        pg_restore_version: restore.version.clone(),
        pg_dump_source: dump
            .resolved
            .as_ref()
            .map(|r| r.source.as_str().to_string()),
        pg_restore_source: restore
            .resolved
            .as_ref()
            .map(|r| r.source.as_str().to_string()),
        pg_dump_resolved_name: dump.resolved.as_ref().map(|r| r.name.clone()),
        pg_restore_resolved_name: restore.resolved.as_ref().map(|r| r.name.clone()),
        pg_dump_bundled_available: dump.bundled_available,
        pg_restore_bundled_available: restore.bundled_available,
        // A probe failure is only worth reporting when it explains a miss.
        pg_dump_probe_error: if dump.resolved.is_none() {
            dump_probe_error
        } else {
            None
        },
        pg_restore_probe_error: if restore.resolved.is_none() {
            restore_probe_error
        } else {
            None
        },
    }
}

/// Detection runs off the UI thread and can be forced past the cache.
#[tauri::command]
pub async fn detect_pg_tools(force: Option<bool>, app_handle: AppHandle) -> PgToolStatus {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let (dump, dump_note) =
            resolve_request_detailed(&app_handle, &tool_resolver::pg_dump_request(), force);
        let (restore, restore_note) =
            resolve_request_detailed(&app_handle, &tool_resolver::pg_restore_request(), force);
        build_pg_tool_status_with(&dump, &restore, dump_note, restore_note)
    })
    .await
    .unwrap_or_else(|_| build_pg_tool_status(&ToolResolution::none(), &ToolResolution::none()))
}

// ---------------------------------------------------------------------------
// Core logic (headless-testable — no Tauri, no store, no keychain)
// ---------------------------------------------------------------------------

/// Builds the base connection args shared by pg_dump, pg_restore, psql and the
/// DDL copy.
///
/// `--host` is always the saved server name (`PGHOSTADDR` carries a tunnel's
/// loopback endpoint, see [`PgConnParams::tunnel_env`]); only the port follows
/// the endpoint that is actually dialed.
pub(crate) fn base_conn_args(conn: &PgConnParams) -> Vec<String> {
    vec![
        format!("--host={}", conn.host),
        format!("--port={}", conn.dial_port()),
        format!("--username={}", conn.username),
        format!("--dbname={}", conn.database),
    ]
}

/// Builds pg_dump args (excluding the --file flag, which is added by the caller).
fn build_dump_args(conn: &PgConnParams, options: &BackupOptions) -> Vec<String> {
    let mut args = base_conn_args(conn);

    match options.format.as_str() {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {} // "plain" is the default — no format flag needed
    }

    if options.no_owner {
        args.push("--no-owner".into());
    }

    if let Some(ref schema) = options.schema {
        args.push(format!("--schema={schema}"));
    }

    if let Some(ref tables) = options.tables {
        for t in tables {
            args.push(format!("--table={t}"));
        }
    }

    args
}

/// How a PostgreSQL restore runs against the target.
///
/// This is the difference between "a failure left the target untouched" and "a
/// failure left it partially restored", so it is decided explicitly (see
/// [`pg_restore_txn`]) instead of being inferred at the call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PgRestoreTxn {
    /// The whole restore is one transaction: any failing statement rolls the
    /// target back to exactly what it was before the run.
    OneTransaction,
    /// Statement by statement, so whatever succeeded before a failure stays
    /// applied. Only ever chosen after the user accepted that risk.
    PerStatement,
}

impl PgRestoreTxn {
    pub fn is_atomic(&self) -> bool {
        matches!(self, PgRestoreTxn::OneTransaction)
    }
}

/// psql args for a plain-format restore.
///
/// `ON_ERROR_STOP=1` is what makes a failing statement abort the run (psql then
/// exits 3) instead of continuing to the next one; `--no-psqlrc` stops a user's
/// startup file from changing that behind our back. `--single-transaction`
/// wraps the whole script in one transaction, so a failure rolls the target
/// back — but it can only be used when the script is compatible with running
/// inside a transaction (see [`pg_restore_txn`]).
pub fn build_psql_restore_args(
    conn: &PgConnParams,
    file_path: &str,
    txn: PgRestoreTxn,
) -> Vec<String> {
    let mut args = vec![
        "--no-psqlrc".to_string(),
        "-v".to_string(),
        "ON_ERROR_STOP=1".to_string(),
    ];
    if txn.is_atomic() {
        args.push("--single-transaction".to_string());
    }
    args.extend(base_conn_args(conn));
    args.push(format!("--file={file_path}"));
    args
}

/// pg_restore args for a DB-to-DB sync. Sync requires the destructive-overwrite
/// confirmation in the UI. The source is our own `pg_dump` custom archive, which
/// is always transaction-shaped, so the restore runs as one transaction: a
/// failure (or a truncated archive when the dump dies) rolls the target back
/// instead of leaving it partially replaced. `--exit-on-error` makes a partial
/// sync report failure instead of a silent success.
pub fn build_pg_sync_restore_args(target: &PgConnParams) -> Vec<String> {
    let mut args = base_conn_args(target);
    args.push("--no-owner".into());
    args.push("--clean".into());
    args.push("--if-exists".into());
    args.push("--single-transaction".into());
    args.push("--exit-on-error".into());
    args
}

/// Builds pg_restore args (file path is passed positionally by the caller).
fn build_restore_args(
    conn: &PgConnParams,
    options: &RestoreOptions,
    txn: PgRestoreTxn,
) -> Vec<String> {
    let mut args = base_conn_args(conn);

    match options.format.as_str() {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {}
    }

    if options.clean {
        args.push("--clean".into());
        args.push("--if-exists".into());
    }

    // One transaction for the whole archive when the dump allows it; a
    // statement failure then rolls back everything the run had applied.
    if txn.is_atomic() {
        args.push("--single-transaction".into());
    }

    // Stop at the first failed object instead of continuing (the default).
    args.push("--exit-on-error".into());

    if let Some(ref schema) = options.schema {
        args.push(format!("--schema={schema}"));
    }

    args
}

/// Runs `pg_dump` against `conn` under `job`, writing to `options.file_path`.
///
/// The dump's own output (file length, or the sum of a directory-format dump's
/// entries) is the progress signal, so a large backup that keeps writing is
/// never killed for taking a long time, while one that stops producing output
/// for the idle window is treated as hung. Cancellation terminates the whole
/// child tree.
pub fn run_pg_dump_managed(
    job: &JobControl,
    conn: &PgConnParams,
    options: &BackupOptions,
    tools: &PgToolPaths,
) -> Result<(), JobFailure> {
    let mut args = build_dump_args(conn, options);
    args.push(format!("--file={}", options.file_path));

    let mut cmd = Command::new(&tools.pg_dump);
    cmd.env("PGPASSWORD", &conn.password).args(&args);
    // The CLI must not be looser than the app's own driver: without this a
    // `verify-full` connection dumps over libpq's `prefer`.
    conn.apply_tool_env(&mut cmd).map_err(JobFailure::failed)?;

    let activity = job::path_size_probe(&options.file_path);
    let out = job::run_managed(job, cmd, Some(activity)).map_err(JobFailure::from)?;

    if out.status.success() {
        Ok(())
    } else {
        Err(JobFailure::failed(sanitize_error(&out.stderr)))
    }
}

/// Headless one-shot form of [`run_pg_dump_managed`] (no registry, never
/// cancelled) — the entry point the live integration tests use.
pub fn run_pg_dump(
    conn: &PgConnParams,
    options: &BackupOptions,
    tools: &PgToolPaths,
) -> Result<(), String> {
    run_pg_dump_managed(&JobControl::detached(), conn, options, tools).map_err(|e| e.message)
}

/// Runs `pg_restore` (or `psql`) against `conn` under `job`, reading from
/// `options.file_path`.
///
/// Plain-format dumps are SQL text and cannot be read by `pg_restore` — they
/// are executed with `psql` instead. The `clean` option is only honored for
/// archive formats (custom/tar/directory); the UI disables it for plain.
///
/// `txn` decides whether the run is one transaction (a failure leaves the target
/// unchanged) or statement-by-statement (a failure leaves earlier objects
/// applied). It is never guessed here: [`pg_restore_txn`] derives it from the
/// dump and refuses a non-atomic run the user did not accept.
///
/// No **idle output** bound applies here: a restore can sit in one large `COPY`
/// without printing anything, and that is indistinguishable from a
/// quiet-but-healthy run. The job stays cancellable and is terminated on app exit,
/// but it is never killed merely for being slow.
///
/// The one wait that has no end of its own — a lock held by another session — is
/// bounded from outside instead, by the lock watchdog in
/// [`crate::db::restore_watch`] (see
/// [`crate::commands::backup::watch_restore_lock_wait`]). It needs to recognize
/// this child's backend, so the child connects with a per-job
/// `application_name`.
pub fn run_pg_restore_managed(
    job: &JobControl,
    conn: &PgConnParams,
    options: &RestoreOptions,
    txn: PgRestoreTxn,
    tools: &PgToolPaths,
) -> Result<(), JobFailure> {
    let app_name = crate::db::restore_watch::restore_application_name(job.id());
    let mut cmd = if options.format == "plain" {
        let mut cmd = Command::new(&tools.psql);
        cmd.env("PGPASSWORD", &conn.password)
            .env("PGAPPNAME", &app_name)
            .args(build_psql_restore_args(conn, &options.file_path, txn));
        cmd
    } else {
        let mut args = build_restore_args(conn, options, txn);
        args.push(options.file_path.clone());
        let mut cmd = Command::new(&tools.pg_restore);
        cmd.env("PGPASSWORD", &conn.password)
            .env("PGAPPNAME", &app_name)
            .args(&args);
        cmd
    };
    // Restoring into a TLS-verifying target must verify TLS: no `prefer` fallback.
    conn.apply_tool_env(&mut cmd).map_err(JobFailure::failed)?;

    let out = job::run_managed(job, cmd, None).map_err(JobFailure::from)?;
    if out.status.success() {
        Ok(())
    } else if let Some(reason) = job.stop_reason() {
        // A watchdog stopped this job; the tool's own message would only describe
        // the symptom ("terminating connection due to administrator command").
        Err(JobFailure::failed(reason))
    } else {
        Err(JobFailure::failed(pg_restore_failure_message(
            txn,
            &out.stderr,
        )))
    }
}

/// Watch a running PostgreSQL restore and terminate its backend once it has been
/// **continuously** waiting on a lock for
/// [`crate::db::restore_watch::DEFAULT_LOCK_WAIT_DEADLINE`].
///
/// This is the restore's lock bound: see [`crate::db::restore_watch`] for why a
/// server-side `lock_timeout` cannot be used (a dump resets it) and why the idle
/// bound cannot either (a large `COPY` is silent but healthy). Sampling uses the
/// connection's pooled session — the same TLS/SSH-correct client the rest of the
/// app uses, and the one whose user owns the restore backend.
///
/// The loop can only ever stop a restore it *positively* observed waiting on a
/// lock: a sample it cannot take is blind, and blindness is never treated as a
/// stall. It returns as soon as the job is finished (or was cancelled) so it never
/// outlives the restore.
async fn watch_restore_lock_wait(
    app_handle: AppHandle,
    jobs: std::sync::Arc<crate::job::JobRegistry>,
    job_id: String,
    connection_id: String,
) {
    use crate::db::restore_watch::{
        lock_wait_stop_message, restore_application_name, LockWatch, WatchDecision,
        DEFAULT_LOCK_WAIT_DEADLINE, RESTORE_BACKEND_SQL, SAMPLE_INTERVAL, TERMINATE_BACKEND_SQL,
    };

    let app_name = restore_application_name(&job_id);
    let mut watch = LockWatch::new(DEFAULT_LOCK_WAIT_DEADLINE);

    loop {
        if jobs.get(&job_id).is_none() {
            return; // finished (or never started): nothing left to watch
        }
        tokio::time::sleep(SAMPLE_INTERVAL).await;
        let state = app_handle.state::<crate::AppState>();
        let sample = sample_restore_backend(
            &state.pool_manager,
            &connection_id,
            &app_name,
            RESTORE_BACKEND_SQL,
        )
        .await;
        match watch.observe(std::time::Instant::now(), sample) {
            WatchDecision::Continue => {}
            WatchDecision::Stop { pid, waited } => {
                // Record the reason BEFORE terminating: the restore's error is
                // mapped as soon as its process exits, and it must already know
                // why it stopped.
                if let Some(job) = jobs.get(&job_id) {
                    job.note_stop_reason(lock_wait_stop_message(waited));
                }
                terminate_restore_backend(
                    &state.pool_manager,
                    &connection_id,
                    pid,
                    TERMINATE_BACKEND_SQL,
                )
                .await;
                return;
            }
        }
    }
}

/// One `pg_stat_activity` sample of the restore's backend (see [`LockSample`]).
async fn sample_restore_backend(
    pool: &tokio::sync::Mutex<crate::db::pool::ConnectionPoolManager>,
    connection_id: &str,
    app_name: &str,
    sql: &str,
) -> crate::db::restore_watch::LockSample {
    use crate::db::pool::{acquire_handle, DbHandle};
    use crate::db::restore_watch::LockSample;

    let Ok(DbHandle::Postgresql(client, _)) = acquire_handle(pool, connection_id).await else {
        return LockSample::NotSeen;
    };
    let client = client.lock().await;
    let Ok(rows) = client.query(sql, &[&app_name]).await else {
        return LockSample::NotSeen;
    };
    let Some(row) = rows.first() else {
        return LockSample::NotSeen;
    };
    let pid: i32 = row.get("pid");
    let waiting: bool = row.get("waiting_on_lock");
    if waiting {
        LockSample::WaitingForLock { pid }
    } else {
        LockSample::Running { pid }
    }
}

/// Terminate the restore backend a watchdog stopped (best effort: the process may
/// already be gone, which is not an error).
async fn terminate_restore_backend(
    pool: &tokio::sync::Mutex<crate::db::pool::ConnectionPoolManager>,
    connection_id: &str,
    pid: i32,
    sql: &str,
) {
    use crate::db::pool::{acquire_handle, DbHandle};

    let Ok(DbHandle::Postgresql(client, _)) = acquire_handle(pool, connection_id).await else {
        return;
    };
    let client = client.lock().await;
    let _ = client.query(sql, &[&pid]).await;
}

/// Headless one-shot form of [`run_pg_restore_managed`].
///
/// Transactional whenever the dump allows it. A dump that cannot be restored
/// atomically is refused here — a headless caller has no way to accept the
/// partial-application risk, so it must not be silently downgraded.
pub fn run_pg_restore(
    conn: &PgConnParams,
    options: &RestoreOptions,
    tools: &PgToolPaths,
) -> Result<(), String> {
    let txn = pg_restore_txn(&options.format, &options.file_path, false)?;
    run_pg_restore_managed(&JobControl::detached(), conn, options, txn, tools)
        .map_err(|e| e.message)
}

// ---------------------------------------------------------------------------
// Transactional restore: is this dump compatible with one transaction?
// ---------------------------------------------------------------------------

/// Stable IPC code in front of the refusal for a dump that cannot be restored in
/// one transaction. The renderer turns it into an explicit risk confirmation
/// instead of matching on human text.
pub const PG_RESTORE_NON_ATOMIC_CODE: &str = "pg-restore-non-atomic";

/// Whether PostgreSQL can apply a dump as one transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PgRestoreAtomicity {
    /// The whole dump can run in one transaction: a failing statement rolls the
    /// target back.
    Atomic,
    /// It cannot. `reason` names what makes it impossible and what a failure
    /// would leave behind; it is shown to the user before they accept the risk.
    NonAtomic { reason: String },
}

impl PgRestoreAtomicity {
    pub fn reason(&self) -> Option<&str> {
        match self {
            PgRestoreAtomicity::Atomic => None,
            PgRestoreAtomicity::NonAtomic { reason } => Some(reason),
        }
    }
}

/// One statement found in a plain SQL dump that PostgreSQL refuses to run inside
/// a transaction block, or that would end the transaction the restore opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlainDumpHazard {
    /// What was found, e.g. `VACUUM` or `\connect`.
    pub found: String,
    /// 1-based line number in the dump.
    pub line: usize,
}

/// Whether `file_path` can be restored in one transaction, or why not.
///
/// Archive formats (custom/tar/directory) are accepted as transaction-shaped:
/// `pg_restore --single-transaction` only refuses to run alongside `--jobs`, and
/// a non-transactional entry inside an archive is caught at execution time (the
/// run then rolls back). A plain script is inspected first because psql has to
/// own its transaction: a script containing `VACUUM`, `CREATE DATABASE`, `CREATE
/// INDEX CONCURRENTLY`, psql's `\connect`, or its own `BEGIN`/`COMMIT` cannot be
/// wrapped in one.
///
/// The scan is a best-effort lexical pass (comments, `COPY` data rows and
/// dollar-quoted bodies are skipped), so an incompatibility it misses still
/// surfaces at execution time — as a rollback plus an explanation, never as a
/// partial apply.
pub fn pg_restore_atomicity(format: &str, file_path: &str) -> Result<PgRestoreAtomicity, String> {
    if format == "plain" {
        let hazards = scan_plain_dump(file_path)?;
        if !hazards.is_empty() {
            return Ok(PgRestoreAtomicity::NonAtomic {
                reason: describe_hazards(&hazards),
            });
        }
    }
    Ok(PgRestoreAtomicity::Atomic)
}

/// The transaction mode a restore must run with.
///
/// A dump that cannot be atomic is **refused** unless the caller passes
/// `accept_non_atomic`: a silent downgrade to a statement-by-statement run is
/// exactly the bug this guards against (the user would find out by discovering a
/// half-restored database).
pub fn pg_restore_txn(
    format: &str,
    file_path: &str,
    accept_non_atomic: bool,
) -> Result<PgRestoreTxn, String> {
    match pg_restore_atomicity(format, file_path)? {
        PgRestoreAtomicity::Atomic => Ok(PgRestoreTxn::OneTransaction),
        PgRestoreAtomicity::NonAtomic { reason } => {
            if accept_non_atomic {
                Ok(PgRestoreTxn::PerStatement)
            } else {
                Err(non_atomic_refusal(&reason))
            }
        }
    }
}

/// The refusal for a dump the caller did not allow to run non-atomically.
fn non_atomic_refusal(reason: &str) -> String {
    format!(
        "{PG_RESTORE_NON_ATOMIC_CODE}: {reason} It can only be restored one statement at a time, so a failure partway through is not rolled back and can leave the target partially applied. Accept that risk to run it anyway."
    )
}

/// Name what makes a plain script incompatible with one transaction, and the
/// risk of running it anyway.
fn describe_hazards(hazards: &[PlainDumpHazard]) -> String {
    const SHOWN: usize = 4;
    let mut parts: Vec<String> = hazards
        .iter()
        .take(SHOWN)
        .map(|h| format!("{} (line {})", h.found, h.line))
        .collect();
    if hazards.len() > SHOWN {
        parts.push(format!("and {} more", hazards.len() - SHOWN));
    }
    format!(
        "This SQL script contains statements PostgreSQL cannot run inside a single transaction: {}. Restoring it as one transaction is impossible, so a failure partway through can leave the target partially applied.",
        parts.join(", ")
    )
}

/// Lexical state carried across lines while scanning a plain dump.
#[derive(Default)]
struct PlainScanState {
    in_block_comment: bool,
    /// The dollar-quote tag (`$$` or `$body$`) whose body is still open.
    dollar_tag: Option<String>,
    /// Inside a `COPY … FROM stdin` data block, where every line is payload.
    in_copy_data: bool,
}

/// Read a plain dump and collect every statement that breaks a single-transaction
/// restore. Bounded: one line at a time, nothing but the line buffer is held.
fn scan_plain_dump(path: &str) -> Result<Vec<PlainDumpHazard>, String> {
    use std::io::BufRead;

    let file = std::fs::File::open(path).map_err(|e| {
        format!(
            "Could not read the backup file to check whether it can be restored atomically: {e}"
        )
    })?;
    let mut reader = std::io::BufReader::new(file);
    let mut state = PlainScanState::default();
    let mut hazards = Vec::new();
    let mut buf = Vec::new();
    let mut line_no = 0usize;
    // A statement spans lines, so a line is only a statement when nothing is
    // open. pg_dump writes a sequence's start value on its own line
    // (`CREATE SEQUENCE s` / `    START WITH 100` / `    INCREMENT BY 1;`), and
    // judging continuation lines as statements reported every such dump as
    // non-atomic. The hazard set itself is unchanged — this only decides which
    // lines may be one.
    let mut statement_open = false;

    loop {
        buf.clear();
        let read = reader.read_until(b'\n', &mut buf).map_err(|e| {
            format!(
                "Could not read the backup file to check whether it can be restored atomically: {e}"
            )
        })?;
        if read == 0 {
            break;
        }
        line_no += 1;
        // A dump's encoding is the database's, not necessarily UTF-8. Lossy
        // decoding only has to preserve the ASCII prefixes matched below.
        let text = String::from_utf8_lossy(&buf);
        let trimmed = text.trim();

        if state.in_copy_data {
            if trimmed == "\\." {
                state.in_copy_data = false;
            }
            continue;
        }

        let code = code_fragment(trimmed, &mut state);
        let code = code.trim();
        if code.is_empty() {
            continue;
        }

        // `COPY … FROM stdin;` starts a payload block; the data rows are values,
        // not statements, so a row that reads `VACUUM` is not a hazard.
        let upper = code.to_ascii_uppercase();
        if upper.starts_with("COPY ") || upper.starts_with("\\COPY ") {
            if upper.contains("FROM STDIN") {
                state.in_copy_data = true;
                continue;
            }
        }

        if !statement_open {
            if let Some(found) = line_hazard(code) {
                hazards.push(PlainDumpHazard {
                    found,
                    line: line_no,
                });
            }
        }

        // `;` terminates a statement; a psql meta-command is complete on its own
        // (it takes no semicolon, so it would otherwise swallow the rest of the
        // script as its continuation).
        statement_open = if code.starts_with('\\') {
            false
        } else {
            !code.ends_with(';')
        };
    }

    Ok(hazards)
}

/// The executable part of one line: comments stripped and dollar-quoted bodies
/// skipped, with that state carried into the next line.
fn code_fragment<'a>(line: &'a str, state: &mut PlainScanState) -> &'a str {
    let mut rest = line;
    loop {
        if let Some(tag) = state.dollar_tag.clone() {
            match rest.find(&tag) {
                Some(at) => {
                    rest = &rest[at + tag.len()..];
                    state.dollar_tag = None;
                }
                None => return "",
            }
            continue;
        }
        if state.in_block_comment {
            match rest.find("*/") {
                Some(at) => {
                    rest = &rest[at + 2..];
                    state.in_block_comment = false;
                }
                None => return "",
            }
            continue;
        }

        // The token itself comes back, not just its position, so there is no
        // "found a position but could not identify the token" state to unwrap:
        // the earlier shape recovered the dollar opener from a second `find`
        // and had to `expect` the invariant that it was still the earliest one.
        // This runs on an untrusted dump file, so no input may reach a panic.
        let Some(token) = FragmentToken::earliest(rest) else {
            return rest;
        };
        match token {
            FragmentToken::LineComment(at) => return &rest[..at],
            FragmentToken::BlockComment(at) => {
                state.in_block_comment = true;
                rest = &rest[at + 2..];
            }
            FragmentToken::DollarOpener { at, tag } => {
                rest = &rest[at + tag.len()..];
                state.dollar_tag = Some(tag);
            }
        }
    }
}

/// The earliest token on a line that ends the executable code.
///
/// Carrying the payload with the position is what makes [`FragmentToken::earliest`]
/// total: a caller that only had the index would have to look the token up again
/// and handle "the lookup disagrees with the index" — a panic on a code path that
/// reads a user-supplied dump file.
#[derive(Debug, PartialEq, Eq)]
enum FragmentToken {
    /// `--`, which ends the code on this line.
    LineComment(usize),
    /// `/*`, which starts a block comment that carries into the next lines.
    BlockComment(usize),
    /// A dollar-quote opener (`$$` / `$tag$`) and the tag that closes it.
    DollarOpener { at: usize, tag: String },
}

impl FragmentToken {
    /// The earliest of the tokens that can start on `rest`, if any.
    fn earliest(rest: &str) -> Option<Self> {
        [
            rest.find("--").map(FragmentToken::LineComment),
            rest.find("/*").map(FragmentToken::BlockComment),
            find_dollar_opener(rest).map(|(at, tag)| FragmentToken::DollarOpener { at, tag }),
        ]
        .into_iter()
        .flatten()
        .min_by_key(FragmentToken::at)
    }

    /// The byte offset this token starts at.
    fn at(&self) -> usize {
        match self {
            FragmentToken::LineComment(at) | FragmentToken::BlockComment(at) => *at,
            FragmentToken::DollarOpener { at, .. } => *at,
        }
    }
}

/// Find the first `$tag$` dollar-quote opener on a line. `$1` (a parameter) is
/// not an opener because it has no closing `$`.
fn find_dollar_opener(s: &str) -> Option<(usize, String)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'$' {
                return Some((i, s[i..=j].to_string()));
            }
        }
        i += 1;
    }
    None
}

/// At most `n` leading SQL words, uppercased. Words are split on anything that
/// cannot appear in a keyword, so `BEGIN;` and `VACUUM(id)` are still recognized.
fn leading_words(code: &str, n: usize) -> Vec<String> {
    code.split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .take(n)
        .map(|w| w.to_ascii_uppercase())
        .collect()
}

/// What (if anything) about this line makes a single-transaction restore
/// impossible.
fn line_hazard(code: &str) -> Option<String> {
    // psql meta-commands: `\connect` moves to another database mid-script, which
    // a one-transaction run cannot do (and `\c` is its abbreviation).
    if let Some(rest) = code.strip_prefix('\\') {
        let command = rest.split_whitespace().next().unwrap_or("");
        if command == "connect" || command == "c" {
            return Some("\\connect".to_string());
        }
        return None;
    }

    let mut words = leading_words(code, 2).into_iter();
    let first = words.next().unwrap_or_default();
    let second = words.next().unwrap_or_default();
    let upper = code.to_ascii_uppercase();

    let hazard = match (first.as_str(), second.as_str()) {
        ("VACUUM", _) => Some("VACUUM".to_string()),
        ("CLUSTER", _) => Some("CLUSTER".to_string()),
        ("CREATE", "DATABASE") => Some("CREATE DATABASE".to_string()),
        ("DROP", "DATABASE") => Some("DROP DATABASE".to_string()),
        ("CREATE", "TABLESPACE") => Some("CREATE TABLESPACE".to_string()),
        ("DROP", "TABLESPACE") => Some("DROP TABLESPACE".to_string()),
        ("CREATE", "SUBSCRIPTION") => Some("CREATE SUBSCRIPTION".to_string()),
        ("ALTER", "SYSTEM") => Some("ALTER SYSTEM".to_string()),
        ("CREATE", "INDEX") if upper.contains("CONCURRENTLY") => {
            Some("CREATE INDEX CONCURRENTLY".to_string())
        }
        ("DROP", "INDEX") if upper.contains("CONCURRENTLY") => {
            Some("DROP INDEX CONCURRENTLY".to_string())
        }
        ("REINDEX", _) if upper.contains("CONCURRENTLY") => {
            Some("REINDEX CONCURRENTLY".to_string())
        }
        // The dump's own transaction control would end the transaction the
        // restore opened, so the "one transaction" guarantee would be a lie.
        ("BEGIN", _)
        | ("START", _)
        | ("COMMIT", _)
        | ("END", _)
        | ("ROLLBACK", _)
        | ("ABORT", _)
        | ("SAVEPOINT", _)
        | ("RELEASE", _) => Some(format!("{first} (the script manages its own transactions)")),
        _ => None,
    };

    hazard
}

/// What a failed PostgreSQL restore reports.
///
/// The user's most important fact after a failure is what the target looks like
/// now, so the message always states it: a transactional run rolled back (and a
/// failure that only surfaced at execution time names how to proceed), while an
/// accepted non-atomic run says which part survived.
pub fn pg_restore_failure_message(txn: PgRestoreTxn, stderr: &str) -> String {
    let detail = sanitize_error(stderr);
    let detail = if detail.trim().is_empty() {
        "The restore tool exited with an error and printed no diagnostic.".to_string()
    } else {
        detail
    };

    if txn.is_atomic() {
        if is_transaction_incompatibility(&detail) {
            format!(
                "{detail}\n\nThe restore ran in a single transaction, so the target database was left unchanged. This dump contains statements PostgreSQL cannot run inside a transaction, so restoring it at all means accepting that a failure can leave the target partially applied."
            )
        } else {
            format!(
                "{detail}\n\nThe restore ran in a single transaction, so the target database was left unchanged."
            )
        }
    } else {
        format!(
            "{detail}\n\nThis restore ran without a single transaction (the dump cannot be restored atomically), so objects restored before the failure were already applied."
        )
    }
}

/// A failure that only appears once the restore is running: the dump turned out
/// to contain statements that cannot be transactional.
fn is_transaction_incompatibility(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("inside a transaction block")
        || lower.contains("inside a transaction")
        || lower.contains("in a single transaction")
}

/// The failure a DB sync reports, or `None` when both ends succeeded.
///
/// The target's error is primary: when the restore rejects its input the dump's
/// pipe closes, so the source's broken-pipe diagnostic is a consequence and not
/// the cause the user has to act on. It is still reported, as secondary context.
pub fn db_sync_failure_message(
    source_ok: bool,
    source_stderr: &str,
    sink_ok: bool,
    sink_stderr: &str,
) -> Option<String> {
    if source_ok && sink_ok {
        return None;
    }

    if !sink_ok {
        let mut message = format!(
            "pg_restore failed: {}",
            pg_restore_failure_message(PgRestoreTxn::OneTransaction, sink_stderr)
        );
        if !source_ok {
            let source = sanitize_error(source_stderr);
            let source = if source.trim().is_empty() {
                "the dump tool also stopped".to_string()
            } else {
                source
            };
            message.push_str(&format!(
                "\n\npg_dump also stopped, which is usually the consequence of the target rejecting the restore: {source}"
            ));
        }
        return Some(message);
    }

    let source = sanitize_error(source_stderr);
    let source = if source.trim().is_empty() {
        "the dump tool exited with an error and printed no diagnostic".to_string()
    } else {
        source
    };
    Some(format!("pg_dump failed: {source}"))
}

/// Runs a DB-to-DB sync under `job`: `pg_dump` on `source` piped into
/// `pg_restore` on `target`.
///
/// Both processes are owned by the job, so cancelling (or quitting) terminates
/// both trees instead of leaving a half-running pipe behind. Bytes crossing the
/// pipe reset the idle clock: a sync that moves nothing and prints nothing is
/// hung, while a slow one keeps running.
pub fn run_db_sync_managed(
    job: &JobControl,
    source: &PgConnParams,
    target: &PgConnParams,
    schema: Option<&str>,
    tables: Option<&[String]>,
    tools: &PgToolPaths,
) -> Result<(), JobFailure> {
    // --- Build pg_dump args ---
    let mut dump_args = base_conn_args(source);
    dump_args.push("--format=c".into()); // binary custom format for reliable piping
    dump_args.push("--no-owner".into());

    if let Some(schema) = schema {
        dump_args.push(format!("--schema={schema}"));
    }

    if let Some(tables) = tables {
        for t in tables {
            dump_args.push(format!("--table={t}"));
        }
    }

    // --- Build pg_restore args ---
    // --clean --if-exists makes sync work into a non-empty target (the UI
    // already requires a destructive-overwrite confirmation), and
    // --single-transaction makes a failed sync roll the target back instead of
    // leaving it partially replaced. --exit-on-error keeps a partial sync from
    // being reported as success.
    let restore_args = build_pg_sync_restore_args(target);

    let mut dump_cmd = Command::new(&tools.pg_dump);
    dump_cmd
        .env("PGPASSWORD", &source.password)
        .args(&dump_args);
    source
        .apply_tool_env(&mut dump_cmd)
        .map_err(JobFailure::failed)?;

    let mut restore_cmd = Command::new(&tools.pg_restore);
    restore_cmd
        .env("PGPASSWORD", &target.password)
        .args(&restore_args);
    // Each endpoint enforces its OWN TLS decision: one side being `require` says
    // nothing about the other.
    target
        .apply_tool_env(&mut restore_cmd)
        .map_err(JobFailure::failed)?;

    let out = job::run_managed_pipe(job, dump_cmd, restore_cmd).map_err(JobFailure::from)?;

    // The target's failure is the actionable one; a source failure caused by the
    // target closing the pipe is reported as consequence, not as the cause.
    match db_sync_failure_message(
        out.source_status.success(),
        &out.source_stderr,
        out.sink_status.success(),
        &out.sink_stderr,
    ) {
        None => Ok(()),
        Some(message) => Err(JobFailure::failed(message)),
    }
}

/// Headless one-shot form of [`run_db_sync_managed`].
pub fn run_db_sync(
    source: &PgConnParams,
    target: &PgConnParams,
    schema: Option<&str>,
    tables: Option<&[String]>,
    tools: &PgToolPaths,
) -> Result<(), String> {
    run_db_sync_managed(
        &JobControl::detached(),
        source,
        target,
        schema,
        tables,
        tools,
    )
    .map_err(|e| e.message)
}

// ---------------------------------------------------------------------------
// SQLite dump / restore / sync (headless-testable core)
// ---------------------------------------------------------------------------

/// Quote a SQLite identifier with double quotes (preserving the spec's
/// no-injection rule). Delegates to `db::ident` — one implementation per engine.
fn sqlite_quote_ident(name: &str) -> String {
    crate::db::ident::quote(crate::db::ident::Engine::Sqlite, name)
}

/// Upper-case-free hex of `bytes`, for SQLite's `X'…'` literal form.
fn hex_bytes(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        // Writing to a String cannot fail.
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// A REAL literal that restores as the same REAL.
///
/// `{:?}` is the shortest decimal that round-trips and always carries a `.` or
/// an exponent, so SQLite cannot re-read `5.0` as the INTEGER `5` and change the
/// value's storage class. SQLite stores no NaN (it stores NaN as NULL), and its
/// infinities are expressible only as a decimal exponent large enough to
/// overflow — `to_string()` would produce `inf`, which is not SQL.
fn sqlite_real_literal(r: f64) -> String {
    if r.is_nan() {
        // Unreachable for values read back out of SQLite; kept explicit so this
        // never silently emits an unparsable literal.
        return "NULL".to_string();
    }
    if r.is_infinite() {
        return if r.is_sign_positive() {
            "9e999"
        } else {
            "-9e999"
        }
        .to_string();
    }
    format!("{r:?}")
}

/// SQL literal that reproduces `v` exactly when the dump is replayed.
///
/// Deliberately not lossy. `sqlite3 .dump` renders TEXT through its UTF-8
/// decoder, which silently replaces invalid bytes — for a backup that is data
/// corruption. Here:
///
/// * TEXT that is valid UTF-8 and NUL-free is a quoted literal (readable, and
///   what `.dump` produces).
/// * TEXT with invalid UTF-8 or an embedded NUL becomes `CAST(X'…' AS TEXT)`,
///   which restores the exact bytes while keeping the TEXT storage class.
/// * BLOBs are always `X'…'`, so embedded NULs and high bytes survive.
/// * REALs keep their storage class and sign, including ±Infinity.
fn sqlite_literal(v: ValueRef) -> String {
    match v {
        ValueRef::Null => "NULL".to_string(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(r) => sqlite_real_literal(r),
        ValueRef::Text(t) => match std::str::from_utf8(t) {
            // A quoted SQL literal cannot carry a NUL: the statement is passed as
            // a C string, which would be truncated there.
            Ok(text) if !text.as_bytes().contains(&0) => {
                format!("'{}'", text.replace('\'', "''"))
            }
            _ => format!("CAST(X'{}' AS TEXT)", hex_bytes(t)),
        },
        ValueRef::Blob(b) => format!("X'{}'", hex_bytes(b)),
    }
}

// --- Dump destination safety ------------------------------------------------

/// The one message a self-dumping destination earns. It names no path (dump
/// errors cross the IPC boundary) and says what to do instead.
fn source_is_destination_message() -> String {
    "The dump destination is the same file as the source database. Gridline refuses to write \
     a dump onto the database it reads, because that would destroy the source. Choose a \
     different file."
        .to_string()
}

/// Resolve `path` to the file it really names.
///
/// A destination that does not exist yet has no inode, so its identity is its
/// resolved parent directory plus the file name. Failing to resolve means file
/// identity is uncertain, which fails closed rather than guessing.
fn resolved_output_path(path: &Path) -> Result<PathBuf, String> {
    if let Ok(real) = std::fs::canonicalize(path) {
        return Ok(real);
    }
    let name = path.file_name().ok_or_else(|| {
        format!(
            "the dump destination {} does not name a file",
            path.display()
        )
    })?;
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let parent_real = std::fs::canonicalize(parent).map_err(|e| {
        format!(
            "cannot resolve the dump destination's directory {}: {e}",
            parent.display()
        )
    })?;
    Ok(parent_real.join(name))
}

/// Whether `source` and `other` name the same file under any name.
///
/// Identity is resolved rather than compared as text: a symlink to the source and
/// a hard link to it are the same file under different names. `same_file`
/// compares device+inode (Unix) or volume+file index (Windows), and the resolved
/// paths cover a destination that does not exist yet. Failing to resolve means
/// file identity is uncertain, which fails closed rather than guessing.
fn names_the_same_file(source: &Path, other: &Path) -> Result<bool, String> {
    if same_file::is_same_file(source, other).unwrap_or(false) {
        return Ok(true);
    }
    let source_real = std::fs::canonicalize(source)
        .map_err(|e| format!("cannot resolve the database file {}: {e}", source.display()))?;
    Ok(source_real == resolved_output_path(other)?)
}

/// Refuse a dump destination that is the database being dumped.
///
/// Identity is resolved rather than compared as text: a symlink to the source
/// and a hard link to it are the same file under different names, and writing
/// through either would truncate the source.
pub fn refuse_source_as_dump_destination(source: &Path, destination: &Path) -> Result<(), String> {
    if names_the_same_file(source, destination)? {
        return Err(source_is_destination_message());
    }
    Ok(())
}

/// Refuse a sync whose target is the file it reads.
///
/// The dump/restore pipeline holds both ends as files, so a target that resolves
/// to the source replaces the database being dumped — with `clean` semantics that
/// is a full drop-and-replay of the source. The same resolved-identity check the
/// backup path applies to its destination is therefore mandatory here too.
pub fn refuse_source_as_sync_target(source: &Path, target: &Path) -> Result<(), String> {
    if names_the_same_file(source, target)? {
        return Err(
            "The sync target is the same file as the source database. Gridline refuses \
                    to replace the database it is reading. Choose a different target file."
                .to_string(),
        );
    }
    Ok(())
}

/// The temporary sibling a dump is written to before publication: dot-prefixed
/// with a unique suffix, so it can collide with neither the destination nor a
/// concurrent dump.
fn dump_partial_sibling(destination: &Path) -> Result<PathBuf, String> {
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            format!(
                "the dump destination {} does not name a file",
                destination.display()
            )
        })?;
    let dir = match destination.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    Ok(dir.join(format!(".{name}.gridline-partial-{}", uuid::Uuid::new_v4())))
}

/// Flush, sync, and close the temporary output, then rename it over the
/// destination. Any failure here removes the temporary output and reports why;
/// the destination is never opened for writing, so it survives a failed dump.
fn publish_dump(
    partial: PathBuf,
    destination: &Path,
    writer: std::io::BufWriter<std::fs::File>,
) -> Result<(), String> {
    let file = match writer.into_inner() {
        Ok(file) => file,
        Err(e) => {
            let message = e.error().to_string();
            drop(e); // close the handle before removing the partial output
            let _ = std::fs::remove_file(&partial);
            return Err(format!("dump write failed: {message}"));
        }
    };
    if let Err(e) = file.sync_all() {
        drop(file);
        let _ = std::fs::remove_file(&partial);
        return Err(format!("dump write failed: {e}"));
    }
    drop(file);
    if let Err(e) = std::fs::rename(&partial, destination) {
        let _ = std::fs::remove_file(&partial);
        return Err(format!(
            "the dump could not replace {}: {e}",
            destination.display()
        ));
    }
    Ok(())
}

/// Generate a `.dump`-format SQL script from `conn`, streaming to `out`. Calls
/// `on_progress(table_name)` per table. Fails closed on virtual tables.
pub fn dump_sqlite_to<W: Write, F: FnMut(&str)>(
    conn: &Connection,
    out: &mut W,
    on_progress: F,
) -> Result<(), String> {
    dump_sqlite_to_cancellable(conn, out, on_progress, &never_cancel)
}

/// [`dump_sqlite_to`] with a cancellation check between tables, so a large
/// SQLite backup can be stopped from the UI instead of running to completion.
/// Every value of a one-column query as a `String`, propagating a decode
/// failure instead of skipping the row. `what` names the step in the error a
/// user sees, so a failure says which catalog read could not be decoded.
fn sqlite_string_column(conn: &Connection, sql: &str, what: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("query {what}: {e}"))?;
    let mut rows = stmt.query([]).map_err(|e| format!("query {what}: {e}"))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("read {what}: {e}"))? {
        let value: String = row.get(0).map_err(|e| format!("decode {what}: {e}"))?;
        out.push(value);
    }
    Ok(out)
}

pub fn dump_sqlite_to_cancellable<W: Write, F: FnMut(&str)>(
    conn: &Connection,
    out: &mut W,
    mut on_progress: F,
    is_cancelled: CancelCheck<'_>,
) -> Result<(), String> {
    if is_cancelled() {
        return Err(CANCEL_MESSAGE.to_string());
    }

    // Every read below — the schema, each table's rows, sequences — goes through
    // one transaction, so a writer committing midway (even from another process)
    // cannot produce a dump whose tables come from different points in time. The
    // first read pins the snapshot; the transaction is dropped (rolled back) at
    // the end, since a dump never writes to the source.
    //
    // A caller that already owns a transaction keeps it: nesting one is an
    // error, and its snapshot is already the right answer.
    let snapshot = if conn.is_autocommit() {
        Some(
            conn.unchecked_transaction()
                .map_err(|e| format!("begin dump snapshot: {e}"))?,
        )
    } else {
        None
    };
    let reader: &Connection = match &snapshot {
        Some(txn) => txn,
        None => conn,
    };

    writeln!(out, "PRAGMA foreign_keys=OFF;").map_err(|e| e.to_string())?;
    writeln!(out, "BEGIN TRANSACTION;").map_err(|e| e.to_string())?;

    // `user_version` and `application_id` live in the database header, so no
    // CREATE statement carries them and a dump without them silently resets an
    // application's schema versioning. They are the only pragmas the dump emits:
    // journal mode, page size and synchronisation are local to the machine, and
    // replaying them is how a restore breaks a database.
    let user_version: i64 = reader
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| format!("read user_version: {e}"))?;
    let application_id: i64 = reader
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .map_err(|e| format!("read application_id: {e}"))?;
    writeln!(out, "PRAGMA user_version = {user_version};").map_err(|e| e.to_string())?;
    writeln!(out, "PRAGMA application_id = {application_id};").map_err(|e| e.to_string())?;

    // 1. Tables (schema + data), fail-closed on virtual tables.
    //
    // Decode failures propagate everywhere below: a row or catalog entry this
    // dump cannot represent fails the backup, because a silently dropped table or
    // row is worse than a failed dump.
    let table_names = sqlite_string_column(
        reader,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
        "the table list from sqlite_master",
    )?;

    for name in &table_names {
        if is_cancelled() {
            return Err(CANCEL_MESSAGE.to_string());
        }
        let create_sql: String = reader
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| format!("decode the schema of table \"{name}\": {e}"))?;
        if create_sql.to_lowercase().contains("create virtual table") {
            return Err(format!(
                "SQLite virtual tables are not supported for .dump in v0.7.8 (table: {name})"
            ));
        }
        writeln!(out, "{create_sql};").map_err(|e| e.to_string())?;
        on_progress(name);

        // Columns excluding generated/hidden (hidden != 0) via pragma_table_xinfo.
        let emitted: Vec<String> = {
            let mut stmt = reader
                .prepare(&format!(
                    "SELECT name, hidden FROM pragma_table_xinfo({})",
                    sqlite_quote_ident(name)
                ))
                .map_err(|e| format!("query the columns of \"{name}\": {e}"))?;
            let mut rows = stmt
                .query([])
                .map_err(|e| format!("query the columns of \"{name}\": {e}"))?;
            let mut emitted = Vec::new();
            while let Some(row) = rows
                .next()
                .map_err(|e| format!("read the columns of \"{name}\": {e}"))?
            {
                let column: String = row
                    .get(0)
                    .map_err(|e| format!("decode a column name of \"{name}\": {e}"))?;
                let hidden: i64 = row
                    .get(1)
                    .map_err(|e| format!("decode a column of \"{name}\": {e}"))?;
                if hidden == 0 {
                    emitted.push(column);
                }
            }
            emitted
        };
        let col_list = emitted
            .iter()
            .map(|n| sqlite_quote_ident(n))
            .collect::<Vec<_>>()
            .join(", ");
        // Emit one INSERT per row (faithful to .dump).
        let select = format!(
            "SELECT {} FROM {}",
            emitted
                .iter()
                .map(|n| sqlite_quote_ident(n))
                .collect::<Vec<_>>()
                .join(", "),
            sqlite_quote_ident(name)
        );
        let mut stmt = reader
            .prepare(&select)
            .map_err(|e| format!("query the rows of \"{name}\": {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("query the rows of \"{name}\": {e}"))?;
        let mut row_number = 0u64;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("read row {row_number} of \"{name}\": {e}"))?
        {
            // Poll inside the table as well: a single table is one unbounded
            // step otherwise, so a cancel could not take effect until every row
            // of it had already been written to the dump.
            if is_cancelled() {
                return Err(CANCEL_MESSAGE.to_string());
            }
            let mut vals: Vec<String> = Vec::with_capacity(emitted.len());
            for (index, column) in emitted.iter().enumerate() {
                let value = row.get_ref(index).map_err(|e| {
                    format!("decode \"{name}\".\"{column}\" in row {row_number}: {e}")
                })?;
                vals.push(sqlite_literal(value));
            }
            writeln!(
                out,
                "INSERT INTO {} ({}) VALUES ({});",
                sqlite_quote_ident(name),
                col_list,
                vals.join(", ")
            )
            .map_err(|e| e.to_string())?;
            row_number += 1;
        }
    }

    // 2. Indexes, triggers, views (sql not null).
    for ty in ["index", "trigger", "view"] {
        let sqls = sqlite_string_column(
            reader,
            &format!(
                "SELECT sql FROM sqlite_master WHERE type='{ty}' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ),
            &format!("the {ty} definitions from sqlite_master"),
        )?;
        for s in sqls {
            writeln!(out, "{s};").map_err(|e| e.to_string())?;
        }
    }

    // 3. sqlite_sequence (AUTOINCREMENT counters) if it exists.
    let has_sequence = reader
        .prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'")
        .map_err(|e| format!("query sqlite_master for sqlite_sequence: {e}"))?
        .exists([])
        .map_err(|e| format!("query sqlite_master for sqlite_sequence: {e}"))?;
    if has_sequence {
        writeln!(out, "DELETE FROM sqlite_sequence;").map_err(|e| e.to_string())?;
        let mut stmt = reader
            .prepare("SELECT name, seq FROM sqlite_sequence")
            .map_err(|e| format!("query sqlite_sequence: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("query sqlite_sequence: {e}"))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("read sqlite_sequence: {e}"))?
        {
            let table: String = row
                .get(0)
                .map_err(|e| format!("decode sqlite_sequence: {e}"))?;
            let seq: i64 = row
                .get(1)
                .map_err(|e| format!("decode the sequence of \"{table}\": {e}"))?;
            writeln!(
                out,
                "INSERT INTO sqlite_sequence VALUES ('{}', {});",
                table.replace('\'', "''"),
                seq
            )
            .map_err(|e| e.to_string())?;
        }
    }

    writeln!(out, "COMMIT;").map_err(|e| e.to_string())?;
    Ok(())
}

/// Dump the SQLite database at `source_path` into `out_path` (one-shot).
///
/// The source is refused as a destination, and output is published atomically —
/// see [`dump_sqlite_to_path_cancellable`].
pub fn dump_sqlite_to_path(source_path: &str, out_path: &str) -> Result<(), String> {
    dump_sqlite_to_path_cancellable(source_path, out_path, |_| {}, &never_cancel)
}

/// Dump the SQLite database at `source_path` into the file at `out_path`,
/// safely.
///
/// Three guarantees the byte-sink form cannot give:
///
/// * **The source is never the destination.** A resolved-identity check refuses
///   the connection's own file, including a symlink or hard link to it: writing
///   a dump onto the database it reads would destroy the source.
/// * **The destination is published, not truncated.** Output goes to a
///   temporary sibling and is renamed over the destination only after the whole
///   dump is written, flushed, and synced. A failed or cancelled dump leaves an
///   existing destination byte-identical and leaves no partial artifact behind.
/// * **A missing database is an error.** The source is not opened for creation,
///   so a mistyped path cannot look like an empty backup.
pub fn dump_sqlite_to_path_cancellable<F: FnMut(&str)>(
    source_path: &str,
    out_path: &str,
    on_progress: F,
    is_cancelled: CancelCheck<'_>,
) -> Result<(), String> {
    let source = Path::new(source_path);
    let destination = Path::new(out_path);
    if !source.is_file() {
        return Err(format!(
            "the SQLite database to dump is not an existing file: {}",
            source.display()
        ));
    }
    refuse_source_as_dump_destination(source, destination)?;
    if is_cancelled() {
        return Err(CANCEL_MESSAGE.to_string());
    }

    // Opening the source first means a database that cannot be read creates no
    // temporary output at all.
    let conn = Connection::open(source).map_err(|e| format!("open source: {e}"))?;
    let partial = dump_partial_sibling(destination)?;
    let file = std::fs::File::create(&partial)
        .map_err(|e| format!("cannot create the dump file {}: {e}", partial.display()))?;
    let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, file);

    let dumped = dump_sqlite_to_cancellable(&conn, &mut writer, on_progress, is_cancelled);
    drop(conn);
    let result = match dumped {
        Ok(()) => publish_dump(partial.clone(), destination, writer),
        Err(e) => {
            // Closing the writer first lets the temporary file be removed on
            // every platform.
            drop(writer);
            Err(e)
        }
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result
}

/// First bare word of a statement (uppercased), skipping leading whitespace
/// and comments. `split_statements` keeps comments verbatim, so a dump
/// statement routinely starts with `-- …` or a `/*! … */` header.
fn first_word_upper(stmt: &str) -> Option<String> {
    let mut rest = stmt.trim_start();
    loop {
        if let Some(tail) = rest.strip_prefix("--") {
            match tail.find('\n') {
                Some(idx) => {
                    rest = tail[idx + 1..].trim_start();
                    continue;
                }
                None => return None,
            }
        }
        if let Some(tail) = rest.strip_prefix("/*") {
            match tail.find("*/") {
                Some(idx) => {
                    rest = tail[idx + 2..].trim_start();
                    continue;
                }
                None => return None,
            }
        }
        break;
    }
    let word: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if word.is_empty() {
        None
    } else {
        Some(word.to_ascii_uppercase())
    }
}

/// Statements the restore owns rather than the dump content: the dump's own
/// `BEGIN`/`COMMIT` would nest inside our transaction, and SQLite ignores most
/// pragmas inside one (`PRAGMA journal_mode=WAL` even errors). The target keeps
/// whatever pragmas it already had, which is the behaviour we want.
fn restore_harness_statement(keyword: &str) -> bool {
    matches!(
        keyword,
        "PRAGMA" | "BEGIN" | "COMMIT" | "END" | "ROLLBACK" | "ABORT" | "SAVEPOINT" | "RELEASE"
    )
}

/// The only pragmas a dump must replay, because they describe the database's own
/// contents rather than the machine it came from.
///
/// `user_version` and `application_id` are header fields: an application's
/// schema versioning and file typing live there, and dropping them silently
/// changes what a restored database claims to be. Everything else a `PRAGMA` can
/// do (`journal_mode`, `page_size`, `synchronous`, `foreign_keys`, …) is
/// connection- or device-local, so the target keeps its own.
///
/// Only integer assignments to exactly these two names are recognised, so this
/// exemption cannot widen into replaying an arbitrary pragma statement.
fn restore_roundtrip_pragma(stmt: &str) -> bool {
    let lower = stmt.trim().to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("pragma") else {
        return false;
    };
    let Some((name, value)) = rest.trim_start().split_once('=') else {
        return false;
    };
    let name = name.trim();
    if name != "user_version" && name != "application_id" {
        return false;
    }
    let value = value.trim().trim_end_matches(';').trim();
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// Statements that cannot run inside a transaction, rejected before anything
/// is mutated instead of discovered halfway through.
fn restore_unsupported_in_txn(keyword: &str) -> bool {
    matches!(keyword, "VACUUM" | "ATTACH" | "DETACH")
}

/// Drop every user object in dependency-safe order, propagating errors.
///
/// `DROP TABLE IF EXISTS <view>` errors ("use DROP VIEW"), which is why the
/// kind comes from `sqlite_master` instead of guessing — and why the previous
/// implementation swallowed every drop error with `let _ =`.
fn drop_sqlite_user_objects(conn: &Connection) -> Result<(), String> {
    let objects: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT type, name FROM sqlite_master
                   WHERE type IN ('table','view','index','trigger')
                     AND name NOT LIKE 'sqlite_%'
                   ORDER BY CASE type
                              WHEN 'view' THEN 0
                              WHEN 'trigger' THEN 1
                              WHEN 'index' THEN 2
                              ELSE 3
                            END, name",
            )
            .map_err(|e| format!("read sqlite_master: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("read sqlite_master: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("read sqlite_master: {e}"))?;
        rows
    };

    for (kind, name) in objects {
        let keyword = match kind.as_str() {
            "view" => "VIEW",
            "index" => "INDEX",
            "trigger" => "TRIGGER",
            _ => "TABLE",
        };
        conn.execute(
            &format!("DROP {keyword} IF EXISTS {}", sqlite_quote_ident(&name)),
            [],
        )
        .map_err(|e| format!("drop {kind} \"{name}\": {e}"))?;
    }
    Ok(())
}

/// Restore a `.dump` SQL script into `conn`.
///
/// Atomic: with `clean`, the drops and every statement of the dump run inside
/// one `BEGIN IMMEDIATE`. Any failure rolls the whole thing back, so a
/// malformed or truncated dump leaves the target exactly as it was. The
/// target's `foreign_keys` setting is restored on every exit path.
pub fn restore_sqlite(conn: &Connection, dump_text: &str, clean: bool) -> Result<(), String> {
    restore_sqlite_cancellable(conn, dump_text, clean, &never_cancel)
}

/// [`restore_sqlite`] with a cancellation check between statements. Because the
/// whole replay is one transaction, a cancelled restore rolls back instead of
/// leaving a half-applied script behind.
pub fn restore_sqlite_cancellable(
    conn: &Connection,
    dump_text: &str,
    clean: bool,
    is_cancelled: CancelCheck<'_>,
) -> Result<(), String> {
    let original_foreign_keys: i64 = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap_or(0);

    // Parse and vet everything BEFORE touching the database.
    let mut replay: Vec<String> = Vec::new();
    for stmt in crate::db::sql_split::split_statements(dump_text) {
        let Some(keyword) = first_word_upper(&stmt) else {
            continue;
        };
        if restore_unsupported_in_txn(&keyword) {
            return Err(format!(
                "{keyword} cannot run inside the restore transaction — restore this dump with the sqlite3 CLI instead"
            ));
        }
        // Round-trip header metadata is replayed; every other pragma is a local
        // setting of the target and is dropped by `restore_harness_statement`.
        if restore_roundtrip_pragma(&stmt) {
            replay.push(stmt);
            continue;
        }
        if restore_harness_statement(&keyword) {
            continue;
        }
        replay.push(stmt);
    }
    if replay.is_empty() {
        return Err("restore found no SQL statements".to_string());
    }

    // A reader on the app's pool must not turn this into SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    // A no-op inside a transaction, so it has to be set here.
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| format!("foreign_keys: {e}"))?;

    let total = replay.len();
    let result = (|| -> Result<(), String> {
        conn.execute_batch("BEGIN IMMEDIATE;")
            .map_err(|e| format!("begin: {e}"))?;
        if clean {
            drop_sqlite_user_objects(conn)?;
        }
        for (index, stmt) in replay.iter().enumerate() {
            if is_cancelled() {
                return Err(CANCEL_MESSAGE.to_string());
            }
            if let Err(e) = conn.execute_batch(stmt) {
                return Err(format_restore_statement_error(
                    index + 1,
                    total,
                    &e.to_string(),
                ));
            }
        }
        conn.execute_batch("COMMIT;")
            .map_err(|e| format!("commit: {e}"))
    })();

    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK;");
    }
    let restored = if original_foreign_keys != 0 { 1 } else { 0 };
    let _ = conn.execute_batch(&format!("PRAGMA foreign_keys={restored};"));
    result
}

/// Dump `source_path` and restore into `target_path` (one-shot).
pub fn run_sqlite_sync(source_path: &str, target_path: &str) -> Result<(), String> {
    run_sqlite_sync_cancellable(source_path, target_path, &never_cancel)
}

/// Cancellable SQLite dump → restore. Both halves check the flag, and a cancel
/// during the restore rolls its transaction back.
///
/// The source must exist and the target must be a different file: the dump reads
/// one file and the restore replaces the other, so a missing source would create
/// an empty database and a same-file target would replace what is being read.
pub fn run_sqlite_sync_cancellable(
    source_path: &str,
    target_path: &str,
    is_cancelled: CancelCheck<'_>,
) -> Result<(), String> {
    let source = Path::new(source_path);
    let target = Path::new(target_path);
    if !source.is_file() {
        return Err(format!(
            "the SQLite database to sync is not an existing file: {}",
            source.display()
        ));
    }
    refuse_source_as_sync_target(source, target)?;
    if is_cancelled() {
        return Err(CANCEL_MESSAGE.to_string());
    }

    let src = Connection::open(source).map_err(|e| format!("open source: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    dump_sqlite_to_cancellable(
        &src,
        &mut std::io::Cursor::new(&mut buf),
        |_| {},
        is_cancelled,
    )?;
    if is_cancelled() {
        return Err(CANCEL_MESSAGE.to_string());
    }
    let text = String::from_utf8(buf).map_err(|e| e.to_string())?;
    let dst = Connection::open(target_path).map_err(|e| format!("open target: {e}"))?;
    restore_sqlite_cancellable(&dst, &text, true, is_cancelled)
}

// ---------------------------------------------------------------------------
// MySQL dump / restore / sync (headless-testable core)
// ---------------------------------------------------------------------------

fn base_mysql_args(conn: &MySqlConnParams) -> Vec<String> {
    vec![
        format!("--host={}", conn.host),
        format!("--port={}", conn.port),
        format!("--user={}", conn.username),
    ]
}

/// Whether a resolved client is MariaDB's. MariaDB's clients print a
/// `...-MariaDB...` banner from `--version`; MySQL's print the Oracle banner.
/// This matters because MariaDB's clients — including the `mysqldump`/`mysql`
/// compatibility names some MariaDB packages ship — reject several MySQL-only
/// options with "unknown option", aborting the dump before it connects.
/// Probed once per program and cached for the process.
fn client_is_mariadb(program: &str) -> bool {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, bool>>> =
        std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));

    if let Ok(map) = cache.lock() {
        if let Some(hit) = map.get(program) {
            return *hit;
        }
    }

    let is_mariadb =
        crate::job::capture_bounded(program, &["--version"], tool_resolver::PROBE_TIMEOUT)
            .map(|o| {
                let mut text = o.stdout;
                text.push_str(&o.stderr);
                text.contains("MariaDB")
            })
            // A client that will not answer `--version` is treated as MySQL's (the
            // MySQL-only flags below are the conservative choice: a MariaDB client
            // rejects them visibly instead of silently dumping less).
            .unwrap_or(false);

    if let Ok(mut map) = cache.lock() {
        map.insert(program.to_string(), is_mariadb);
    }
    is_mariadb
}

/// TLS flags for one MySQL-family client, derived from the connection's own
/// `ssl_mode` (`disable` | `require` | `verify-ca` | `verify-full`).
///
/// The mode is parsed with the shared parser ([`crate::db::tls::parse_ssl_mode`]),
/// never with a private spelling table: the four modes above are the only ones
/// any part of Gridline accepts, and an unrecognized non-empty value is an
/// **error** here too. A local fallback would let a typo (`verify_ca`,
/// `verifyidentity`, …) reach a client as some *other* mode — the exact silent
/// coercion ticket 23 removed from the connection path.
///
/// MySQL's clients speak `--ssl-mode=<MODE>`. MariaDB's have no `--ssl-mode`:
/// they use the boolean `--ssl` (default ON) plus `--ssl-verify-server-cert`
/// (default ON in 11.4, but stated explicitly so older clients that default it
/// OFF still verify).
pub fn mysql_tls_args(
    client_is_mariadb: bool,
    tls_mode: Option<&str>,
) -> Result<Vec<String>, String> {
    let Some(mode) = crate::db::tls::parse_ssl_mode(tls_mode)? else {
        return Ok(Vec::new());
    };

    let args = if client_is_mariadb {
        match mode {
            crate::db::tls::SslMode::Disable => vec!["--skip-ssl".to_string()],
            crate::db::tls::SslMode::Require => vec![
                "--ssl".to_string(),
                "--skip-ssl-verify-server-cert".to_string(),
            ],
            crate::db::tls::SslMode::VerifyCa | crate::db::tls::SslMode::VerifyFull => {
                vec!["--ssl".to_string(), "--ssl-verify-server-cert".to_string()]
            }
        }
    } else {
        let flag = match mode {
            crate::db::tls::SslMode::Disable => "DISABLED",
            crate::db::tls::SslMode::Require => "REQUIRED",
            crate::db::tls::SslMode::VerifyCa => "VERIFY_CA",
            crate::db::tls::SslMode::VerifyFull => "VERIFY_IDENTITY",
        };
        vec![format!("--ssl-mode={flag}")]
    };
    Ok(args)
}

/// `mariadb-dump`/`mysqldump` args. Passwords go via MYSQL_PWD env (set by the
/// command), NEVER --password (process-list visibility).
///
/// `client_is_mariadb` gates the MySQL-only options: MariaDB's dump rejects
/// `--skip-column-statistics`. `--databases` is always emitted as a boolean
/// flag followed by the database name — `--databases=<db>` is rejected by
/// clients as an invalid value.
pub fn build_mysql_dump_args(
    conn: &MySqlConnParams,
    options: &MySqlBackupOptions,
    client_is_mariadb: bool,
) -> Vec<String> {
    let mut a = base_mysql_args(conn);
    if options.single_transaction {
        a.push("--single-transaction".into());
    }
    if options.no_data {
        a.push("--no-data".into());
    }
    if options.routines {
        a.push("--routines".into());
    }
    if options.triggers {
        a.push("--triggers".into());
    }
    if options.events {
        a.push("--events".into());
    }
    a.push("--databases".into());
    a.push(options.database.clone());
    a.push(format!("--result-file={}", options.file_path));
    if !client_is_mariadb {
        a.push("--skip-column-statistics".into());
    }
    a
}

/// `mariadb-dump`/`mysqldump` args for a **DB-to-DB sync**, deliberately
/// separate from [`build_mysql_dump_args`]:
///
/// * No `--databases` — that emits `CREATE DATABASE` and `USE <source>`, which
///   would redirect the restore into a source-named schema on the *target*
///   server (issue #47). The database is passed positionally instead, which
///   dumps its contents without database creation or selection statements.
/// * `--add-drop-table` so re-syncing into a non-empty target replaces tables.
pub fn build_mysql_sync_dump_args(
    source: &MySqlConnParams,
    client_is_mariadb: bool,
    tls_mode: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = base_mysql_args(source);
    args.push("--single-transaction".into());
    args.push("--add-drop-table".into());
    if !client_is_mariadb {
        args.push("--skip-column-statistics".into());
    }
    args.extend(mysql_tls_args(client_is_mariadb, tls_mode)?);
    // Positional database name: contents only, no CREATE DATABASE / USE.
    args.push(source.database.clone());
    Ok(args)
}

/// `mariadb`/`mysql` client args that consume a sync dump. The target
/// endpoint gets its **own** TLS mode (issue #47).
pub fn mysql_sync_restore_args(
    target: &MySqlConnParams,
    client_is_mariadb: bool,
    tls_mode: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = base_mysql_args(target);
    args.push(format!("--database={}", target.database));
    args.extend(mysql_tls_args(client_is_mariadb, tls_mode)?);
    Ok(args)
}

/// System-first mariadb-dump/mysqldump resolution (bundled fallback).
pub fn resolve_mysql_tool(app: &AppHandle, tool: &str) -> (String, Option<String>) {
    match tool_resolver::mysql_request(tool) {
        Some(request) => {
            tool_resolver::adapt_resolution(&resolve_request(app, &request, false), tool)
        }
        None => (tool.to_string(), None),
    }
}

pub fn resolve_mysql_tool_paths(app: &AppHandle) -> MySqlToolPaths {
    MySqlToolPaths {
        mysqldump: resolve_mysql_tool(app, "mariadb-dump").0,
        mysql: resolve_mysql_tool(app, "mariadb").0,
    }
}

/// Headless core: spawn dump with MYSQL_PWD env. `tls_mode` (e.g. `require`)
/// is translated per client — `--ssl-mode=` on MySQL clients, MariaDB's
/// boolean flags on MariaDB's (see `mysql_tls_args`) when routing through an
/// SSH tunnel.
/// (Live behavior = #[ignore] integration test.)
pub fn run_mysql_dump(
    conn: &MySqlConnParams,
    options: &MySqlBackupOptions,
    tools: &MySqlToolPaths,
    tls_mode: Option<&str>,
) -> Result<(), String> {
    run_mysql_dump_managed(&JobControl::detached(), conn, options, tools, tls_mode)
        .map_err(|e| e.message)
}

/// [`run_mysql_dump`] owned by `job`: the `--result-file` output is the progress
/// signal, cancellation kills the dump's whole process tree, and a hung dump is
/// stopped by the idle bound instead of waiting forever.
pub fn run_mysql_dump_managed(
    job: &JobControl,
    conn: &MySqlConnParams,
    options: &MySqlBackupOptions,
    tools: &MySqlToolPaths,
    tls_mode: Option<&str>,
) -> Result<(), JobFailure> {
    let is_mariadb = client_is_mariadb(&tools.mysqldump);
    let mut args = build_mysql_dump_args(conn, options, is_mariadb);
    args.extend(mysql_tls_args(is_mariadb, tls_mode).map_err(JobFailure::failed)?);

    let mut cmd = Command::new(&tools.mysqldump);
    cmd.env("MYSQL_PWD", &conn.password).args(&args);

    let activity = job::path_size_probe(&options.file_path);
    let out = job::run_managed(job, cmd, Some(activity)).map_err(JobFailure::from)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(JobFailure::failed(sanitize_error(&out.stderr)))
    }
}

/// Pipe a source database's dump into a target database.
///
/// Three things differ from a file backup deliberately (issue #47):
///
/// * the dump comes from [`build_mysql_sync_dump_args`], which never emits
///   `CREATE DATABASE`/`USE` — otherwise the restore would switch away from
///   the selected target;
/// * the **dump** exit status is checked first, so an empty failed dump cannot
///   masquerade as a successful sync;
/// * each endpoint passes its own TLS mode to its own client.
///
/// The dump's stderr is drained on a separate thread: a large warning burst
/// would otherwise fill the pipe buffer and deadlock both processes.
pub fn run_mysql_sync(
    source: &MySqlConnParams,
    target: &MySqlConnParams,
    tools: &MySqlToolPaths,
    src_tls: Option<&str>,
    tgt_tls: Option<&str>,
) -> Result<(), String> {
    run_mysql_sync_managed(
        &JobControl::detached(),
        source,
        target,
        tools,
        src_tls,
        tgt_tls,
    )
    .map_err(|e| e.message)
}

/// [`run_mysql_sync`] owned by `job`. Both ends belong to the job (cancel and
/// app exit terminate both trees), and bytes crossing the pipe keep a slow but
/// productive sync alive.
pub fn run_mysql_sync_managed(
    job: &JobControl,
    source: &MySqlConnParams,
    target: &MySqlConnParams,
    tools: &MySqlToolPaths,
    src_tls: Option<&str>,
    tgt_tls: Option<&str>,
) -> Result<(), JobFailure> {
    let dump_is_mariadb = client_is_mariadb(&tools.mysqldump);
    let restore_is_mariadb = client_is_mariadb(&tools.mysql);

    let dump_args =
        build_mysql_sync_dump_args(source, dump_is_mariadb, src_tls).map_err(JobFailure::failed)?;
    let restore_args =
        mysql_sync_restore_args(target, restore_is_mariadb, tgt_tls).map_err(JobFailure::failed)?;

    let mut dump_cmd = Command::new(&tools.mysqldump);
    dump_cmd.env("MYSQL_PWD", &source.password).args(&dump_args);

    let mut restore_cmd = Command::new(&tools.mysql);
    restore_cmd
        .env("MYSQL_PWD", &target.password)
        .args(&restore_args);

    let out = job::run_managed_pipe(job, dump_cmd, restore_cmd).map_err(JobFailure::from)?;

    // The dump is evaluated FIRST: a restore that read an empty stream from a
    // failed dump exits 0, and that must not read as a successful sync.
    if !out.source_status.success() {
        return Err(JobFailure::failed(format!(
            "dump failed: {}",
            sanitize_error(&out.source_stderr)
        )));
    }
    if !out.sink_status.success() {
        return Err(JobFailure::failed(format!(
            "restore: {}",
            sanitize_error(&out.sink_stderr)
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Native MySQL restore engine (in-process via sqlx — no CLI, no subprocess)
// ---------------------------------------------------------------------------

/// Restore reads from disk, so it is capped at the existing CSV/JSON import
/// limit (100 MB) rather than the 5 MB *editor* cap — a file too large to open
/// in the editor must still be restorable (spec §2).
pub const MAX_RESTORE_FILE_BYTES: u64 = 100 * 1024 * 1024;

/// Enforce the restore size cap. Extracted from the command so the boundary is
/// testable; restore reads from disk, so it uses the 100 MB bulk cap rather
/// than the 5 MB *editor* cap (spec §2).
pub fn check_restore_file_size(bytes: u64, cap: u64) -> Result<(), String> {
    if bytes <= cap {
        return Ok(());
    }
    Err(format!(
        "Restore file is {} MB; the limit is {} MB",
        bytes.div_ceil(1024 * 1024),
        cap / (1024 * 1024)
    ))
}

/// Inputs for one native restore run. A struct rather than a long argument
/// list so the headless core stays readable and directly testable.
pub struct MySqlRestoreRun<'a> {
    pub database: &'a str,
    /// Statements borrowed from the script buffer (see
    /// [`crate::db::mysql_script`]), so the dump is never copied per statement.
    pub statements: &'a [crate::db::mysql_script::MySqlStatement<'a>],
    pub clean: bool,
}

/// Split a MySQL restore script without duplicating its text.
///
/// The file is read from disk **once** into a single `String`; every statement
/// here borrows from it (`Cow::Borrowed`), so parsing a dump at the 100 MB cap
/// adds only the statement index — not a second copy of the SQL. Only a
/// statement that a `DELIMITER` line splits (a routine/trigger body) is joined
/// into an owned string.
///
/// The statement budget is enforced here, before a connection is opened.
pub fn parse_mysql_restore_script(
    text: &str,
) -> Result<Vec<crate::db::mysql_script::MySqlStatement<'_>>, String> {
    parse_mysql_restore_script_with_cap(text, crate::commands::query::MAX_RESTORE_STATEMENTS)
}

/// [`parse_mysql_restore_script`] with an explicit statement cap, so the budget
/// boundary is testable without a million-statement fixture.
pub fn parse_mysql_restore_script_with_cap(
    text: &str,
    cap: usize,
) -> Result<Vec<crate::db::mysql_script::MySqlStatement<'_>>, String> {
    let statements: Vec<_> = crate::db::mysql_script::MySqlScript::new(text).collect();
    crate::commands::query::check_statement_budget(statements.len(), cap, true)?;
    Ok(statements)
}

/// How long a MySQL restore may wait for a metadata lock before the server stops
/// it.
///
/// The server default for `lock_wait_timeout` is **one year**, so a restore queued
/// behind another session's open transaction waits effectively forever. This
/// bounds only the wait for a lock: a statement that already holds its locks (a
/// long `ALTER TABLE`, a large multi-row `INSERT`) is unaffected, so a slow restore
/// is never killed. Chosen like the PostgreSQL lock deadline
/// ([`crate::db::restore_watch::DEFAULT_LOCK_WAIT_DEADLINE`]): generous enough for a
/// busy database, short enough that a stalled restore reports instead of hanging.
pub const MYSQL_RESTORE_LOCK_WAIT_SECONDS: u64 = 60;

/// The session statement that applies [`MYSQL_RESTORE_LOCK_WAIT_SECONDS`].
///
/// Set on the restore's own session only, and re-applied after the `USE` so it
/// covers every statement of the replay (and the clean drops before them).
pub fn mysql_lock_wait_bound_statement(seconds: u64) -> String {
    format!("SET SESSION lock_wait_timeout = {seconds}")
}

/// Progress units for a restore: every statement, plus one for the clean
/// drop phase so the fraction never jumps backwards.
pub fn restore_progress_total(statement_count: usize, clean: bool) -> usize {
    statement_count + usize::from(clean)
}

/// The error a failed restore reports. Includes the position so the user can
/// find the statement in their file, and never echoes the statement text
/// (SQL must not be logged — project guardrail).
pub fn format_restore_statement_error(index_1based: usize, total: usize, detail: &str) -> String {
    format!("Statement {index_1based} of {total} failed: {detail}")
}

/// The error the **MySQL** restore reports for a failed statement: its 1-based
/// index in the script *and* the line it starts on, so the user can find it in
/// their dump. The statement text is never echoed (SQL must not be logged).
pub fn format_mysql_restore_statement_error(
    index_1based: usize,
    total: usize,
    line_1based: usize,
    detail: &str,
) -> String {
    format!("Statement {index_1based} of {total} (line {line_1based}) failed: {detail}")
}

/// The error a failed MySQL clean-phase `DROP` reports. The drop is generated by
/// us rather than read from the file, so its position is the drop's index in the
/// plan; the SQL itself is never echoed.
pub fn format_mysql_clean_drop_error(index_1based: usize, total: usize, detail: &str) -> String {
    format!("Clean drop {index_1based} of {total} failed: {detail}")
}

/// Execute an already-split restore script over one live MySQL connection.
///
/// Stop-at-first-error by contract: MySQL DDL is non-transactional and
/// auto-commits, so there is nothing to roll back and continuing past a
/// failure would compound an already-partial restore (spec §6).
pub async fn run_mysql_restore_on(
    conn: &mut sqlx::mysql::MySqlConnection,
    run: MySqlRestoreRun<'_>,
    on_progress: &mut (dyn FnMut(usize, usize) + Send),
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<(), String> {
    crate::commands::query::check_statement_budget(
        run.statements.len(),
        crate::commands::query::MAX_RESTORE_STATEMENTS,
        true,
    )?;

    // Confine the replay to the selected database BEFORE anything runs. A dump
    // carrying `USE otherdb` (mysqldump --databases) or a schema-qualified
    // `CREATE TABLE otherdb.t` would otherwise write outside the target while the
    // clean plan dropped same-named objects inside it — the two halves would
    // describe different objects. See `mysql_clean::check_confined`.
    crate::db::mysql_clean::check_confined(run.database, run.statements)?;

    // The form lets the user target a database other than the one this
    // connection defaults to, so select it explicitly.
    exec_restore_statement(
        conn,
        &format!("USE {}", crate::db::mysql::mysql_quote_ident(run.database)),
    )
    .await
    .map_err(|e| sanitize_error(&format!("{e}")))?;

    // Bound the metadata-lock wait on this session (see
    // `MYSQL_RESTORE_LOCK_WAIT_SECONDS`): the server default is a year, so a
    // restore queued behind another session's transaction would wait forever.
    exec_restore_statement(
        conn,
        &mysql_lock_wait_bound_statement(MYSQL_RESTORE_LOCK_WAIT_SECONDS),
    )
    .await
    .map_err(|e| sanitize_error(&format!("{e}")))?;

    let total = restore_progress_total(run.statements.len(), run.clean);
    let mut done = 0usize;

    if run.clean {
        let drops = crate::db::mysql_clean::plan_clean_drops(run.database, run.statements);
        if !drops.is_empty() {
            // Foreign keys off for the drop phase, so object ordering cannot
            // fail the restore; restored on the same session right after.
            exec_restore_statement(conn, "SET FOREIGN_KEY_CHECKS = 0")
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            for (drop_idx, drop_sql) in drops.iter().enumerate() {
                if is_cancelled() {
                    return Err("Query cancelled".to_string());
                }
                if let Err(e) = exec_restore_statement(conn, drop_sql).await {
                    if crate::commands::query::is_mysql_cancel_error(&e) {
                        return Err("Query cancelled".to_string());
                    }
                    return Err(format_mysql_clean_drop_error(
                        drop_idx + 1,
                        drops.len(),
                        &sanitize_error(&format!("{e}")),
                    ));
                }
            }
            exec_restore_statement(conn, "SET FOREIGN_KEY_CHECKS = 1")
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
        }
        done += 1;
        on_progress(done, total);
    }

    for stmt in run.statements {
        if is_cancelled() {
            return Err("Query cancelled".to_string());
        }
        if let Err(e) = exec_restore_statement(conn, stmt.text.as_ref()).await {
            if crate::commands::query::is_mysql_cancel_error(&e) {
                return Err("Query cancelled".to_string());
            }
            return Err(format_mysql_restore_statement_error(
                stmt.index,
                run.statements.len(),
                stmt.line,
                &sanitize_error(&format!("{e}")),
            ));
        }
        done += 1;
        on_progress(done, total);
    }
    Ok(())
}

/// Run a single restore statement, preserving the driver error so the caller
/// can distinguish a cancellation from a genuine statement failure.
///
/// Uses the *simple* query protocol (a bare string through `Executor`), not the
/// prepared-statement protocol: MySQL rejects several restore statements
/// (`USE`, `SET`, some DDL) with error 1295 when prepared.
async fn exec_restore_statement(
    conn: &mut sqlx::mysql::MySqlConnection,
    sql: &str,
) -> Result<(), sqlx::Error> {
    use sqlx::Executor;
    conn.execute(sqlx::AssertSqlSafe(sql.to_owned()))
        .await
        .map(|_| ())
}

// ---------------------------------------------------------------------------
// Tauri commands (thin wrappers: store lookup + keychain + event emission)
// ---------------------------------------------------------------------------

fn emit_result(app_handle: &AppHandle, job_id: &str, result: Result<(), String>) {
    emit_job_result(app_handle, job_id, result.map_err(JobFailure::from_engine));
}

/// A saved connection row (`rusqlite::Connection` owns the name in this module).
type SavedConnection = crate::models::connection::Connection;

/// Every saved connection, read under the store lock and released before the
/// job awaits any work.
fn saved_connections(state: &crate::AppState) -> Result<Vec<SavedConnection>, String> {
    let store = state.db_store.lock().map_err(|e| e.to_string())?;
    store.get_connections().map_err(|e| e.to_string())
}

/// Resolve one saved connection from an already-loaded list.
///
/// Backup, restore, sync and dump-shape entry points all report a missing row
/// through this one helper, so the message is identical everywhere (it used to
/// come in three shapes: `Connection not found: <id>`, `Source connection not
/// found: <id>` and `Target connection not found: <id>`). The message itself
/// lives in [`crate::models::connection::connection_not_found`], shared with the
/// viewer and schema-diff paths.
fn require_connection(
    connections: &[SavedConnection],
    connection_id: &str,
) -> Result<SavedConnection, String> {
    connections
        .iter()
        .find(|c| c.id == connection_id)
        .cloned()
        .ok_or_else(|| crate::models::connection::connection_not_found(connection_id))
}

/// Resolve the credential a tool job authenticates with.
///
/// A keychain-enabled connection keeps reading the OS keychain (existing
/// behavior). A connection whose keychain persistence is off authenticates from
/// the session credential held in backend memory, and refuses the job with
/// `session-credential-required:<connection_id>` when that credential was never
/// supplied — the UI prompts instead of letting the tool run with an empty
/// password. The credential itself never travels through an argument list, a
/// log line, or the local store; only the child process environment carries it.
fn tool_password(
    state: &crate::AppState,
    app_handle: &AppHandle,
    connection_id: &str,
    use_keychain: bool,
) -> Result<String, String> {
    crate::session_credential::resolve_tool_credential(
        &state.session_credentials,
        use_keychain,
        connection_id,
        || crate::commands::keychain::get_connection_password_internal(app_handle, connection_id),
    )
}

/// Build the terminal progress event for a finished job. Pure so the
/// cancelled/failed/completed mapping is unit-testable without a Tauri handle.
pub fn progress_event(job_id: &str, result: &Result<(), JobFailure>) -> BackupProgressEvent {
    match result {
        Ok(()) => BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "completed".into(),
            progress: Some(1.0),
            output_line: None,
            error: None,
            warning: None,
        },
        Err(failure) if failure.cancelled => BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "cancelled".into(),
            progress: None,
            output_line: None,
            error: Some(failure.message.clone()),
            warning: None,
        },
        Err(failure) => BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "failed".into(),
            progress: None,
            output_line: None,
            error: Some(failure.message.clone()),
            warning: None,
        },
    }
}

fn emit_job_result(app_handle: &AppHandle, job_id: &str, result: Result<(), JobFailure>) {
    let _ = app_handle.emit("backup-progress", progress_event(job_id, &result));
}

/// Cancel a running tool job (backup / restore / sync).
///
/// Terminates the job's whole child process tree (a cancelled `pg_dump` leaves
/// no helper behind) and flips the cancellation flag every in-process engine
/// polls. Returns whether a job with that id was still running — including an
/// in-process job (SQLite dump/restore/sync, MySQL restore), which owns no child
/// process and was previously reported as "not running" even though it was.
#[tauri::command]
pub async fn cancel_tool_job(
    job_id: String,
    state: State<'_, crate::AppState>,
) -> Result<bool, String> {
    if !state.jobs.cancel(&job_id) {
        return Ok(false);
    }
    Ok(true)
}

#[tauri::command]
pub async fn pg_dump(
    connection_id: String,
    options: PgDumpOptions,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    // Keychain when enabled, otherwise the session-only credential (or a prompt).
    let password = tool_password(&state, &app_handle, &connection_id, conn.use_keychain)?;

    let params = PgConnParams::new(
        conn.host.clone(),
        conn.port.unwrap_or(5432),
        conn.username.unwrap_or_else(|| "postgres".into()),
        conn.database.unwrap_or_else(|| "postgres".into()),
        password,
    )
    .with_tls(
        conn.ssl_mode.clone(),
        conn.ssl_ca_path.clone(),
        conn.ssl_cert_path.clone(),
        conn.ssl_key_path.clone(),
    );
    // Resolve the TLS decision before a job exists: an unknown mode is refused
    // here instead of becoming libpq's plaintext-capable `prefer` mid-job.
    params.tls_env().map_err(|e| sanitize_error(&e))?;

    // Authorize the write last: the granted path is the only output path this
    // command can be made to use, and a grant is not spent on a request that
    // fails before the job starts.
    let options = options.with_output_path(resolve_backup_output(&state.file_grants, &file_grant)?);

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();

    tokio::task::spawn_blocking(move || {
        let result = run_pg_dump_managed(&job, &params, &options, &tools);
        jobs.finish(&job_id_clone);
        emit_job_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn pg_restore(
    connection_id: String,
    request: PgRestoreRequest,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    let password = tool_password(&state, &app_handle, &connection_id, conn.use_keychain)?;

    let params = PgConnParams::new(
        conn.host.clone(),
        conn.port.unwrap_or(5432),
        conn.username.unwrap_or_else(|| "postgres".into()),
        conn.database.unwrap_or_else(|| "postgres".into()),
        password,
    )
    .with_tls(
        conn.ssl_mode.clone(),
        conn.ssl_ca_path.clone(),
        conn.ssl_cert_path.clone(),
        conn.ssl_key_path.clone(),
    );
    // The restore target's TLS decision is resolved before the job starts, so an
    // unknown mode can never silently degrade to `prefer`.
    params.tls_env().map_err(|e| sanitize_error(&e))?;

    let accept_non_atomic = request.accept_non_atomic;

    // Authorize the read last: the granted path is the only input file this
    // command can be made to use, and a grant is not spent on a request that
    // fails before the job starts.
    let options = request.with_source_path(resolve_restore_input(&state.file_grants, &file_grant)?);

    // Decide the transaction mode off the async runtime: checking a plain-format
    // script reads the dump. A dump that cannot be restored atomically is refused
    // here, before any job exists, and nothing runs — the read above is what tells
    // us that, so such a refusal does use up the file selection (the UI says so
    // and offers a fresh one).
    let txn = {
        let format = options.format.clone();
        let path = options.file_path.clone();
        tokio::task::spawn_blocking(move || pg_restore_txn(&format, &path, accept_non_atomic))
            .await
            .map_err(|e| format!("Could not start the restore: {e}"))??
    };

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();

    tokio::task::spawn_blocking(move || {
        let result = run_pg_restore_managed(&job, &params, &options, txn, &tools);
        jobs.finish(&job_id_clone);
        emit_job_result(&app_handle_clone, &job_id_clone, result);
    });

    // Bound the one unbounded wait a restore can hit: a lock another session
    // holds. The watchdog stops THIS restore (identified by its per-job
    // `application_name`) after a continuous lock wait, and never touches a
    // restore that is merely slow. It cannot fail the restore itself.
    let watch_jobs = state.jobs.clone();
    let watch_job_id = job_id.clone();
    let watch_connection = connection_id.clone();
    let watch_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        watch_restore_lock_wait(watch_handle, watch_jobs, watch_job_id, watch_connection).await;
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn db_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let connections = saved_connections(&state)?;
    let source_conn = require_connection(&connections, &options.source_connection_id)?;
    let target_conn = require_connection(&connections, &options.target_connection_id)?;

    // Resolve each side's credential independently: a sync may mix a keychain
    // connection with a session-only one, and the refusal names whichever side
    // still needs a password.
    let src_password = tool_password(
        &state,
        &app_handle,
        &source_conn.id,
        source_conn.use_keychain,
    )?;
    let tgt_password = tool_password(
        &state,
        &app_handle,
        &target_conn.id,
        target_conn.use_keychain,
    )?;

    let source = PgConnParams::new(
        source_conn.host.clone(),
        source_conn.port.unwrap_or(5432),
        source_conn
            .username
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        source_conn
            .database
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        src_password,
    )
    .with_tls(
        source_conn.ssl_mode.clone(),
        source_conn.ssl_ca_path.clone(),
        source_conn.ssl_cert_path.clone(),
        source_conn.ssl_key_path.clone(),
    );

    let target = PgConnParams::new(
        target_conn.host.clone(),
        target_conn.port.unwrap_or(5432),
        target_conn
            .username
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        target_conn
            .database
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        tgt_password,
    )
    .with_tls(
        target_conn.ssl_mode.clone(),
        target_conn.ssl_ca_path.clone(),
        target_conn.ssl_cert_path.clone(),
        target_conn.ssl_key_path.clone(),
    );
    // Each endpoint's TLS decision is resolved before the job starts.
    source.tls_env().map_err(|e| sanitize_error(&e))?;
    target.tls_env().map_err(|e| sanitize_error(&e))?;

    let schema = options.schema.clone();
    let tables = options.tables.clone();
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(options.source_connection_id.clone()));
    let jobs = state.jobs.clone();

    tokio::task::spawn_blocking(move || {
        let result = run_db_sync_managed(
            &job,
            &source,
            &target,
            schema.as_deref(),
            tables.as_deref(),
            &tools,
        );
        jobs.finish(&job_id_clone);
        emit_job_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// MySQL dump / restore / sync commands (v0.7.8)
// ---------------------------------------------------------------------------

fn build_mysql_tool_status(dump: &ToolResolution, client: &ToolResolution) -> MySqlToolStatus {
    build_mysql_tool_status_with(dump, client, None, None)
}

fn build_mysql_tool_status_with(
    dump: &ToolResolution,
    client: &ToolResolution,
    dump_probe_error: Option<String>,
    client_probe_error: Option<String>,
) -> MySqlToolStatus {
    MySqlToolStatus {
        mysqldump_found: dump.resolved.is_some(),
        mysql_found: client.resolved.is_some(),
        mysqldump_version: dump.version.clone(),
        mysql_version: client.version.clone(),
        mysqldump_source: dump
            .resolved
            .as_ref()
            .map(|r| r.source.as_str().to_string()),
        mysql_source: client
            .resolved
            .as_ref()
            .map(|r| r.source.as_str().to_string()),
        mysqldump_resolved_name: dump.resolved.as_ref().map(|r| r.name.clone()),
        mysql_resolved_name: client.resolved.as_ref().map(|r| r.name.clone()),
        mysqldump_is_mariadb: dump
            .resolved
            .as_ref()
            .map(|r| r.name.starts_with("mariadb"))
            .unwrap_or(false),
        mysqldump_bundled_available: dump.bundled_available,
        mysql_bundled_available: client.bundled_available,
        mysqldump_probe_error: if dump.resolved.is_none() {
            dump_probe_error
        } else {
            None
        },
        mysql_probe_error: if client.resolved.is_none() {
            client_probe_error
        } else {
            None
        },
    }
}

#[tauri::command]
pub async fn detect_mysql_tools(force: Option<bool>, app_handle: AppHandle) -> MySqlToolStatus {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let (dump, dump_note) =
            resolve_request_detailed(&app_handle, &tool_resolver::mysql_dump_request(), force);
        let (client, client_note) =
            resolve_request_detailed(&app_handle, &tool_resolver::mysql_client_request(), force);
        build_mysql_tool_status_with(&dump, &client, dump_note, client_note)
    })
    .await
    .unwrap_or_else(|_| build_mysql_tool_status(&ToolResolution::none(), &ToolResolution::none()))
}

/// Effective TLS mode for one MySQL-family CLI endpoint.
///
/// A tunnelled endpoint is loopback, and both MariaDB's
/// `--ssl-verify-server-cert` and MySQL's `VERIFY_CA`/`VERIFY_IDENTITY` check
/// the address the client dials — so certificate verification cannot be honored
/// through a tunnel. Rather than silently degrade a verify mode to
/// encryption-only, a tunnelled endpoint with a verify mode is refused; an
/// explicit `require` (or a managed host's default) still encrypts.
///
/// Otherwise the connection's own `ssl_mode` decides, with managed hosts
/// (`*.psdb.cloud`, `*.supabase.co`, `*.neon.tech`) defaulting to `require` so
/// pre-fix saved connections keep working. An unrecognized mode is an error.
pub fn mysql_cli_tls_mode(
    original_host: &str,
    ssl_mode: Option<&str>,
    via_tunnel: bool,
) -> Result<Option<String>, String> {
    if via_tunnel {
        let mode = crate::db::tls::parse_ssl_mode(ssl_mode)?;
        if mode.is_some_and(crate::db::tls::SslMode::verifies_certificate) {
            return Err(format!(
                "{} through an SSH tunnel cannot verify the certificate for {original_host}: the MySQL client tools verify the address they dial, which is the tunnel's loopback endpoint. Use require to encrypt through the tunnel, or connect without the tunnel",
                mode.map(|m| m.as_str()).unwrap_or_default()
            ));
        }
        return Ok(Some("require".to_string()));
    }
    crate::db::tls::resolve_ssl_mode(original_host, ssl_mode)
}

/// Resolve (host, port, via_tunnel) for a MySQL connection, routing through the
/// SSH tunnel endpoint when present.
fn mysql_endpoint(
    state: &crate::AppState,
    connection_id: &str,
    conn: &crate::models::Connection,
) -> (String, i64, bool) {
    let via_tunnel = state
        .ssh_manager
        .lock()
        .unwrap()
        .get_local_port(connection_id);
    if let Some(port) = via_tunnel {
        return ("127.0.0.1".into(), port as i64, true);
    }
    (conn.host.clone(), conn.port.unwrap_or(3306), false)
}

/// Advisory server version for the compatibility check. Fail-open by design:
/// any error (TLS, SSH tunnel, auth) returns `None`, and the dump proceeds.
async fn mysql_server_version(
    host: &str,
    port: i64,
    via_tunnel: bool,
    conn: &crate::models::Connection,
    password: &str,
) -> Option<String> {
    let database = conn.database.clone().unwrap_or_default();
    let original_host = conn.host.clone();
    let ssl_mode = conn.ssl_mode.clone();
    let ssl_ca = conn.ssl_ca_path.clone();
    let username = conn.username.clone().unwrap_or_else(|| "root".into());
    let mut c = crate::commands::db_viewer::open_mysql_connection(
        host,
        port as u16,
        &username,
        password,
        &database,
        &original_host,
        ssl_mode.as_deref(),
        ssl_ca.as_deref(),
        via_tunnel,
    )
    .await
    .ok()?;
    sqlx::query_scalar::<_, String>("SELECT VERSION()")
        .fetch_one(&mut c)
        .await
        .ok()
}

/// Emit the advisory warning when the resolved dump client is clearly older
/// than the server. Never returns an error — the job always proceeds.
async fn maybe_emit_version_warning(
    app_handle: &AppHandle,
    job_id: &str,
    resolution: &ToolResolution,
    server_version: Option<String>,
) {
    let (Some(client_version), Some(tool)) = (&resolution.version, &resolution.resolved) else {
        return;
    };
    let Some(server_version) = server_version else {
        return;
    };
    let Some(warning) = tool_resolver::warning_for(client_version, &server_version, &tool.name)
    else {
        return;
    };
    let _ = app_handle.emit(
        "backup-progress",
        BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "running".into(),
            progress: Some(0.0),
            output_line: None,
            error: None,
            warning: Some(warning),
        },
    );
}

#[tauri::command]
pub async fn mysql_dump(
    connection_id: String,
    options: MySqlDumpOptions,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    let password = tool_password(&state, &app_handle, &connection_id, conn.use_keychain)?;

    let (host, port, via_tunnel) = mysql_endpoint(&state, &connection_id, &conn);
    // Advisory client/server compatibility check — never blocks the job, and
    // only pays for a connection when the resolved client reported a version.
    let dump_resolution = resolve_request(&app_handle, &tool_resolver::mysql_dump_request(), false);
    let server_version = if dump_resolution.version.is_some() {
        mysql_server_version(&host, port, via_tunnel, &conn, &password).await
    } else {
        None
    };
    maybe_emit_version_warning(&app_handle, &job_id, &dump_resolution, server_version).await;
    let params = MySqlConnParams::new(
        host,
        port,
        conn.username.clone().unwrap_or_else(|| "root".into()),
        options.database.clone(),
        password,
    );
    let tools = resolve_mysql_tool_paths(&app_handle);
    // Honour the connection's own ssl_mode; a verify mode through a tunnel is
    // refused rather than silently weakened to encryption-only.
    let tls = mysql_cli_tls_mode(&conn.host, conn.ssl_mode.as_deref(), via_tunnel)
        .map_err(|e| sanitize_error(&e))?;

    // Authorize the write last: the granted path is the only destination this
    // command can be made to use, and a grant is not spent on a request that
    // fails before the job starts.
    let options = options.with_output_path(resolve_backup_output(&state.file_grants, &file_grant)?);

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_mysql_dump_managed(&job, &params, &options, &tools, tls.as_deref());
        jobs.finish(&job_id_clone);
        emit_job_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn mysql_restore(
    connection_id: String,
    request: MySqlRestoreRequest,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    let password = tool_password(&state, &app_handle, &connection_id, conn.use_keychain)?;

    // Authorize the read before the file is opened: the granted path is the
    // only input this command can be made to use.
    let options = request.with_source_path(resolve_restore_input(&state.file_grants, &file_grant)?);

    let (host, port, via_tunnel) = mysql_endpoint(&state, &connection_id, &conn);

    // Read the dump **once**. Statements borrow from this buffer
    // (`db::mysql_script`), so the restore never holds a second copy of the
    // script; the buffer is moved into the job that consumes it.
    let script = {
        let bytes = std::fs::metadata(&options.file_path)
            .map_err(|e| format!("Cannot read restore file: {e}"))?
            .len();
        check_restore_file_size(bytes, MAX_RESTORE_FILE_BYTES)?;
        std::fs::read_to_string(&options.file_path)
            .map_err(|e| format!("Cannot read restore file: {e}"))?
    };

    let database = options.database.clone();
    let clean = options.clean;
    let original_host = conn.host.clone();
    let ssl_mode = conn.ssl_mode.clone();
    let ssl_ca = conn.ssl_ca_path.clone();
    let username = conn.username.clone().unwrap_or_else(|| "root".into());

    // Real cancellation: a per-restore flag that the existing `cancel_query`
    // command sets, plus the restore session's MySQL thread id registered so
    // `KILL QUERY` aborts the in-flight statement. Cleared before each run so a
    // stale request from a previous operation cannot abort this one.
    let cancel_flag = state.cancel_registry.cancel_flag(&connection_id);
    cancel_flag.store(false, std::sync::atomic::Ordering::SeqCst);

    let cancel_opts = crate::commands::db_viewer::mysql_connect_options(
        &host,
        port as u16,
        &username,
        &password,
        &database,
        &original_host,
        ssl_mode.as_deref(),
        ssl_ca.as_deref(),
        via_tunnel,
    )
    // A mode this engine cannot honor (unknown, or verify-full through a
    // tunnel) is refused before the restore starts, not silently weakened.
    .map_err(|e| sanitize_error(&e))?;

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let connection_id_for_cancel = connection_id.clone();
    // The restore has no child processes, but it is still an owned job: the
    // generic `cancel_tool_job` request, app exit, and the connection-scoped
    // `cancel_query` all stop it through the same flag.
    let restore_job = state.jobs.begin(&job_id);
    restore_job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();

    tokio::spawn(async move {
        let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let mut emit_progress = |done: usize, total: usize| {
            // Throttle: a 50k-statement dump must not flood the IPC channel.
            if last_emit.elapsed() < std::time::Duration::from_millis(200) && done < total {
                return;
            }
            last_emit = std::time::Instant::now();
            let _ = app_handle_clone.emit(
                "backup-progress",
                BackupProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "running".into(),
                    progress: Some(done as f64 / total.max(1) as f64),
                    output_line: Some(format!("Statement {done} of {total}")),
                    error: None,
                    warning: None,
                },
            );
        };

        let is_cancelled = {
            let flag = cancel_flag.clone();
            let job = restore_job.clone();
            move || flag.load(std::sync::atomic::Ordering::SeqCst) || job.is_cancelled()
        };

        let result = async {
            // Split before connecting: a script over the statement budget fails
            // without ever opening a session. Statements borrow from `script`.
            let statements = parse_mysql_restore_script(&script)?;

            let mut mconn = crate::commands::db_viewer::open_mysql_connection(
                &host,
                port as u16,
                &username,
                &password,
                &database,
                &original_host,
                ssl_mode.as_deref(),
                ssl_ca.as_deref(),
                via_tunnel,
            )
            .await?;

            // Register the restore session so the UI's `cancel_query` can
            // `KILL QUERY` it (mirrors how browsing registers pooled conns).
            // The registry is reached through the app handle because it is not
            // `Clone`.
            let registry = app_handle_clone.state::<crate::AppState>();
            let restore_conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
                .fetch_one(&mut mconn)
                .await
                .unwrap_or(-1);
            registry.cancel_registry.set_mysql(
                &connection_id_for_cancel,
                crate::cancel::MySqlCancel {
                    conn_id: Some(restore_conn_id),
                    connect_options: cancel_opts,
                },
            );

            let r = run_mysql_restore_on(
                &mut mconn,
                MySqlRestoreRun {
                    database: &database,
                    statements: &statements,
                    clean,
                },
                &mut emit_progress,
                &is_cancelled,
            )
            .await;

            registry
                .cancel_registry
                .set_mysql_conn_id(&connection_id_for_cancel, None);
            registry
                .cancel_registry
                .clear_cancelled(&connection_id_for_cancel);
            r
        }
        .await;

        jobs.finish(&job_id_clone);
        emit_job_result(
            &app_handle_clone,
            &job_id_clone,
            result.map_err(JobFailure::from_engine),
        );
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn mysql_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let connections = saved_connections(&state)?;
    let source_conn = require_connection(&connections, &options.source_connection_id)?;
    let target_conn = require_connection(&connections, &options.target_connection_id)?;

    // Each endpoint resolves its own credential; the refusal names the side
    // that still needs a session password.
    let src_password = tool_password(
        &state,
        &app_handle,
        &source_conn.id,
        source_conn.use_keychain,
    )?;
    let tgt_password = tool_password(
        &state,
        &app_handle,
        &target_conn.id,
        target_conn.use_keychain,
    )?;

    let (src_host, src_port, src_via_tunnel) =
        mysql_endpoint(&state, &source_conn.id, &source_conn);
    let (tgt_host, tgt_port, tgt_via_tunnel) =
        mysql_endpoint(&state, &target_conn.id, &target_conn);

    // Advisory client/server compatibility check — never blocks the job, and
    // only pays for a connection when the resolved client reported a version.
    let dump_resolution = resolve_request(&app_handle, &tool_resolver::mysql_dump_request(), false);
    let server_version = if dump_resolution.version.is_some() {
        mysql_server_version(
            &src_host,
            src_port,
            src_via_tunnel,
            &source_conn,
            &src_password,
        )
        .await
    } else {
        None
    };
    maybe_emit_version_warning(&app_handle, &job_id, &dump_resolution, server_version).await;

    let source = MySqlConnParams::new(
        src_host,
        src_port,
        source_conn
            .username
            .clone()
            .unwrap_or_else(|| "root".into()),
        source_conn
            .database
            .clone()
            .unwrap_or_else(|| "mysql".into()),
        src_password,
    );
    let target = MySqlConnParams::new(
        tgt_host,
        tgt_port,
        target_conn
            .username
            .clone()
            .unwrap_or_else(|| "root".into()),
        target_conn
            .database
            .clone()
            .unwrap_or_else(|| "mysql".into()),
        tgt_password,
    );

    let tools = resolve_mysql_tool_paths(&app_handle);
    // Each endpoint gets its OWN mode: one side being tunnelled says nothing
    // about the other, and a managed host defaults to `require`.
    let src_tls = mysql_cli_tls_mode(
        &source_conn.host,
        source_conn.ssl_mode.as_deref(),
        src_via_tunnel,
    )
    .map_err(|e| sanitize_error(&e))?;
    let tgt_tls = mysql_cli_tls_mode(
        &target_conn.host,
        target_conn.ssl_mode.as_deref(),
        tgt_via_tunnel,
    )
    .map_err(|e| sanitize_error(&e))?;

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(options.source_connection_id.clone()));
    let jobs = state.jobs.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_mysql_sync_managed(
            &job,
            &source,
            &target,
            &tools,
            src_tls.as_deref(),
            tgt_tls.as_deref(),
        );
        jobs.finish(&job_id_clone);
        emit_job_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// SQLite dump / restore / sync commands (v0.7.8) — the stored `conn.host` IS
// the SQLite file path; each command opens its own connection in the blocking
// task (the pool's SQLite handle is never touched).
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sqlite_dump(
    connection_id: String,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    let path = conn.host.clone();
    // The dump destination is the granted path, never a renderer string.
    let out_path = resolve_backup_output(&state.file_grants, &file_grant)?;
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();
    tokio::task::spawn_blocking(move || {
        let is_cancelled = {
            let job = job.clone();
            move || job.is_cancelled()
        };
        let result = (|| -> Result<(), String> {
            // Never the connection's own file, never a truncated destination:
            // the core resolves file identity, refuses the source, and publishes
            // the dump atomically (temp sibling + rename).
            dump_sqlite_to_path_cancellable(&path, &out_path, |_| {}, &is_cancelled)
        })();
        jobs.finish(&job_id_clone);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn sqlite_restore(
    connection_id: String,
    request: SqliteRestoreRequest,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = require_connection(&saved_connections(&state)?, &connection_id)?;

    let path = conn.host.clone();
    // The dump input is the granted path, never a renderer string.
    let options = request.with_source_path(resolve_restore_input(&state.file_grants, &file_grant)?);
    let in_path = options.file_path.clone();
    let clean = options.clean;
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(connection_id.clone()));
    let jobs = state.jobs.clone();
    tokio::task::spawn_blocking(move || {
        let is_cancelled = {
            let job = job.clone();
            move || job.is_cancelled()
        };
        let result = (|| -> Result<(), String> {
            let dst = Connection::open(&path).map_err(|e| format!("open target: {e}"))?;
            let text = std::fs::read_to_string(&in_path).map_err(|e| format!("read dump: {e}"))?;
            restore_sqlite_cancellable(&dst, &text, clean, &is_cancelled)
        })();
        jobs.finish(&job_id_clone);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn sqlite_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let connections = saved_connections(&state)?;
    let source_conn = require_connection(&connections, &options.source_connection_id)?;
    let target_conn = require_connection(&connections, &options.target_connection_id)?;
    let (source_path, target_path) = (source_conn.host, target_conn.host);

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let job = state.jobs.begin(&job_id);
    job.set_connection_id(Some(options.source_connection_id.clone()));
    let jobs = state.jobs.clone();
    tokio::task::spawn_blocking(move || {
        let is_cancelled = {
            let job = job.clone();
            move || job.is_cancelled()
        };
        let result = run_sqlite_sync_cancellable(&source_path, &target_path, &is_cancelled);
        jobs.finish(&job_id_clone);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Builds command-line args using hardcoded values for testing.
/// Mirrors the logic used by `pg_dump` and `pg_restore` commands.
#[cfg(test)]
pub(crate) fn build_args_for_test(
    tool: &str,
    dbname: &str,
    format: &str,
    file_path: &str,
    no_owner: bool,
    schema: Option<&str>,
    tables: Option<Vec<&str>>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--host=localhost".into(),
        "--port=5432".into(),
        "--username=postgres".into(),
        format!("--dbname={dbname}"),
    ];

    match format {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {} // "plain" is default
    }

    if no_owner {
        args.push("--no-owner".into());
    }

    if let Some(ref schema) = schema {
        args.push(format!("--schema={schema}"));
    }

    if let Some(ref tables) = tables {
        for t in tables {
            args.push(format!("--table={t}"));
        }
    }

    if tool == "pg_dump" {
        args.push(format!("--file={file_path}"));
    } else {
        // pg_restore
        args.push(file_path.into());
    }

    args
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
#[path = "backup.test.rs"]
mod tests;
