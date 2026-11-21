/**
 * File Grants on the renderer side.
 *
 * A File Grant is backend-issued authorization (see `GLOSSARY.md`): the
 * renderer asks Rust to show the native dialog, receives a grant id plus
 * display metadata, and hands the id back to a file-touching command. Nothing
 * here can mint a grant, and `path` is display-only — a path typed or patched
 * into the UI authorizes nothing.
 */

export type FileIntent = "read" | "write";

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** What the renderer asks the backend dialog to show. */
export interface FileGrantRequest {
  intent: FileIntent;
  title: string;
  defaultName?: string;
  filters?: FileFilter[];
}

/** A backend-issued grant: `id` authorizes, `path` is display metadata. */
export interface FileGrant {
  id: string;
  path: string;
  displayName: string;
  intent: FileIntent;
  expiresInSeconds: number;
}

/** The stable error codes the backend puts in front of a grant rejection. */
export const FILE_GRANT_CODES = {
  invalid: "file-grant-invalid",
  expired: "file-grant-expired",
  "wrong-intent": "file-grant-wrong-intent",
  consumed: "file-grant-consumed",
} as const;

export type FileGrantErrorKind = keyof typeof FILE_GRANT_CODES;

const KIND_BY_CODE = new Map<string, FileGrantErrorKind>(
  (Object.keys(FILE_GRANT_CODES) as FileGrantErrorKind[]).map((kind) => [
    FILE_GRANT_CODES[kind],
    kind,
  ]),
);

/** The visible state for each grant rejection, with its recovery action. */
export const FILE_GRANT_STATE: Record<
  FileGrantErrorKind,
  { title: string; detail: string }
> = {
  expired: {
    title: "File selection expired",
    detail:
      "A file selection is valid for five minutes. Choose the output file again to continue.",
  },
  consumed: {
    title: "File selection already used",
    detail:
      "Each backup needs its own file selection. Choose the output file again to continue.",
  },
  "wrong-intent": {
    title: "File selection not valid for this operation",
    detail: "Choose the output file again to continue.",
  },
  invalid: {
    title: "No file selected",
    detail:
      "Choose the output file with Browse so Gridline can authorize the write.",
  },
};

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
 * Classify a backend rejection as a File Grant state.
 *
 * Returns `null` for every other failure (a tool error, a missing connection),
 * so callers keep the ordinary error path for those.
 */
export function fileGrantErrorKind(error: unknown): FileGrantErrorKind | null {
  const text = errorText(error);
  const match = /^([a-z][a-z-]*):\s/.exec(text);
  if (!match) return null;
  return KIND_BY_CODE.get(match[1]) ?? null;
}

/**
 * The human-readable part of a grant rejection (the code prefix stripped), or
 * `null` when the error is not a grant rejection.
 */
export function fileGrantErrorMessage(error: unknown): string | null {
  if (!fileGrantErrorKind(error)) return null;
  const text = errorText(error);
  const separator = text.indexOf(": ");
  return separator === -1 ? text : text.slice(separator + 2).trim();
}
