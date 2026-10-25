import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";

export type DestructiveReason = "write" | "schema" | "unknown";

interface DestructiveQueryDialogProps {
  open: boolean;
  query: string;
  /** 1-based index of the statement that needs confirmation. */
  statementIndex?: number | null;
  /** How many statements the script contains. */
  statementCount?: number | null;
  /** Why confirmation was requested (`ScriptAnalysis.reason`). */
  reason?: DestructiveReason | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const REASON_LABELS: Record<DestructiveReason, string> = {
  write: "a data-modifying statement",
  schema: "a schema-modifying statement (DDL)",
  unknown: "a statement that could not be verified as read-only",
};

export function DestructiveQueryDialog({
  open,
  query,
  statementIndex,
  statementCount,
  reason,
  onConfirm,
  onCancel,
}: DestructiveQueryDialogProps) {
  if (!open) return null;

  const truncated = query.length > 200 ? query.slice(0, 200) + "..." : query;
  const multiStatement = (statementCount ?? 0) > 1;
  const detail = reason
    ? multiStatement && statementIndex
      ? `Statement ${statementIndex} of ${statementCount} — ${REASON_LABELS[reason]}.`
      : `This is ${REASON_LABELS[reason]}.`
    : null;

  return (
    <div className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="glass rounded-2xl p-6 shadow-2xl ring-1 ring-white/10 max-w-md w-full">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-heading text-text text-lg">Destructive Query</h3>
            <p className="text-sm text-text-muted mt-1">
              This query will modify your database. This action cannot be undone.
            </p>
            {detail && (
              <p
                className="text-xs text-amber-300/80 mt-2"
                data-testid="destructive-statement-detail"
              >
                {detail}
              </p>
            )}
          </div>
        </div>

        <div className="bg-canvas border border-border rounded-lg p-3 mb-4">
          <code className="text-xs text-text-muted font-mono break-all">{truncated}</code>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} className="!bg-red-500 hover:!bg-red-600 !border-red-500">Execute</Button>
        </div>
      </div>
    </div>
  );
}
