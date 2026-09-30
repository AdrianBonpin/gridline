import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeftRight } from "lucide-react";
import { BackupProgress } from "./BackupProgress";
import {
    FormRow,
    FormSectionHeader,
    controlClass,
} from "./objects/formRow";
import { useBackupStore } from "../../stores/backupStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import {
    detectPgTools,
    dbSync,
    getSchemas,
    detectMysqlTools,
    mysqlSync,
    sqliteSync,
} from "../../lib/commands";
import type { PgToolStatus, MySqlToolStatus, BackupJob, DbType } from "../../lib/types";

export function SyncPage() {
    const [sourceConnectionId, setSourceConnectionId] = useState("");
    const [targetConnectionId, setTargetConnectionId] = useState("");
    const [schema, setSchema] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [pgToolStatus, setPgToolStatus] = useState<PgToolStatus | null>(null);
    const [mysqlToolStatus, setMysqlToolStatus] = useState<MySqlToolStatus | null>(null);
    const [checkingTools, setCheckingTools] = useState(false);
    const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);

    const connections = useConnectionStore((s) => s.connections);
    const activeJobId = useBackupStore((s) => s.activeJobId);
    const jobs = useBackupStore((s) => s.jobs);
    const startJob = useBackupStore((s) => s.startJob);
    const notify = useNotificationStore((s) => s.notify);

    const activeJob = jobs.find((j) => j.id === activeJobId);
    const isRunning = activeJob?.status === "running";
    const pendingJobRef = useRef<string | null>(null);

    const sourceConnection = connections.find(
        (c) => c.id === sourceConnectionId,
    );
    const dbType: DbType | null = sourceConnection?.db_type ?? null;
    const isPg = dbType === "postgresql";
    const isMysql = dbType === "mysql";

    useEffect(() => {
        if (!pendingJobRef.current || !activeJob) return;
        if (activeJob.id !== pendingJobRef.current) return;

        if (activeJob.status === "completed") {
            notify("Sync completed successfully", "success");
            pendingJobRef.current = null;
        } else if (activeJob.status === "failed") {
            notify(
                `Sync failed: ${activeJob.error_message || "Unknown error"}`,
                "error",
            );
            pendingJobRef.current = null;
        }
    }, [activeJob, notify]);

    // Tool detection: depends on the selected source connection's DB type
    const checkTools = useCallback(
        async (force: boolean) => {
            setPgToolStatus(null);
            setMysqlToolStatus(null);
            if (isPg) {
                setCheckingTools(true);
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
                setCheckingTools(true);
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
            }
        },
        [isPg, isMysql],
    );

    useEffect(() => {
        setConfirmed(false);
        void checkTools(false);
    }, [checkTools]);

    // Fetch schemas from the source connection when it changes
    useEffect(() => {
        if (!sourceConnectionId) {
            setAvailableSchemas([]);
            setSchema("");
            return;
        }
        if (!isPg && !isMysql) {
            setAvailableSchemas([]);
            setSchema("");
            return;
        }
        getSchemas(sourceConnectionId)
            .then((schemas) => setAvailableSchemas(schemas))
            .catch(() => setAvailableSchemas([]));
    }, [sourceConnectionId, isPg, isMysql]);

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

    const handleStartSync = useCallback(async () => {
        if (!sourceConnectionId || !targetConnectionId) {
            notify("Please select both source and target connections", "error");
            return;
        }
        if (sourceConnectionId === targetConnectionId) {
            notify("Source and target must be different", "error");
            return;
        }
        if (!dbType) {
            notify("Unable to determine database type for sync", "error");
            return;
        }

        const options = {
            sourceConnectionId,
            targetConnectionId,
            schema: schema || undefined,
            tables: undefined,
            dbType,
        };

        await runWithProgress("sync", () => {
            if (isPg) return dbSync(options);
            if (isMysql) return mysqlSync(options);
            return sqliteSync(options);
        });
    }, [
        sourceConnectionId,
        targetConnectionId,
        dbType,
        isPg,
        isMysql,
        schema,
        notify,
        runWithProgress,
    ]);

    const toolsMissing = isPg
        ? pgToolStatus &&
          (!pgToolStatus.pg_dump_found || !pgToolStatus.pg_restore_found)
        : isMysql
          ? mysqlToolStatus &&
            (!mysqlToolStatus.mysqldumpFound || !mysqlToolStatus.mysqlFound)
          : false;
    const toolsBundled = isPg
        ? pgToolStatus?.pg_dump_source === "bundled" &&
          pgToolStatus?.pg_restore_source === "bundled"
        : isMysql
          ? mysqlToolStatus?.mysqldumpSource === "bundled" &&
            mysqlToolStatus?.mysqlSource === "bundled"
          : false;
    const canStart =
        sourceConnectionId && targetConnectionId && confirmed && !isRunning;

    const checkingMessage = isPg
        ? "Checking for pg_dump / pg_restore..."
        : isMysql
          ? "Checking for mysqldump / mysql..."
          : null;

    const targetConnections = dbType
        ? connections.filter((c) => c.db_type === dbType)
        : [];

    const sourceName =
        connections.find((c) => c.id === sourceConnectionId)?.name ??
        sourceConnectionId;
    const targetName =
        connections.find((c) => c.id === targetConnectionId)?.name ??
        targetConnectionId;

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <ArrowLeftRight size={14} className="text-accent" />
                    <span className="text-xs font-medium text-text">DB Sync</span>
                    <span className="text-[11px] text-text-muted">
                        Transfer data between databases via pipe
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
                            onClick={() => void handleStartSync()}
                            disabled={!canStart}
                            className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                            <ArrowLeftRight size={14} className="mr-1.5" />
                            {isRunning ? "Syncing..." : "Start Sync"}
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
                            {isPg
                                ? "PostgreSQL tools not found"
                                : "MySQL tools not found"}
                        </p>
                        <p className="text-amber-200/80 text-xs leading-relaxed">
                            Both {isPg ? "pg_dump and pg_restore" : "mysqldump and mysql"} are required for
                            database sync.
                        </p>
                        <ul className="list-disc list-inside text-xs text-amber-200/70 space-y-0.5">
                            {isPg && !pgToolStatus?.pg_dump_found && (
                                <li>pg_dump is missing.</li>
                            )}
                            {isPg && !pgToolStatus?.pg_restore_found && (
                                <li>pg_restore is missing.</li>
                            )}
                            {isMysql && !mysqlToolStatus?.mysqldumpFound && (
                                <li>mysqldump is missing.</li>
                            )}
                            {isMysql && !mysqlToolStatus?.mysqlFound && (
                                <li>mysql is missing.</li>
                            )}
                            {isMysql && mysqlToolStatus?.mysqlResolvedName && (
                                <li className="text-amber-200/50">
                                    Resolved MySQL client: {mysqlToolStatus.mysqlResolvedName}
                                </li>
                            )}
                        </ul>
                    </div>
                )}

                {!checkingTools && !toolsMissing && (
                    <>
                        <FormSectionHeader label="Connections" />

                        {/* Source connection */}
                        <FormRow label="Source">
                            <select
                                value={sourceConnectionId}
                                onChange={(e) => {
                                    setSourceConnectionId(e.target.value);
                                    setTargetConnectionId("");
                                }}
                                className={`${controlClass} mr-3`}
                            >
                                <option value="">Select source...</option>
                                {connections.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </FormRow>

                        {/* Target connection — filtered to the source's db type */}
                        <FormRow label="Target">
                            <select
                                value={targetConnectionId}
                                onChange={(e) => setTargetConnectionId(e.target.value)}
                                disabled={!sourceConnectionId}
                                className={`${controlClass} mr-3 disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                <option value="">
                                    {sourceConnectionId
                                        ? "Select target..."
                                        : "Select a source first"}
                                </option>
                                {targetConnections.map((c) => (
                                    <option
                                        key={c.id}
                                        value={c.id}
                                        disabled={c.id === sourceConnectionId}
                                    >
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </FormRow>

                        {/* Flow indicator */}
                        {sourceConnectionId && targetConnectionId && (
                            <FormRow label="Flow">
                                <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-text-muted">
                                    <span className="font-medium text-text">
                                        {sourceName}
                                    </span>
                                    <ArrowLeftRight
                                        size={12}
                                        className="text-accent shrink-0"
                                    />
                                    <span className="font-medium text-text">
                                        {targetName}
                                    </span>
                                </div>
                            </FormRow>
                        )}

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

                        {/* Destructive confirmation */}
                        <div className="border-b border-border bg-red-500/5 px-4 py-3 space-y-2">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    onChange={(e) => setConfirmed(e.target.checked)}
                                    className="mt-0.5 bg-surface border-border accent-red-500 w-4 h-4 cursor-pointer"
                                    data-testid="sync-confirm-checkbox"
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
                            <div className="px-4 py-3">
                                <BackupProgress
                                    progress={activeJob.status === "completed" ? 100 : 50}
                                    jobType="sync"
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
