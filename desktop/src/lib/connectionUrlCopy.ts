import type { Connection } from "./types";
import { buildConnectionUrl } from "./connectionString";

/** Failure or success of a "copy connection URL" action. */
export type CopyUrlResult =
  | { ok: true; copiedWithPassword: boolean }
  | { ok: false; error: string };

export interface CopyUrlDeps {
  /** Read the saved DB password from the OS keychain. Rejects on keychain failure. */
  readPassword: () => Promise<string | null>;
  /** Write text to the clipboard. Rejects when the clipboard is unavailable. */
  writeClipboard: (text: string) => Promise<void>;
}

/**
 * Copy a connection URL, reporting what actually happened.
 *
 * Failure is never smoothed over into a success: when the password is asked for
 * and the keychain cannot supply it (error, or nothing stored), nothing is
 * copied, so a password-less URL is never presented as the credential string
 * the user asked for. Clipboard failures are reported the same way.
 */
export async function copyConnectionUrl(
  connection: Connection,
  opts: { withPassword: boolean },
  deps: CopyUrlDeps,
): Promise<CopyUrlResult> {
  let password: string | null = null;

  if (opts.withPassword) {
    try {
      password = await deps.readPassword();
    } catch {
      return {
        ok: false,
        error: "Could not read the saved password from the keychain, so no URL was copied",
      };
    }
    if (!password) {
      return {
        ok: false,
        error:
          "No saved password for this connection, so no URL with a password was copied. Use “Copy connection URL (no password)” instead",
      };
    }
  }

  const url = buildConnectionUrl(connection, password);
  try {
    await deps.writeClipboard(url);
  } catch {
    return {
      ok: false,
      error: "Could not write to the clipboard, so the connection URL was not copied",
    };
  }
  return { ok: true, copiedWithPassword: password !== null };
}
