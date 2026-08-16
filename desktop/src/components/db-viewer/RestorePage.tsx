import { useState, useEffect, useCallback, useRef } from "react";
import { FileSearch, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useConnectionStore } from "../../stores/connectionStore";
import {
    detectPgTools,
    pgRestore,
    getSchemas,
    detectMysqlTools,
    mysqlRestore,
    sqliteRestore,
} from "../../lib/commands";
import type { PgToolStatus, MySqlToolStatus, BackupJob } from "../../lib/types";

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
    const [mysqlToolStatus, setMysqlToolStatus] = useState<MySqlToolStatus | null>(null);
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

    const toolsMissing = isPg
        ? pgToolStatus && !pgToolStatus.pg_restore_found
        : isMysql
          ? mysqlToolStatus && !mysqlToolStatus.mysqlFound
          : false;
    const toolsBundled = isPg
        ? pgToolStatus?.pg_restore_source === "bundled"
        : isMysql
          ? mysqlToolStatus?.mysqlSource === "bundled"
          : false;
    const canStart = filePath && confirmed && !isRunning;

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

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar header */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <Upload size={14} className="text-accent" />
                <span className="text-xs font-medium text-text">Restore</span>
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
                                {isPg ? "pg_restore not found" : "mysql client not found"}
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
                                {/* Format (PostgreSQL only) */}
                                {isPg && (
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                            Format
                                        </label>
                                        <select
                                            value={format}
                                            onChange={(e) =>
                                                setFormat(e.target.value)
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
                                )}

                                {/* Backup file */}
                                <div className="space-y-1 w-full">
                                    <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                        Backup File
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
                                            <FileSearch size={15} />
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

                                {/* Clean toggle */}
                                {(isPg || isMysql || isSqlite) && (
                                    <label
                                        className={`flex items-center gap-2.5 cursor-pointer group ${
                                            isPg && format === "plain"
                                                ? "opacity-40 pointer-events-none"
                                                : ""
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={clean}
                                            onChange={(e) =>
                                                setClean(e.target.checked)
                                            }
                                            disabled={isPg && format === "plain"}
                                            className="rounded bg-surface border-border accent-accent w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <span className="text-sm text-text-muted group-hover:text-text transition-colors">
                                            Clean{" "}
                                            <code className="text-[11px] text-text-muted/60 bg-surface-raised rounded px-1.5 py-0.5">
                                                DROP before CREATE
                                            </code>
                                        </span>
                                    </label>
                                )}
                                {isPg && format === "plain" && (
                                    <p className="text-[11px] text-text-muted/70 -mt-3">
                                        Plain SQL restores run via psql and don't
                                        support DROP-before-CREATE. Use Custom
                                        Archive for clean restores.
                                    </p>
                                )}
                            </div>

                            {/* Destructive confirmation */}
                            <div className="bg-red-500/5 border border-red-500/20 px-4 py-3">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={confirmed}
                                        onChange={(e) =>
                                            setConfirmed(e.target.checked)
                                        }
                                        className="mt-0.5 rounded bg-surface border-border accent-red-500 w-4 h-4 cursor-pointer"
                                        data-testid="restore-confirm-checkbox"
                                    />
                                    <span className="text-sm text-red-300/90 leading-relaxed">
                                        I understand this will overwrite data on
                                        the target database. This action cannot
                                        be undone.
                                    </span>
                                </label>
                            </div>

                            {/* Progress */}
                            {activeJob && (
                                <div className="px-4">
                                    <BackupProgress
                                        progress={activeJob.status === "completed" ? 100 : 50}
                                        jobType="restore"
                                        status={activeJob.status}
                                        errorMessage={activeJob.error_message ?? undefined}
                                    />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end pb-2 pr-2">
                                <Button
                                    onClick={handleStartRestore}
                                    disabled={!canStart}
                                >
                                    <Upload size={14} className="mr-1.5" />
                                    {isRunning
                                        ? "Restoring..."
                                        : "Start Restore"}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}