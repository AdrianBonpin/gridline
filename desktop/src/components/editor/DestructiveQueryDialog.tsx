import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";

interface DestructiveQueryDialogProps {
  open: boolean;
  query: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DestructiveQueryDialog({ open, query, onConfirm, onCancel }: DestructiveQueryDialogProps) {
  if (!open) return null;

  const truncated = query.length > 200 ? query.slice(0, 200) + "..." : query;

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