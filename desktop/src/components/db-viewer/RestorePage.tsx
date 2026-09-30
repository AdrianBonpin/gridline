import { useState, useEffect, useCallback, useRef } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
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
    pgRestore,
    getSchemas,
    mysqlRestore,
    sqliteRestore,
} from "../../lib/commands";
import type { PgToolStatus, BackupJob } from "../../lib/types";

interface RestorePageProps {
    connectionId: string;
}

const PG_INSTALL_INSTRUCTIONS: Record<string, string> = {
    darwin: "brew install libpq",
    linux: "sudo apt install postgresql-client  # Debian/Ubuntu\nsudo dnf install postgresql  # Fedora\nsudo pacman -S postgresql  # Arch",
    win32: "Download PostgreSQL installer from https://www.postgresql.org/download/windows/ and ensure pg_restore is in your PATH.",
};

const MYSQL_INSTALL_INSTRUCTIONS: Record<string, string> = {
    darwin: "brew install mysql-client",
    linux: "sudo apt install mysql-client  # Debian/Ubuntu\nsudo dnf install mysql  # Fedora\nsudo pacman -S mariadb  # Arch",
    win32: "Download MySQL installer from https://dev.mysql.com/downloads/installer/ and ensure mysql is in your PATH.",
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

export function RestorePage({ connectionId }: RestorePageProps) {
    const connection = useConnectionStore((s) =>
        s.connections.find((c) => c.id === connectionId),
    );
    const dbType = connection?.db_type ?? "postgresql";
    const database = connection?.database ?? null;
    const isPg = dbType === "postgresql";
    const isMysql = dbType === "mysql";
    const isSqlite = dbType === "sqlite";

    const [filePath, setFilePath] = useState("");
    const [format, setFormat] = useState("custom");
    const [clean, setClean] = useState(true);
    const [schema, setSchema] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [pgToolStatus, setPgToolStatus] = useState<PgToolStatus | null>(null);
    const [checkingTools, setCheckingTools] = useState(true);
    const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);

    const activeJobId = useBackupStore((s) => s.activeJobId);
    const jobs = useBackupStore((s) => s.jobs);
    const startJob = useBackupStore((s) => s.startJob);
    const notify = useNotificationStore((s) => s.notify);

    const activeJob = jobs.find((j) => j.id === activeJobId);
    const isRunning = activeJob?.status === "running";
    const pendingJobRef = useRef<string | null>(null);

    useEffect(() => {
        if (!pendingJobRef.current || !activeJob) return;
        if (activeJob.id !== pendingJobRef.current) return;

        if (activeJob.status === "completed") {
            notify("Restore completed successfully", "success");
            pendingJobRef.current = null;
        } else if (activeJob.status === "failed") {
            notify(
                `Restore failed: ${activeJob.error_message || "Unknown error"}`,
                "error",
            );
            pendingJobRef.current = null;
        }
    }, [activeJob, notify]);

    useEffect(() => {
        setCheckingTools(true);
        setConfirmed(false);
        setPgToolStatus(null);
        setAvailableSchemas([]);

        if (isPg) {
            detectPgTools()
                .then((status) => setPgToolStatus(status))
                .catch(() =>
                    setPgToolStatus({
                        pg_dump_found: false,
                        pg_restore_found: false,
                        pg_dump_version: null,
                        pg_restore_version: null,
                        pg_dump_source: null,
                        pg_restore_source: null,
                    }),
                )
                .finally(() => setCheckingTools(false));

            getSchemas(connectionId)
                .then((schemas) => setAvailableSchemas(schemas))
                .catch(() => setAvailableSchemas([]));
        } else if (isMysql) {
            // MySQL restore runs in-process over the sqlx driver connection, so
            // there is no client to probe for or wait on here (Backup/Sync
            // still probe via detectMysqlTools for mysqldump).
            setCheckingTools(false);

            getSchemas(connectionId)
                .then((schemas) => setAvailableSchemas(schemas))
                .catch(() => setAvailableSchemas([]));
        } else {
            setCheckingTools(false);
        }
    }, [connectionId, isPg, isMysql]);

    const handlePickFile = useCallback(async () => {
        const extensions = isPg
            ? ["dump", "sql", "tar", "custom", "gz"]
            : isMysql
              ? ["sql"]
              : ["db", "sqlite", "sql"];

        const picked = await open({
            multiple: false,
            filters: [
                {
                    name: "Backup Files",
                    extensions,
                },
            ],
        });
        if (picked && typeof picked === "string") setFilePath(picked);
    }, [isPg, isMysql, isSqlite]);

    const runWithProgress = useCallback(
        async (type: BackupJob["type"], action: () => Promise<unknown>) => {
            const jobId = `${type}-${Date.now()}`;
            startJob(jobId, type);
            pendingJobRef.current = jobId;

            try {
                await action();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                useBackupStore.getState().failJob(jobId, msg);
            }
        },
        [startJob],
    );

    const handleStartRestore = useCallback(async () => {
        if (!filePath) {
            notify("Please select a file path", "error");
            return;
        }
        if (isMysql && !database) {
            notify("MySQL connection has no database selected", "error");
            return;
        }

        await runWithProgress("restore", () => {
            if (isPg) {
                return pgRestore(connectionId, {
                    format,
                    filePath,
                    clean,
                    schema: schema || undefined,
                });
            }
            if (isMysql) {
                return mysqlRestore(connectionId, {
                    database: database!,
                    filePath,
                    clean,
                });
            }
            return sqliteRestore(connectionId, { filePath, clean });
        });
    }, [
        filePath,
        database,
        isPg,
        isMysql,
        isSqlite,
        format,
        clean,
        schema,
        connectionId,
        notify,
        runWithProgress,
    ]);

    // pg_restore is still required for PostgreSQL. MySQL restore runs in-process
    // via the sqlx driver, so a missing mariadb/mysql client must not gate it —
    // that client could never authenticate to MySQL 8 anyway (#41 follow-up).
    const toolsMissing = isPg
        ? pgToolStatus && !pgToolStatus.pg_restore_found
        : false;
    const toolsBundled = isPg
        ? pgToolStatus?.pg_restore_source === "bundled"
        : false;
    const canStart = filePath && confirmed && !isRunning;
    const installInstructions = getPlatformInstructions(
        isPg ? PG_INSTALL_INSTRUCTIONS : MYSQL_INSTALL_INSTRUCTIONS,
    );

    const checkingMessage = isPg
        ? "Checking for pg_restore..."
        : isMysql
          ? "Checking for mysql..."
          : null;

    const headerDescription = isPg
        ? "Restore a database from a backup file"
        : isMysql
          ? "Restore a database from a SQL dump"
          : "Restore a database from a backup file";

    const cleanDisabled = isPg && format === "plain";
    const restoreToolResolvedName =
        pgToolStatus?.pg_restore_resolved_name ?? "pg_restore";

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Upload size={14} className="text-accent" />
                    <span className="text-xs font-medium text-text">Restore</span>
                    <span className="text-[11px] text-text-muted">
                        {headerDescription}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {!checkingTools && !toolsMissing && (
                        <button
                            type="button"
                            onClick={() => void handleStartRestore()}
                            disabled={!canStart}
                            className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                            <Upload size={14} className="mr-1.5" />
                            {isRunning ? "Restoring..." : "Start Restore"}
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {/* Tool check */}
                {checkingTools && checkingMessage && (
                    <div className="px-4 py-3 text-sm text-text-muted">
                        {checkingMessage}
                    </div>
                )}

                {toolsMissing && !toolsBundled && (
                    <div className="border-b border-border bg-amber-500/10 px-4 py-3 space-y-2">
                        <p className="text-amber-300 text-sm font-semibold">
                            {isPg ? "pg_restore not found" : "mysql client not found"}
                        </p>
                        <p className="text-amber-200/80 text-xs leading-relaxed">
                            Gridline ships its own {isPg ? "PostgreSQL" : "MySQL"}{" "}
                            client tools. This build could not locate or run them, so
                            a manual install is needed:
                        </p>
                        {pgToolStatus?.pg_restore_bundled_available && (
                            <p className="text-amber-200/80 text-xs leading-relaxed">
                                A bundled copy is present but could not run — reinstall
                                Gridline, or install the tools below.
                            </p>
                        )}
                        <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-amber-200/60">
                                    Install
                                </span>
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
                        {/* Restore tool */}
                        {isPg && pgToolStatus?.pg_restore_found && (
                            <FormRow label="Tool">
                                <span className="px-3 font-heading text-xs text-text">
                                    Using{" "}
                                    {pgToolStatus.pg_restore_source === "bundled"
                                        ? "bundled"
                                        : "system"}{" "}
                                    {restoreToolResolvedName}
                                </span>
                            </FormRow>
                        )}

                        {isMysql && (
                            <FormRow label="Tool">
                                <span className="px-3 font-heading text-xs text-text">
                                    Restores run in-process over the driver connection —
                                    no MySQL client installation required
                                </span>
                            </FormRow>
                        )}

                        {/* Format (PostgreSQL only) */}
                        {isPg && (
                            <FormRow label="Format">
                                <select
                                    value={format}
                                    onChange={(e) => setFormat(e.target.value)}
                                    className={`${controlClass} mr-3`}
                                >
                                    <option value="custom">Custom Archive</option>
                                    <option value="plain">Plain SQL</option>
                                    <option value="tar">Tarball</option>
                                    <option value="directory">Directory</option>
                                </select>
                            </FormRow>
                        )}

                        {/* Backup file */}
                        <FormRow label="Backup file">
                            <input
                                type="text"
                                value={filePath}
                                onChange={(e) => setFilePath(e.target.value)}
                                placeholder="/path/to/backup.dump"
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

                        {/* Schema (optional) */}
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

                        <FormSectionHeader label="Options" />

                        {/* Clean toggle */}
                        <FormRow label="Clean">
                            <label
                                className={`flex w-full items-center gap-2.5 px-3 py-2 cursor-pointer group ${
                                    cleanDisabled
                                        ? "opacity-40 pointer-events-none"
                                        : ""
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={clean}
                                    onChange={(e) => setClean(e.target.checked)}
                                    disabled={cleanDisabled}
                                    className="bg-surface border-border accent-accent w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                                />
                                <code className="text-[11px] text-text-muted/60 bg-surface-raised px-1.5 py-0.5">
                                    {isMysql
                                        ? "drops only the objects this file defines"
                                        : "DROP before CREATE"}
                                </code>
                            </label>
                        </FormRow>

                        {isPg && format === "plain" && (
                            <div className="border-b border-border px-4 py-2 text-[11px] text-text-muted/70">
                                Plain SQL restores run via psql and don't support
                                DROP-before-CREATE. Use Custom Archive for clean
                                restores.
                            </div>
                        )}

                        {/* Destructive confirmation */}
                        <div className="border-b border-border bg-red-500/5 px-4 py-3 space-y-2">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    onChange={(e) => setConfirmed(e.target.checked)}
                                    className="mt-0.5 bg-surface border-border accent-red-500 w-4 h-4 cursor-pointer"
                                    data-testid="restore-confirm-checkbox"
                                />
                                <span className="text-sm text-red-300/90 leading-relaxed">
                                    I understand this will overwrite data on the target
                                    database. This action cannot be undone.
                                </span>
                            </label>
                            {isMysql && (
                                <p className="text-[11px] text-red-400/80">
                                    MySQL DDL commits as it runs and can't be rolled
                                    back — a failed restore may leave this database
                                    partially applied.
                                </p>
                            )}
                        </div>

                        {/* Progress */}
                        {activeJob && (
                            <div className="px-4 py-3">
                                <BackupProgress
                                    progress={activeJob.status === "completed" ? 100 : 50}
                                    jobType="restore"
                                    status={activeJob.status}
                                    errorMessage={activeJob.error_message ?? undefined}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
