import { modalIsOpen } from "./modalPresence";

/**
 * Is this key event happening somewhere a global shortcut must not act?
 *
 * Two everyday situations make a window-level shortcut unsafe (ticket 39):
 *
 * - **Text editing.** Cmd+K, Cmd+W and Cmd+S inside an input, a textarea, a
 *   select, a content-editable region, or the SQL editor would steal the key
 *   from what the user is typing.
 * - **A modal is open.** While a dialog owns the keyboard, its own keys (and
 *   only its own) apply; the page behind is not the user's current context.
 *   Detected both from an explicit modal-presence registration and from the
 *   dialog's own `aria-modal`/`role="dialog"` markup, so forgetting the
 *   registration cannot fail open.
 *
 * Kept free of React so both the `useShortcut` hook and the Commit All shortcut
 * apply exactly the same rule.
 */

/** Input types that are not text entry: a shortcut may still fire from them. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Is `target` a field the user types into? */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // Monaco reports keys from inside its own editor surface, including when the
  // hidden textarea is not the direct target.
  if (target.closest(".monaco-editor")) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

/** Is a modal surface up, by registration or by its own modal markup? */
function modalIsPresent(): boolean {
  // Two independent signals, so a newly added dialog that forgets to register
  // can never leave shortcuts live: the explicit registration counter (works
  // for portalled/imperatively shown surfaces) and any element declaring
  // itself a modal (`role="dialog"`/`aria-modal`), which every real dialog
  // renders.
  if (modalIsOpen()) return true;
  if (typeof document === "undefined") return false;
  return document.querySelector('[aria-modal="true"], [role="dialog"]') !== null;
}

/** Must a window-level shortcut ignore this keydown? */
export function shortcutIsSuppressed(event: KeyboardEvent): boolean {
  if (modalIsPresent()) return true;
  return isTextEditingTarget(event.target);
}
