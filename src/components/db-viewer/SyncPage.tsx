import { useState, useEffect, useCallback } from "react";
import { ArrowLeftRight, Database } from "lucide-react";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { detectPgTools, dbSync } from "../../lib/commands";
import type { PgToolStatus } from "../../lib/types";

export function SyncPage() {
    const [sourceConnectionId, setSourceConnectionId] = useState("");
    const [targetConnectionId, setTargetConnectionId] = useState("");
    const [schema, setSchema] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [toolStatus, setToolStatus] = useState<PgToolStatus | null>(null);
    const [checkingTools, setCheckingTools] = useState(true);
    const [running, setRunning] = useState(false);

    const connections = useConnectionStore((s) => s.connections);
    const activeJobId = useBackupStore((s) => s.activeJobId);
    const jobs = useBackupStore((s) => s.jobs);
    const startJob = useBackupStore((s) => s.startJob);
    const notify = useNotificationStore((s) => s.notify);

    const activeJob = jobs.find((j) => j.id === activeJobId);

    useEffect(() => {
        setCheckingTools(true);
        setConfirmed(false);
        detectPgTools()
            .then((status) => setToolStatus(status))
            .catch(() =>
                setToolStatus({
                    pg_dump_found: false,
                    pg_restore_found: false,
                    pg_dump_version: null,
                    pg_restore_version: null,
                }),
            )
            .finally(() => setCheckingTools(false));
    }, []);

    const handleStartSync = useCallback(async () => {
        if (!sourceConnectionId || !targetConnectionId) {
            notify("Please select both source and target connections", "error");
            return;
        }
        if (sourceConnectionId === targetConnectionId) {
            notify("Source and target must be different", "error");
            return;
        }
        setRunning(true);
        const jobId = `sync-${Date.now()}`;
        startJob(jobId, "sync");
        try {
            await dbSync({
                sourceConnectionId,
                targetConnectionId,
                schema: schema || undefined,
                tables: undefined,
            });
            notify("Sync completed successfully", "success");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            notify(`Sync failed: ${parseError(msg)}`, "error");
        } finally {
            setRunning(false);
        }
    }, [sourceConnectionId, targetConnectionId, schema, startJob, notify]);

    const toolsMissing =
        toolStatus &&
        (!toolStatus.pg_dump_found || !toolStatus.pg_restore_found);
    const canStart =
        sourceConnectionId && targetConnectionId && confirmed && !running;
    const isRunning = activeJob?.status === "running";

    const postgresqlConnections = connections.filter(
        (c) => c.db_type === "postgresql",
    );

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar header */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <ArrowLeftRight size={14} className="text-accent" />
                <span className="text-xs font-medium text-text">DB Sync</span>
                <span className="text-[11px] text-text-muted">
                    Transfer data between PostgreSQL databases via pipe
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-lg mx-auto space-y-6 outline outline-border">
                    {/* Tool check */}
                    {checkingTools && (
                        <div className="glass p-4 text-center">
                            <p className="text-sm text-text-muted">
                                Checking for pg_dump / pg_restore...
                            </p>
                        </div>
                    )}

                    {toolsMissing && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-4 space-y-2">
                            <p className="text-amber-300 text-sm font-semibold">
                                PostgreSQL tools not found
                            </p>
                            <p className="text-amber-200/80 text-xs leading-relaxed">
                                Both pg_dump and pg_restore are required for
                                database sync.
                            </p>
                            <ul className="list-disc list-inside text-xs text-amber-200/70 space-y-0.5">
                                {!toolStatus?.pg_dump_found && (
                                    <li>pg_dump is missing.</li>
                                )}
                                {!toolStatus?.pg_restore_found && (
                                    <li>pg_restore is missing.</li>
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
                                            onChange={(e) =>
                                                setSourceConnectionId(
                                                    e.target.value,
                                                )
                                            }
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
                                        >
                                            <option value="">
                                                Select source...
                                            </option>
                                            {postgresqlConnections.map((c) => (
                                                <option
                                                    key={c.id}
                                                    value={c.id}
                                                    disabled={
                                                        c.id ===
                                                        targetConnectionId
                                                    }
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
                                            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
                                        >
                                            <option value="">
                                                Select target...
                                            </option>
                                            {postgresqlConnections.map((c) => (
                                                <option
                                                    key={c.id}
                                                    value={c.id}
                                                    disabled={
                                                        c.id ===
                                                        sourceConnectionId
                                                    }
                                                >
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Schema (optional) */}
                                <div className="space-y-1 w-full">
                                    <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                                        Schema{" "}
                                        <span className="font-normal normal-case tracking-normal">
                                            (optional)
                                        </span>
                                    </label>
                                    <input
                                        type="text"
                                        value={schema}
                                        onChange={(e) =>
                                            setSchema(e.target.value)
                                        }
                                        placeholder="public"
                                        className="w-full px-4 py-2 text-sm text-text placeholder-text-muted/50 border-b border-border focus:border-accent focus:outline-none transition-colors"
                                    />
                                </div>

                                {/* Flow indicator */}
                                {sourceConnectionId && targetConnectionId && (
                                    <div className="flex items-center gap-3 text-[11px] text-text-muted">
                                        <span className="font-medium text-text">
                                            {postgresqlConnections.find(
                                                (c) =>
                                                    c.id === sourceConnectionId,
                                            )?.name ?? sourceConnectionId}
                                        </span>
                                        <ArrowLeftRight
                                            size={12}
                                            className="text-accent shrink-0"
                                        />
                                        <span className="font-medium text-text">
                                            {postgresqlConnections.find(
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
                            {isRunning && (
                                <div className="glass p-4">
                                    <BackupProgress
                                        progress={50}
                                        jobType="sync"
                                        status="running"
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
                                    {running ? "Syncing..." : "Start Sync"}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function parseError(msg: string): string {
    if (msg.includes("pg_dump:") || msg.includes("pg_restore:")) {
        const parts = msg.split(/pg_(dump|restore):/);
        return parts[parts.length - 1]?.trim() || msg;
    }
    if (msg.includes("No such file or directory")) {
        return "File not found. Check the output path and try again.";
    }
    if (msg.includes("Permission denied")) {
        return "Permission denied. Check file permissions.";
    }
    return msg;
}
