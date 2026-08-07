import { useState, useEffect, useCallback, useRef } from "react";
import { Download, FolderOpen, HardDrive } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
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
} from "../../lib/commands";
import type { PgToolStatus, MySqlToolStatus, BackupJob } from "../../lib/types";

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
    const isMysql = dbType === "mysql";
    const isSqlite = dbType === "sqlite";

    const [format, setFormat] = useState<BackupFormat>("custom");
    const [filePath, setFilePath] = useState("");
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
    const startJob = useBackupStore((s) => s.startJob);
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
        }
    }, [activeJob, notify]);

    useEffect(() => {
        setCheckingTools(true);
        setPgToolStatus(null);
        setMysqlToolStatus(null);
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
            detectMysqlTools()
                .then((status) => setMysqlToolStatus(status))
                .catch(() =>
                    setMysqlToolStatus({
                        mysqldumpFound: false,
                        mysqlFound: false,
                        mysqldumpVersion: null,
                        mysqlVersion: null,
                        mysqldumpSource: null,
                        mysqlSource: null,
                    }),
                )
                .finally(() => setCheckingTools(false));

            getSchemas(connectionId)
                .then((schemas) => setAvailableSchemas(schemas))
                .catch(() => setAvailableSchemas([]));
        } else {
            setCheckingTools(false);
        }
    }, [connectionId, isPg, isMysql]);

    const handlePickFile = useCallback(async () => {
        let defaultPath = "backup";
        let extensions: string[] = [];

        if (isPg) {
            const pgExtensions: Record<BackupFormat, string[]> = {
                plain: ["sql"],
                custom: ["dump", "custom"],
                tar: ["tar"],
                directory: [],
            };
            extensions = pgExtensions[format];
            defaultPath = `backup.${
                format === "custom"
                    ? "dump"
                    : format === "plain"
                      ? "sql"
                      : "tar"
            }`;
        } else if (isMysql) {
            extensions = ["sql"];
            defaultPath = "backup.sql";
        } else {
            extensions = ["db", "sqlite", "sql"];
            defaultPath = "backup.db";
        }

        const picked = await save({
            defaultPath,
            filters: [{ name: "Backup", extensions }],
        });
        if (picked) setFilePath(picked);
    }, [format, isPg, isMysql, isSqlite]);

    const runWithProgress = useCallback(
        async (type: BackupJob["type"], action: () => Promise<unknown>) => {
            const jobId = `${type}-${Date.now()}`;
            startJob(jobId, type);
            pendingJobRef.current = jobId;

            try {
                // Command returns the job ID immediately — completion
                // comes via Tauri events handled by the backupStore
                await action();
            } catch (e) {
                // If the command itself fails (e.g. connection not found),
                // the event won't fire — handle here
                const msg = e instanceof Error ? e.message : String(e);
                useBackupStore.getState().failJob(jobId, msg);
            }
        },
        [startJob],
    );

    const handleStartBackup = useCallback(async () => {
        if (!filePath) {
            notify("Please select a file path", "error");
            return;
        }
        if (isMysql && !database) {
            notify("MySQL connection has no database selected", "error");
            return;
        }

        await runWithProgress("dump", () => {
            if (isPg) {
                return pgDump(connectionId, {
                    format,
                    filePath,
                    schema: schema || undefined,
                    tables: undefined,
                    noOwner,
                });
            }
            if (isMysql) {
                return mysqlDump(connectionId, {
                    database: database!,
                    filePath,
                    singleTransaction,
                    noData,
                    routines,
                    triggers,
                    events,
                });
            }
            return sqliteDump(connectionId, { filePath });
        });
    }, [
        filePath,
        database,
        isPg,
        isMysql,
        isSqlite,
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
        <div className="flex flex-col h-full">
            {/* Toolbar header */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <HardDrive size={14} className="text-accent" />
                <span className="text-xs font-medium text-text">Backup</span>
                <span className="text-[11px] text-text-muted">
                    {headerDescription}
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-lg mx-auto space-y-6 outline outline-border">
                    {/* Tool check */}
                    {checkingTools && checkingMessage && (
                        <div className="glass p-4 text-center">
                            <p className="text-sm text-text-muted">
                                {checkingMessage}
                            </p>
                        </div>
                    )}

                    {toolsMissing && !toolsBundled && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-4 space-y-2">
                            <p className="text-amber-300 text-sm font-semibold">
                                {isPg ? "pg_dump not found" : "mysqldump not found"}
                            </p>
                            <p className="text-amber-200/80 text-xs leading-relaxed">
                                The {isPg ? "PostgreSQL" : "MySQL"} client tools are required for
                                backup/restore operations. Install them using:
                            </p>
                            <pre className="text-xs text-amber-100 bg-amber-500/10 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">
                                {getPlatformInstructions(
                                    isPg
                                        ? PG_INSTALL_INSTRUCTIONS
                                        : MYSQL_INSTALL_INSTRUCTIONS,
                                )}
                            </pre>
                        </div>
                    )}

                    {!checkingTools && !toolsMissing && (
                        <>
                            {/* Configuration card */}
                            <div className="p-5 space-y-5">
                                {/* Format */}
                                {isPg ? (
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                            Format
                                        </label>
                                        <select
                                            value={format}
                                            onChange={(e) =>
                                                setFormat(
                                                    e.target.value as BackupFormat,
                                                )
                                            }
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
                                        >
                                            <option value="custom">
                                                Custom Archive
                                            </option>
                                            <option value="plain">Plain SQL</option>
                                            <option value="tar">Tarball</option>
                                            <option value="directory">
                                                Directory
                                            </option>
                                        </select>
                                    </div>
                                ) : isMysql ? (
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                            Format
                                        </label>
                                        <div className="text-sm text-text py-2">
                                            Plain SQL
                                        </div>
                                    </div>
                                ) : null}

                                {/* Output file */}
                                <div className="space-y-1 w-full">
                                    <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                        Output File
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={filePath}
                                            onChange={(e) =>
                                                setFilePath(e.target.value)
                                            }
                                            placeholder="/path/to/backup.dump"
                                            className="flex-1 px-4 py-2 text-sm text-text placeholder-text-muted/50 border-b border-border focus:border-accent focus:outline-none transition-colors"
                                        />
                                        <button
                                            type="button"
                                            onClick={handlePickFile}
                                            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-raised hover:border-border-hover transition-colors cursor-pointer shrink-0"
                                            aria-label="Browse for file"
                                        >
                                            <FolderOpen size={15} />
                                        </button>
                                    </div>
                                </div>

                                {/* Schema (optional) */}
                                {(isPg || isMysql) && (
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                            Schema{" "}
                                            <span className="font-normal normal-case tracking-normal">
                                                (optional)
                                            </span>
                                        </label>
                                        <select
                                            value={schema}
                                            onChange={(e) =>
                                                setSchema(e.target.value)
                                            }
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
                                        >
                                            <option value="">All schemas</option>
                                            {availableSchemas.map((s) => (
                                                <option key={s} value={s}>
                                                    {s}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* PostgreSQL: no-owner toggle */}
                                {isPg && (
                                    <label className="flex items-center gap-2.5 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={noOwner}
                                            onChange={(e) =>
                                                setNoOwner(e.target.checked)
                                            }
                                            className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                        />
                                        <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                            No Owner{" "}
                                            <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                --no-owner
                                            </code>
                                        </span>
                                    </label>
                                )}

                                {/* MySQL: option toggles */}
                                {isMysql && (
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2.5 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={singleTransaction}
                                                onChange={(e) =>
                                                    setSingleTransaction(e.target.checked)
                                                }
                                                className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                                Single Transaction{" "}
                                                <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                    --single-transaction
                                                </code>
                                            </span>
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={noData}
                                                onChange={(e) =>
                                                    setNoData(e.target.checked)
                                                }
                                                className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                                No Data{" "}
                                                <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                    --no-data
                                                </code>
                                            </span>
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={routines}
                                                onChange={(e) =>
                                                    setRoutines(e.target.checked)
                                                }
                                                className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                                Routines{" "}
                                                <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                    --routines
                                                </code>
                                            </span>
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={triggers}
                                                onChange={(e) =>
                                                    setTriggers(e.target.checked)
                                                }
                                                className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                                Triggers{" "}
                                                <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                    --triggers
                                                </code>
                                            </span>
                                        </label>
                                        <label className="flex items-center gap-2.5 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={events}
                                                onChange={(e) =>
                                                    setEvents(e.target.checked)
                                                }
                                                className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer"
                                            />
                                            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                                Events{" "}
                                                <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                    --events
                                                </code>
                                            </span>
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Progress */}
                            {activeJob && (
                                <div className="px-4">
                                    <BackupProgress
                                        progress={activeJob.status === "completed" ? 100 : 50}
                                        jobType="dump"
                                        status={activeJob.status}
                                        errorMessage={activeJob.error_message ?? undefined}
                                    />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end pb-2 pr-2">
                                <Button
                                    onClick={handleStartBackup}
                                    disabled={isRunning || !filePath}
                                >
                                    <Download size={14} className="mr-1.5" />
                                    {isRunning ? "Backing up..." : "Start Backup"}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}