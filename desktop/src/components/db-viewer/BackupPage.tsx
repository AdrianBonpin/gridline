import { useState, useEffect, useCallback, useRef } from "react";
import { Download, FolderOpen, HardDrive } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
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
                            disabled={isRunning || !filePath}
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

                        {/* Output file */}
                        <FormRow label="Output file">
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
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}