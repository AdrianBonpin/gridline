import { useEffect } from "react";
import { beginModal, endModal } from "../lib/modalPresence";

/**
 * Register a modal surface as open for as long as `open` is true.
 *
 * Window-level shortcuts consult `modalIsOpen()` at key time, so a modal never
 * has to know which shortcuts exist — it only has to say that it owns the
 * keyboard while it is up.
 */
export function useModalPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    beginModal();
    return endModal;
  }, [open]);
}
