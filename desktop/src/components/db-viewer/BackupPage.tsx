import { useState, useEffect, useCallback, useRef } from "react";
import { Download, FolderOpen, HardDrive } from "lucide-react";
import { CopyButton } from "../ui/CopyButton";
import { BackupProgress } from "./BackupProgress";
import {
    FormRow,
    FormSectionHeader,
    inputClass,
    controlClass,
} from "./objects/formRow";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useConnectionStore } from "../../stores/connectionStore";
import {
    detectPgTools,
    pgDump,
    getSchemas,
    detectMysqlTools,
    mysqlDump,
    sqliteDump,
    selectFileForGrant,
} from "../../lib/commands";
import type { PgToolStatus, MySqlToolStatus, BackupJob } from "../../lib/types";
import type { FileFilter, FileGrant } from "../../lib/fileGrant";
import {
    FILE_GRANT_STATE,
    fileGrantErrorKind,
    fileGrantErrorMessage,
    type FileGrantErrorKind,
} from "../../lib/fileGrant";
import { isMysqlFamily } from "../../lib/dbCapabilities";
import { withSessionCredential } from "../../lib/sessionCredential";

interface BackupPageProps {
    connectionId: string;
}

type BackupFormat = "plain" | "custom" | "tar" | "directory";

const PG_INSTALL_INSTRUCTIONS: Record<string, string> = {
    darwin: "brew install libpq",
    linux: "sudo apt install postgresql-client  # Debian/Ubuntu\nsudo dnf install postgresql  # Fedora\nsudo pacman -S postgresql  # Arch",
    win32: "Download PostgreSQL installer from https://www.postgresql.org/download/windows/ and ensure pg_dump is in your PATH.",
};

const MYSQL_INSTALL_INSTRUCTIONS: Record<string, string> = {
    darwin: "brew install mysql-client",
    linux: "sudo apt install mysql-client  # Debian/Ubuntu\nsudo dnf install mysql  # Fedora\nsudo pacman -S mariadb  # Arch",
    win32: "Download MySQL installer from https://dev.mysql.com/downloads/installer/ and ensure mysqldump is in your PATH.",
};

function getPlatformInstructions(map: Record<string, string>): string {
    const platform =
        typeof navigator !== "undefined"
            ? navigator.platform.toLowerCase()
            : "";
    if (platform.includes("mac") || platform.includes("darwin"))
        return map.darwin;
    if (platform.includes("linux")) return map.linux;
    if (platform.includes("win")) return map.win32;
    return map.linux;
}

