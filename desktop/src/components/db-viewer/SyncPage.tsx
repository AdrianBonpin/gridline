import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeftRight, Database } from "lucide-react";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
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
    useEffect(() => {
        setPgToolStatus(null);
        setMysqlToolStatus(null);
        setConfirmed(false);

        if (isPg) {
            setCheckingTools(true);
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
        } else if (isMysql) {
            setCheckingTools(true);
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
        }
    }, [isPg, isMysql]);

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

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar header */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <ArrowLeftRight size={14} className="text-accent" />
                <span className="text-xs font-medium text-text">DB Sync</span>
                <span className="text-[11px] text-text-muted">
                    Transfer data between databases via pipe
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
                            </ul>
                        </div>
                    )}

                    {!checkingTools && !toolsMissing && (
                        <>
                            {/* Configuration card */}
                            <div className="p-5 space-y-5">
                                {/* Source & Target connection pickers */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                                            <Database size={11} />
                                            Source
                                        </label>
                                        <select
                                            value={sourceConnectionId}
                                            onChange={(e) => {
                                                setSourceConnectionId(
                                                    e.target.value,
                                                );
                                                setTargetConnectionId("");
                                            }}
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
                                        >
                                            <option value="">
                                                Select source...
                                            </option>
                                            {connections.map((c) => (
                                                <option
                                                    key={c.id}
                                                    value={c.id}
                                                >
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                                            <Database size={11} />
                                            Target
                                        </label>
                                        <select
                                            value={targetConnectionId}
                                            onChange={(e) =>
                                                setTargetConnectionId(
                                                    e.target.value,
                                                )
                                            }
                                            disabled={!sourceConnectionId}
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                                                    disabled={
                                                        c.id === sourceConnectionId
                                                    }
                                                >
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
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
                                            disabled={!sourceConnectionId}
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <option value="">
                                                {sourceConnectionId
                                                    ? "All schemas"
                                                    : "Select a source first"}
                                            </option>
                                            {availableSchemas.map((s) => (
                                                <option key={s} value={s}>
                                                    {s}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Flow indicator */}
                                {sourceConnectionId && targetConnectionId && (
                                    <div className="flex items-center gap-3 text-[11px] text-text-muted">
                                        <span className="font-medium text-text">
                                            {connections.find(
                                                (c) =>
                                                    c.id === sourceConnectionId,
                                            )?.name ?? sourceConnectionId}
                                        </span>
                                        <ArrowLeftRight
                                            size={12}
                                            className="text-accent shrink-0"
                                        />
                                        <span className="font-medium text-text">
                                            {connections.find(
                                                (c) =>
                                                    c.id === targetConnectionId,
                                            )?.name ?? targetConnectionId}
                                        </span>
                                    </div>
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
                                <div className="px-4">
                                    <BackupProgress
                                        progress={activeJob.status === "completed" ? 100 : 50}
                                        jobType="sync"
                                        status={activeJob.status}
                                        errorMessage={activeJob.error_message ?? undefined}
                                    />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end pb-2 pr-2">
                                <Button
                                    onClick={handleStartSync}
                                    disabled={!canStart}
                                >
                                    <ArrowLeftRight
                                        size={14}
                                        className="mr-1.5"
                                    />
                                    {isRunning ? "Syncing..." : "Start Sync"}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}