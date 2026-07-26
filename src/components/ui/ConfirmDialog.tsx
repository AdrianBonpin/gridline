import { Button } from "../ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "ghost";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", confirmVariant = "primary", onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="glass rounded-2xl p-6 w-80 shadow-2xl ring-1 ring-white/10"
        style={{ background: "linear-gradient(145deg, rgba(24,24,27,0.85), rgba(10,10,11,0.65))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-text text-lg mb-3">{title}</h3>
        <p className="text-sm text-text-muted mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}