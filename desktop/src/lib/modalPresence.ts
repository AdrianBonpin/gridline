/**
 * Modal presence.
 *
 * Window-level keyboard shortcuts are unsafe while a modal surface is open: a
 * Cmd+W or Cmd+S meant for the page behind must not fire under a dialog. Ticket
 * 17 already keeps the destructive-confirmation dialog's keys from reaching the
 * page (it is a real modal that consumes them); this module is the shared signal
 * every other modal raises — `AnimatedModal`, the destructive confirmation, and
 * the object search palette — so shortcut handlers can agree without guessing
 * from the DOM.
 *
 * It is a counter, not a boolean, because modals nest: closing the inner one
 * while the outer one is still up must not re-enable shortcuts.
 */

let openModals = 0;

/** Record that a modal surface is now open. */
export function beginModal(): void {
  openModals += 1;
}

/** Record that a modal surface closed. */
export function endModal(): void {
  openModals = Math.max(0, openModals - 1);
}

/** Is any modal surface open right now? */
export function modalIsOpen(): boolean {
  return openModals > 0;
}
