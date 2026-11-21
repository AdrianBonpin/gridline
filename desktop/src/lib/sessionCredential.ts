/**
 * Session-only credentials on the renderer side (ticket 27).
 *
 * With the keychain toggle off a connection's password is never persisted: it
 * is entered per session and re-entered after a restart. Tool jobs
 * (`pg_dump`/`pg_restore`/`psql`/`mariadb-dump`) and DDL copy run in Rust, so
 * the backend asks for that credential instead of authenticating with an empty
 * password. This module turns that refusal into one password prompt and a
 * retry of the same operation.
 *
 * The operation must be safe to retry when the refusal is returned: every
 * tool-job command resolves its credential *before* it consumes a File Grant,
 * and no job is created until the credential is known.
 */

import { useConnectionStore } from "../stores/connectionStore";

/** The state code the backend puts in front of the refusal. */
export const SESSION_CREDENTIAL_REQUIRED = "session-credential-required";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/** Whether a tool job refused to run because its session credential is absent. */
export function isSessionCredentialRequired(error: unknown): boolean {
  return errorText(error).includes(SESSION_CREDENTIAL_REQUIRED);
}

/**
 * The connection whose session password the job needs.
 *
 * The refusal names it (`session-credential-required:<connection_id>`) because
 * a DB sync resolves two credentials and may be missing only one. Returns
 * `null` for any other failure.
 */
export function sessionCredentialConnectionId(error: unknown): string | null {
  if (!isSessionCredentialRequired(error)) return null;
  const text = errorText(error);
  const rest = text.slice(text.indexOf(SESSION_CREDENTIAL_REQUIRED) + SESSION_CREDENTIAL_REQUIRED.length);
  if (!rest.startsWith(":")) return null;
  const id = rest.slice(1).split(/\s/)[0]?.trim();
  return id ? id : null;
}

/**
 * Run a tool job, asking for a missing session password once.
 *
 * Any other failure is passed through untouched. Cancelling the prompt aborts
 * the operation with a visible error — the job is never retried with an empty
 * password.
 */
export async function withSessionCredential<T>(
  fallbackConnectionId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isSessionCredentialRequired(error)) throw error;

    const connectionId =
      sessionCredentialConnectionId(error) ?? fallbackConnectionId;
    const password = await useConnectionStore
      .getState()
      .requestSessionCredential(connectionId);

    if (!password) {
      throw new Error(
        `${SESSION_CREDENTIAL_REQUIRED}: A session password is required to continue.`,
      );
    }

    // Session-only: the store keeps this in memory and mirrors it to backend
    // memory for the retried job (awaited, so the job cannot overtake it). It is
    // never written to the OS keychain.
    await useConnectionStore
      .getState()
      .setSessionPassword(connectionId, password);

    try {
      return await run();
    } catch (retryError) {
      // The prompt was answered but the job still cannot see the credential
      // (e.g. the backend call failed). Never prompt in a loop.
      if (isSessionCredentialRequired(retryError)) {
        throw new Error(
          "The session password could not be used for this job. Try the operation again.",
        );
      }
      throw retryError;
    }
  }
}
