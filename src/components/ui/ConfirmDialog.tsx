import { Button } from "../ui/Button";
import { AnimatedModal } from "../ui/AnimatedModal";

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
    <AnimatedModal open={open} onClose={onCancel}>
      <div className="w-80">
        <h3 className="font-heading text-text text-lg mb-3">{title}</h3>
        <p className="text-sm text-text-muted mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </AnimatedModal>
  );
}