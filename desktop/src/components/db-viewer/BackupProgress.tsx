import { Button } from "../ui/Button";

interface BackupProgressProps {
    progress: number;
    jobType: string;
    status: "running" | "completed" | "failed" | "cancelled";
    errorMessage?: string | null;
    onCancel?: () => void;
}

export function BackupProgress({
    progress,
    jobType,
    status,
    errorMessage,
    onCancel,
}: BackupProgressProps) {
    const isRunning = status === "running";

    return (
        <div data-testid="backup-progress" className="w-full space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text capitalize">
                        {jobType}
                    </span>
                    <span className="text-xs text-text-muted">
                        {status === "running" && `In progress...`}
                        {status === "completed" && "Completed"}
                        {status === "failed" && "Failed"}
                        {status === "cancelled" && "Cancelled"}
                    </span>
                </div>
                {isRunning && onCancel && (
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
            </div>

            {/* Progress bar */}
            <div className="relative w-full h-2 bg-surface-raised rounded-full overflow-hidden">
                <div
                    data-testid="progress-bar-fill"
                    className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${
                        status === "failed" ? "bg-red-500" : "bg-accent"
                    }`}
                    style={{
                        width: `${Math.min(100, Math.max(0, progress))}%`,
                    }}
                />
            </div>

            {/* Error message */}
            {errorMessage && status === "failed" && (
                <p className="text-sm text-red-400">{errorMessage}</p>
            )}
        </div>
    );
}
