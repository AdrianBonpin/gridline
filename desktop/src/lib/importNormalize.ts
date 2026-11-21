import { parseCsv } from "./csvParser";

/**
 * Normalizing a CSV or JSON import source into positional cells.
 *
 * Every cell keeps what the *source* said, not what it looked like: the
 * declared column type decides the value (see `importConvert.ts`). A cell is
 * therefore one of
 *
 * - `{ kind: "null" }` — the source has no value here (an unquoted empty CSV
 *   field, a JSON `null`, or a key missing from a JSON row),
 * - `{ kind: "text" }` — source text, including a quoted empty CSV field and a
 *   JSON string; `""` stays an empty string, never NULL,
 * - `{ kind: "json" }` — a JSON scalar/object/array kept as structure, so a
 *   nested value reaches a `json`/`jsonb` column as JSON instead of
 *   `"[object Object]"`.
 */
export type ImportCell =
  | { kind: "null" }
  | { kind: "text"; value: string }
  | { kind: "json"; value: unknown };

export interface NormalizedImport {
  /** Source column labels in positional order. May repeat — never a key. */
  headers: string[];
  /** `rows[r][i]` is source column `i` of data row `r`. */
  rows: ImportCell[][];
}

/** The row cap stays here; the byte cap mirrors the backend's `MAX_IMPORT_BYTES`. */
export const MAX_IMPORT_ROWS = 100_000;
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/**
 * Refuse an oversized source before its text is parsed.
 *
 * The backend already checks the file's metadata before reading it (so the
 * bytes are never buffered); this is the renderer-side copy of the same
 * contract, applied to the byte count the backend reported.
 */
export function assertImportByteLimit(bytes: number, maxBytes = MAX_IMPORT_BYTES): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error("The import file size could not be read.");
  }
  if (bytes > maxBytes) {
    throw new Error(
      `File exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB limit (${bytes} bytes)`,
    );
  }
}

function jsonCell(value: unknown): ImportCell {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "string") return { kind: "text", value };
  return { kind: "json", value };
}

export function normalizeImport(text: string): NormalizedImport {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("Import input is empty");

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid JSON");
    }

    let objects: unknown[];
    if (Array.isArray(parsed)) {
      objects = parsed;
    } else if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed);
      const arrays = values.filter((v): v is unknown[] => Array.isArray(v));
      if (arrays.length === 1 && values.length === 1) {
        objects = arrays[0];
      } else {
        objects = [parsed];
      }
    } else {
      throw new Error("JSON import must be an array of objects or an object");
    }

    if (objects.length === 0) return { headers: [], rows: [] };

    const bad = objects.findIndex((o) => o === null || typeof o !== "object" || Array.isArray(o));
    if (bad !== -1) {
      throw new Error(
        `JSON row ${bad + 1} is not an object; an import needs one object per row with the column names as keys.`,
      );
    }

    // Headers are the union of every row's keys, in first-seen order: a key
    // that only appears in a later row is still importable, and rows that omit
    // it import as NULL rather than being silently skipped.
    const headers: string[] = [];
    const seen = new Set<string>();
    for (const obj of objects as Record<string, unknown>[]) {
      for (const key of Object.keys(obj)) {
        if (seen.has(key)) continue;
        seen.add(key);
        headers.push(key);
      }
    }

    const rows = (objects as Record<string, unknown>[]).map((obj) =>
      headers.map((key) => jsonCell(obj[key])),
    );
    return { headers, rows };
  }

  const csv = parseCsv(text);
  const rows = csv.rows.map((row) =>
    row.map((cell): ImportCell =>
      // An unquoted empty field is absent data; `""` is an empty string.
      cell.text === "" && !cell.quoted ? { kind: "null" } : { kind: "text", value: cell.text },
    ),
  );
  return { headers: csv.headers, rows };
}

/**
 * The label used to name a source column in a report.
 *
 * Duplicate (or blank) headers are named by position, because the header text
 * alone does not identify the column: `id (column 2)` is the second `id`.
 */
export function sourceColumnLabel(headers: readonly string[], index: number): string {
  const header = headers[index] ?? "";
  const duplicated = headers.filter((h) => h === header).length > 1;
  if (header === "") return `column ${index + 1}`;
  return duplicated ? `${header} (column ${index + 1})` : header;
}
