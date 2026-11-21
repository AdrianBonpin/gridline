/**
 * The renderer side of "this dump cannot be restored in one transaction".
 *
 * The backend decides, because it is the only side that reads the dump: it
 * refuses a restore it cannot run transactionally and puts a stable code in
 * front of the reason (see `PG_RESTORE_NON_ATOMIC_CODE` in
 * `src-tauri/src/commands/backup.rs`). The renderer turns that into an explicit
 * risk confirmation — a dump never runs non-atomically on a blanket "yes".
 */

/** The stable error code in front of a non-atomic refusal. */
export const PG_RESTORE_NON_ATOMIC_CODE = "pg-restore-non-atomic";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * The backend's reason for refusing to restore this dump transactionally, or
 * `null` when the message is some other failure.
 *
 * The reason names what makes the dump incompatible *and* what a failure would
 * leave behind, so it can be shown verbatim as the risk the user is accepting.
 */
export function nonAtomicRefusalReason(error: unknown): string | null {
  const text = errorText(error);
  const prefix = `${PG_RESTORE_NON_ATOMIC_CODE}: `;
  if (!text.startsWith(prefix)) return null;
  const reason = text.slice(prefix.length).trim();
  return reason.length > 0 ? reason : null;
}
