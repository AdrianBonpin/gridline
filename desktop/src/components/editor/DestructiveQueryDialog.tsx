import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { useModalPresence } from "../../hooks/useModalPresence";

export type DestructiveReason = "write" | "schema" | "unknown";

interface DestructiveQueryDialogProps {
  open: boolean;
  query: string;
  /** The offending statement's own text, exactly as it was classified. */
  statement?: string | null;
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

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Destructive-query confirmation.
 *
 * Ticket 17: this is a real modal, not a panel floating over a live editor. It
 * is portalled to `document.body`, marks itself `aria-modal`, moves focus to
 * its safe action when it opens, traps Tab/Shift+Tab, consumes Escape (which
 * cancels the request), and stops every other key it receives from reaching the
 * page behind — so no window-level shortcut can fire while a confirmation is
 * pending. Focus returns to whatever had it when the dialog closes.
 */
export function DestructiveQueryDialog({
  open,
  query,
  statement,
  statementIndex,
  statementCount,
  reason,
  onConfirm,
  onCancel,
}: DestructiveQueryDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // The portal keeps this dialog out of the page's DOM subtree, so the shared
  // modal-presence signal is what tells window-level shortcuts to stand down
  // while it is up (its own capture handler stops them too).
  useModalPresence(open);
  // Callbacks change identity on every parent render; the modal effect must not
  // re-run (and re-steal focus) because of that.
  const cancelHandlerRef = useRef(onCancel);
  cancelHandlerRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    previousFocusRef.current =
      previous instanceof HTMLElement ? previous : null;
    // Start on the safe action: a stray Enter confirms nothing.
    dialogRef.current
      ?.querySelector<HTMLElement>('[data-testid="destructive-query-cancel"]')
      ?.focus();

    const focusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelHandlerRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const current = nodes.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0
          ? nodes.length - 1
          : current - 1
        : current === -1 || current === nodes.length - 1
          ? 0
          : current + 1;
      nodes[next].focus();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const truncated = query.length > 200 ? query.slice(0, 200) + "..." : query;
  const multiStatement = (statementCount ?? 0) > 1;
  const detail = reason
    ? multiStatement && statementIndex
      ? `Statement ${statementIndex} of ${statementCount} — ${REASON_LABELS[reason]}.`
      : `This is ${REASON_LABELS[reason]}.`
    : null;
  const offending = statement?.trim() ? statement.trim() : null;

  return createPortal(
    <div
      ref={dialogRef}
      data-testid="destructive-query-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Destructive Query"
      // The modal owns the keyboard: nothing typed here reaches a window-level
      // shortcut behind it. Escape and Tab are handled above, before React.
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50"
    >
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

        {offending && (
          <div
            data-testid="destructive-offending-statement"
            className="bg-canvas border border-amber-400/30 rounded-lg p-3 mb-4"
          >
            <div className="text-[11px] uppercase tracking-wide text-amber-300/80 mb-1">
              {multiStatement && statementIndex
                ? `Statement ${statementIndex} of ${statementCount}`
                : "Statement"}
            </div>
            <pre className="text-xs text-text font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto m-0">
              {offending}
            </pre>
          </div>
        )}

        <div className="bg-canvas border border-border rounded-lg p-3 mb-4">
          <code className="text-xs text-text-muted font-mono break-all">{truncated}</code>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            data-testid="destructive-query-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            data-testid="destructive-query-confirm"
            className="!bg-red-500 hover:!bg-red-600 !border-red-500"
          >
            Execute
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