export function BackupPage({ connectionId }: BackupPageProps) {
    const connection = useConnectionStore((s) =>
        s.connections.find((c) => c.id === connectionId),
    );
    const dbType = connection?.db_type ?? "postgresql";
    const database = connection?.database ?? null;
    const isPg = dbType === "postgresql";
    const isMysql = isMysqlFamily(dbType);

    const [format, setFormat] = useState<BackupFormat>("custom");
    /**
     * The File Grant authorizing the write, plus the path it covers (display
     * only). Nothing typed into the UI can authorize a backup: without a grant
     * the Start button stays disabled.
     */
    const [grant, setGrant] = useState<FileGrant | null>(null);
    const [selectedPath, setSelectedPath] = useState("");
    /** A visible expired/consumed/invalid-grant state with its recovery action. */
    const [grantError, setGrantError] = useState<FileGrantErrorKind | null>(null);
    const [schema, setSchema] = useState("");
    const [noOwner, setNoOwner] = useState(true);
    const [singleTransaction, setSingleTransaction] = useState(true);
    const [noData, setNoData] = useState(false);
    const [routines, setRoutines] = useState(true);
    const [triggers, setTriggers] = useState(true);
    const [events, setEvents] = useState(false);
    const [pgToolStatus, setPgToolStatus] = useState<PgToolStatus | null>(null);
    const [mysqlToolStatus, setMysqlToolStatus] = useState<MySqlToolStatus | null>(null);
    const [checkingTools, setCheckingTools] = useState(true);
    const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);

    const activeJobId = useBackupStore((s) => s.activeJobId);
    const jobs = useBackupStore((s) => s.jobs);
    const notify = useNotificationStore((s) => s.notify);

    const activeJob = jobs.find((j) => j.id === activeJobId);
    const isRunning = activeJob?.status === "running";

    // Track our job ID so we only react to jobs we started
    const pendingJobRef = useRef<string | null>(null);

    // React to job completion/failure via store events
    useEffect(() => {
        if (!pendingJobRef.current || !activeJob) return;
        if (activeJob.id !== pendingJobRef.current) return;

        if (activeJob.status === "completed") {
            notify("Backup completed successfully", "success");
            pendingJobRef.current = null;
        } else if (activeJob.status === "failed") {
            notify(
                `Backup failed: ${activeJob.error_message || "Unknown error"}`,
                "error",
            );
            pendingJobRef.current = null;
        } else if (activeJob.status === "cancelled") {
            notify("Backup cancelled", "info");
            pendingJobRef.current = null;
        }
    }, [activeJob, notify]);

    const checkTools = useCallback(
        async (force: boolean) => {
            setCheckingTools(true);
            setPgToolStatus(null);
            setMysqlToolStatus(null);

            if (isPg) {
                try {
                    setPgToolStatus(await detectPgTools(force));
                } catch {
                    setPgToolStatus({
                        pg_dump_found: false,
                        pg_restore_found: false,
                        pg_dump_version: null,
                        pg_restore_version: null,
                        pg_dump_source: null,
                        pg_restore_source: null,
                    });
                } finally {
                    setCheckingTools(false);
                }
            } else if (isMysql) {
                try {
                    setMysqlToolStatus(await detectMysqlTools(force));
                } catch {
                    setMysqlToolStatus({
                        mysqldumpFound: false,
                        mysqlFound: false,
                        mysqldumpVersion: null,
                        mysqlVersion: null,
                        mysqldumpSource: null,
                        mysqlSource: null,
                    });
                } finally {
                    setCheckingTools(false);
                }
            } else {
                setCheckingTools(false);
            }
        },
        [isPg, isMysql],
    );

    useEffect(() => {
        setAvailableSchemas([]);
        void checkTools(false);
        if (isPg || isMysql) {
            getSchemas(connectionId)
                .then((schemas) => setAvailableSchemas(schemas))
                .catch(() => setAvailableSchemas([]));
        }
    }, [connectionId, isPg, isMysql, checkTools]);

    // The native dialog is brokered by Rust: the backend shows it and issues a
    // File Grant for whatever the user chose, so the path never originates in
    // the renderer. Same dialog, same suggested name and filters as before.
    const handlePickFile = useCallback(async () => {
        let defaultName = "backup";
        let extensions: string[] = [];

        if (isPg) {
            const pgExtensions: Record<BackupFormat, string[]> = {
                plain: ["sql"],
                custom: ["dump", "custom"],
                tar: ["tar"],
                directory: [],
            };
            extensions = pgExtensions[format];
            defaultName = `backup.${
                format === "custom"
                    ? "dump"
                    : format === "plain"
                      ? "sql"
                      : "tar"
            }`;
        } else if (isMysql) {
            extensions = ["sql"];
            defaultName = "backup.sql";
        } else {
            extensions = ["db", "sqlite", "sql"];
            defaultName = "backup.db";
        }

        const filters: FileFilter[] = [{ name: "Backup", extensions }];
        try {
            const picked = await selectFileForGrant({
                intent: "write",
                title: "Save backup as",
                defaultName,
                filters,
            });
            if (!picked) return; // cancelled: nothing to authorize
            setGrant(picked);
            setSelectedPath(picked.path);
            setGrantError(null);
        } catch (e) {
            const kind = fileGrantErrorKind(e);
            if (kind) setGrantError(kind);
            notify(fileGrantErrorMessage(e) ?? String(e), "error");
        }
    }, [format, isPg, isMysql, notify]);

    const runWithProgress = useCallback(
        async (type: BackupJob["type"], action: () => Promise<unknown>) => {
            // `runJob` adopts the job id the backend returns, so the progress
            // events and the cancel command address the real job.
            await useBackupStore.getState().runJob(type, action);
            pendingJobRef.current = useBackupStore.getState().activeJobId;
        },
        [],
    );

    // Cancel a running backup. The backend terminates the tool's whole process
    // tree, so nothing is left running behind the UI.
    const handleCancelBackup = useCallback(async () => {
        const jobId = useBackupStore.getState().activeJobId;
        if (!jobId) return;
        const cancelled = await useBackupStore.getState().cancelJob(jobId);
        if (!cancelled) {
            notify("The backup had already finished", "info");
        }
    }, [notify]);

    const handleStartBackup = useCallback(async () => {
        if (!grant) {
            notify("Please select an output file", "error");
            return;
        }
        if (isMysql && !database) {
            notify("MySQL connection has no database selected", "error");
            return;
        }

        // A grant is single-use: this selection is spent by the attempt, so the
        // next job must choose the file again (a replayed id is rejected).
        const grantId = grant.id;
        setGrant(null);

        await runWithProgress("dump", async () => {
            try {
                // A keychain-off connection supplies its session password
                // through a prompt if the backend does not have it yet. The
                // command resolves the credential before it consumes `grantId`,
                // so retrying with the same grant is safe.
                return await withSessionCredential(connectionId, async () => {
                    if (isPg) {
                        return await pgDump(
                            connectionId,
                            {
                                format,
                                schema: schema || undefined,
                                tables: undefined,
                                noOwner,
                            },
                            grantId,
                        );
                    }
                    if (isMysql) {
                        return await mysqlDump(
                            connectionId,
                            {
                                database: database!,
                                singleTransaction,
                                noData,
                                routines,
                                triggers,
                                events,
                            },
                            grantId,
                        );
                    }
                    return await sqliteDump(connectionId, grantId);
                });
            } catch (e) {
                const kind = fileGrantErrorKind(e);
                if (!kind) throw e;
                // Surface the grant state instead of a generic tool failure.
                setGrantError(kind);
                throw new Error(fileGrantErrorMessage(e) ?? String(e));
            }
        });
    }, [
        grant,
        database,
        isPg,
        isMysql,
        format,
        schema,
        noOwner,
        singleTransaction,
        noData,
        routines,
        triggers,
        events,
        connectionId,
        notify,
        runWithProgress,
    ]);

    // Retry after a failure: without a live grant the retry starts by choosing
    // the file again, because the previous selection is spent.
    const handleRetry = useCallback(() => {
        if (grant) {
            void handleStartBackup();
            return;
        }
        void handlePickFile();
    }, [grant, handleStartBackup, handlePickFile]);

    const toolsMissing = isPg
        ? pgToolStatus && !pgToolStatus.pg_dump_found
        : isMysql
          ? mysqlToolStatus && !mysqlToolStatus.mysqldumpFound
          : false;
    const toolsBundled = isPg
        ? pgToolStatus?.pg_dump_source === "bundled"
        : isMysql
          ? mysqlToolStatus?.mysqldumpSource === "bundled"
          : false;

    const dumpToolFound = isPg
        ? pgToolStatus?.pg_dump_found
        : mysqlToolStatus?.mysqldumpFound;
    const dumpSource = isPg
        ? pgToolStatus?.pg_dump_source
        : mysqlToolStatus?.mysqldumpSource;
    const dumpResolvedName = isPg
        ? pgToolStatus?.pg_dump_resolved_name
        : mysqlToolStatus?.mysqldumpResolvedName;
    const bundledPresent = isPg
        ? pgToolStatus?.pg_dump_bundled_available
        : mysqlToolStatus?.mysqldumpBundledAvailable;
    // A probe that timed out is a different failure from "not installed": the
    // tool exists but did not answer, so installing another copy will not help.
    const probeError = isPg
        ? pgToolStatus?.pg_dump_probe_error
        : mysqlToolStatus?.mysqldumpProbeError;
    const dumpFallbackName = isPg ? "pg_dump" : "mysqldump";
    const installInstructions = getPlatformInstructions(
        isPg ? PG_INSTALL_INSTRUCTIONS : MYSQL_INSTALL_INSTRUCTIONS,
    );

    const checkingMessage = isPg
        ? "Checking for pg_dump..."
        : isMysql
          ? "Checking for mysqldump..."
          : null;

    const headerDescription = isPg
        ? "Create a database backup via pg_dump"
        : isMysql
          ? "Create a database backup via mysqldump"
          : "Create a database backup";

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <HardDrive size={14} className="text-accent" />
                    <span className="text-xs font-medium text-text">Backup</span>
                    <span className="text-[11px] text-text-muted">
                        {headerDescription}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {(isPg || isMysql) && (
                        <button
                            type="button"
                            onClick={() => void checkTools(true)}
                            className="text-[11px] text-text-muted hover:text-text transition-colors cursor-pointer"
                        >
                            Check again
                        </button>
                    )}
                    {!checkingTools && !toolsMissing && (
                        <button
                            type="button"
                            onClick={() => void handleStartBackup()}
                            disabled={isRunning || !grant}
                            className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                            <Download size={14} className="mr-1.5" />
                            {isRunning ? "Backing up..." : "Start Backup"}
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {/* File Grant state: expired, already used, or missing. Each has
                    a recovery action, so the flow never fails only in logs. */}
                {grantError && (
                    <div
                        data-testid={`file-grant-${grantError}`}
                        role="alert"
                        className="flex items-start justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3"
                    >
                        <div className="min-w-0 space-y-1">
                            <p className="text-sm font-semibold text-amber-300">
                                {FILE_GRANT_STATE[grantError].title}
                            </p>
                            <p className="text-xs leading-relaxed text-amber-200/80">
                                {FILE_GRANT_STATE[grantError].detail}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void handlePickFile()}
                            className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer"
                        >
                            Choose file
                        </button>
                    </div>
                )}
                {/* Tool check */}
                {checkingTools && checkingMessage && (
                    <div className="px-4 py-3 text-sm text-text-muted">
                        {checkingMessage}
                    </div>
                )}

                {toolsMissing && !toolsBundled && (
                    <div className="border-b border-border bg-amber-500/10 px-4 py-3 space-y-2">
                        <p className="text-amber-300 text-sm font-semibold">
                            {isPg ? "pg_dump not found" : "mysqldump not found"}
                        </p>
                        <p className="text-amber-200/80 text-xs leading-relaxed">
                            Gridline ships its own {isPg ? "PostgreSQL" : "MySQL"} client
                            tools. This build could not locate or run them, so a manual
                            install is needed:
                        </p>
                        {probeError && (
                            <p
                                data-testid="tool-probe-error"
                                className="text-amber-200/80 text-xs leading-relaxed font-mono break-all"
                            >
                                {probeError}
                            </p>
                        )}
                        {bundledPresent && (
                            <p className="text-amber-200/80 text-xs leading-relaxed">
                                A bundled copy is present but could not run — reinstall
                                Gridline, or install the tools below.
                            </p>
                        )}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-amber-200/60">Install</span>
                                <CopyButton
                                    text={installInstructions}
                                    className="text-amber-200/70 hover:text-amber-100"
                                />
                            </div>
                            <pre className="text-xs text-amber-100 bg-amber-500/10 p-3 whitespace-pre-wrap font-mono leading-relaxed">
                                {installInstructions}
                            </pre>
                        </div>
                    </div>
                )}

                {!checkingTools && !toolsMissing && (
                    <>
                        {dumpToolFound && (
                            <FormRow label="Tool">
                                <span className="px-3 font-heading text-xs text-text">
                                    Using {dumpSource === "bundled" ? "bundled" : "system"}{" "}
                                    {dumpResolvedName ?? dumpFallbackName}
                                </span>
                            </FormRow>
                        )}

                        {/* Format */}
                        {isPg ? (
                            <FormRow label="Format">
                                <select
                                    value={format}
                                    onChange={(e) =>
                                        setFormat(e.target.value as BackupFormat)
                                    }
                                    className={`${controlClass} mr-3`}
                                >
                                    <option value="custom">Custom Archive</option>
                                    <option value="plain">Plain SQL</option>
                                    <option value="tar">Tarball</option>
                                    <option value="directory">Directory</option>
                                </select>
                            </FormRow>
                        ) : isMysql ? (
                            <FormRow label="Format">
                                <span className="px-3 font-heading text-xs text-text">
                                    Plain SQL
                                </span>
                            </FormRow>
                        ) : null}

                        {/* Output file. Display only: the write is authorized by
                            the File Grant behind it, so the field is read-only
                            and Start stays disabled until a file is chosen. */}
                        <FormRow label="Output file">
                            <input
                                type="text"
                                value={selectedPath}
                                readOnly
                                aria-label="Output file"
                                data-testid="backup-output-path"
                                placeholder="Choose an output file…"
                                title="Chosen with Browse — the path alone does not authorize a write"
                                className={inputClass}
                            />
                            <button
                                type="button"
                                onClick={handlePickFile}
                                aria-label="Browse for file"
                                className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-raised hover:border-border-hover transition-colors cursor-pointer"
                            >
                                <FolderOpen size={13} />
                            </button>
                        </FormRow>

                        {/* Schema */}
                        {(isPg || isMysql) && (
                            <FormRow label="Schema">
                                <select
                                    value={schema}
                                    onChange={(e) => setSchema(e.target.value)}
                                    className={`${controlClass} mr-3`}
                                >
                                    <option value="">All schemas</option>
                                    {availableSchemas.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </FormRow>
                        )}

                        {(isPg || isMysql) && (
                            <FormSectionHeader label="Options" />
                        )}

                        {/* PostgreSQL: no-owner toggle */}
                        {isPg && (
                            <FormRow label="No owner">
                                <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={noOwner}
                                        onChange={(e) => setNoOwner(e.target.checked)}
                                        className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                    />
                                    <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                        --no-owner
                                    </code>
                                </label>
                            </FormRow>
                        )}

                        {/* MySQL: option toggles */}
                        {isMysql && (
                            <>
                                <FormRow label="Single transaction">
                                    <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={singleTransaction}
                                            onChange={(e) =>
                                                setSingleTransaction(e.target.checked)
                                            }
                                            className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                            --single-transaction
                                        </code>
                                    </label>
                                </FormRow>
                                <FormRow label="No data">
                                    <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={noData}
                                            onChange={(e) => setNoData(e.target.checked)}
                                            className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                            --no-data
                                        </code>
                                    </label>
                                </FormRow>
                                <FormRow label="Routines">
                                    <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={routines}
                                            onChange={(e) => setRoutines(e.target.checked)}
                                            className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                            --routines
                                        </code>
                                    </label>
                                </FormRow>
                                <FormRow label="Triggers">
                                    <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={triggers}
                                            onChange={(e) => setTriggers(e.target.checked)}
                                            className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                            --triggers
                                        </code>
                                    </label>
                                </FormRow>
                                <FormRow label="Events">
                                    <label className="flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={events}
                                            onChange={(e) => setEvents(e.target.checked)}
                                            className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                            --events
                                        </code>
                                    </label>
                                </FormRow>
                            </>
                        )}

                        {/* Progress */}
                        {activeJob && (
                            <div className="px-4 py-3">
                                <BackupProgress
                                    progress={activeJob.status === "completed" ? 100 : 50}
                                    jobType="dump"
                                    status={activeJob.status}
                                    errorMessage={activeJob.error_message ?? undefined}
                                    onCancel={
                                        isRunning ? () => void handleCancelBackup() : undefined
                                    }
                                    onRetry={!isRunning ? handleRetry : undefined}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}