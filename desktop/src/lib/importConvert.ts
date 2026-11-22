import { baseDeclaredType } from "./declaredType";
import { sourceColumnLabel, type ImportCell } from "./importNormalize";

/**
 * Type-driven conversion for data import.
 *
 * The pre-fix importer guessed a value's type from how it looked
 * (`/^-?\d+$/` → `Number(v)`), which turned the identifier `007` into `7`,
 * routed a 16-digit account number through a double, and stored nested JSON as
 * `"[object Object]"`. Here the *declared column type* decides:
 *
 * - `text` (and anything unrecognised) keeps the source text verbatim, so
 *   leading zeros and exact spellings survive;
 * - `integer`/`decimal` are validated and passed through as their exact decimal
 *   text — never through a JavaScript number, so big integers and long decimals
 *   keep full precision. Every engine binds text against the column type, so
 *   the server still parses the value as its own numeric type;
 * - `boolean` is validated and yields a real boolean;
 * - `json`/`jsonb` keeps the source structure (a JSON cell passes through, text
 *   is parsed as JSON), and nested structure is refused for a text column
 *   rather than silently stringified;
 * - `temporal` text passes through for the server to parse.
 *
 * An invalid value reports its data row and target column and yields no rows at
 * all: a batch is converted completely or not at all.
 */

export interface ImportTargetColumn {
  name: string;
  /** The declared type as introspected (e.g. `character varying`, `numeric(40, 34)`). */
  dataType: string | null;
}

export type ImportColumnKind = "integer" | "decimal" | "boolean" | "json" | "temporal" | "text";

const INTEGER_TYPES = new Set([
  "int", "int2", "int4", "int8", "integer", "smallint", "mediumint", "bigint", "tinyint",
  "serial", "serial2", "serial4", "serial8", "smallserial", "bigserial", "int32", "int64",
]);

const DECIMAL_TYPES = new Set([
  "numeric", "decimal", "dec", "fixed", "real", "double", "double precision",
  "float", "float4", "float8", "money",
]);

const BOOLEAN_TYPES = new Set(["boolean", "bool"]);

const JSON_TYPES = new Set(["json", "jsonb"]);

const TEMPORAL_TYPES = new Set([
  "date", "time", "timetz", "timestamp", "timestamptz", "datetime", "year", "interval",
  "time with time zone", "time without time zone",
  "timestamp with time zone", "timestamp without time zone",
]);

/**
 * Classify a declared column type into a conversion rule.
 *
 * Type modifiers and lengths are dropped (`NUMERIC(12, 4)` → `numeric`).
 * Arrays are deliberately `text`: an array literal in a CSV cell must reach the
 * server as the text it is, not be re-quoted by a scalar converter.
 */
export function importColumnKind(dataType: string | null | undefined): ImportColumnKind {
  const raw = (dataType ?? "").trim().toLowerCase();
  if (raw === "") return "text";
  if (raw.endsWith("]") || raw === "array") return "text";

  const base = baseDeclaredType(raw);

  if (INTEGER_TYPES.has(base)) return "integer";
  if (DECIMAL_TYPES.has(base)) return "decimal";
  if (BOOLEAN_TYPES.has(base)) return "boolean";
  if (JSON_TYPES.has(base)) return "json";
  if (TEMPORAL_TYPES.has(base)) return "temporal";
  return "text";
}

/** A resolved import: which source column feeds which target, and how. */
export interface ImportPlan {
  /** Target column names, in source-column order. */
  columns: string[];
  /** Source column index feeding each target (parallel to `columns`). */
  sourceIndexes: number[];
  /** Conversion rule per target (parallel to `columns`). */
  kinds: ImportColumnKind[];
}

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

/**
 * Resolve a positional mapping (source index → target index, or `null` to skip)
 * into an {@link ImportPlan}.
 *
 * A mapping is indexed by *source position*, never by header text, so duplicate
 * headers cannot collapse into one entry. Two source columns aiming at the same
 * target are refused: the second would silently overwrite the first, or the
 * batch would insert two values for one column.
 */
export function planImport(
  targets: readonly ImportTargetColumn[],
  mapping: readonly (number | null)[],
): PlanResult {
  const columns: string[] = [];
  const sourceIndexes: number[] = [];
  const kinds: ImportColumnKind[] = [];
  const claimedBy = new Map<number, number>();

  for (let sourceIndex = 0; sourceIndex < mapping.length; sourceIndex++) {
    const targetIndex = mapping[sourceIndex];
    if (targetIndex === null || targetIndex === undefined) continue;

    const target = targets[targetIndex];
    if (!target) {
      return {
        ok: false,
        error: `Source column ${sourceIndex + 1} is mapped to a column that does not exist.`,
      };
    }

    const previous = claimedBy.get(targetIndex);
    if (previous !== undefined) {
      return {
        ok: false,
        error:
          `Column "${target.name}" is mapped more than once (source columns ${previous + 1} and ${sourceIndex + 1}). ` +
          "Each target column can be imported from one source column.",
      };
    }
    claimedBy.set(targetIndex, sourceIndex);

    columns.push(target.name);
    sourceIndexes.push(sourceIndex);
    kinds.push(importColumnKind(target.dataType));
  }

  if (columns.length === 0) {
    return { ok: false, error: "Select at least one column to import." };
  }
  return { ok: true, plan: { columns, sourceIndexes, kinds } };
}

/** One value that could not be converted for its declared column type. */
export interface ImportValueError {
  /** 1-based data row (row 1 is the first row after the header). */
  row: number;
  /** Target column the value was mapped to. */
  column: string;
  /** Source column label, named by position when headers repeat. */
  sourceColumn: string;
  /** The offending value, as the source wrote it. */
  value: string;
  /** A complete, user-facing report naming row and column. */
  message: string;
}

export type ConvertResult =
  | { ok: true; rows: unknown[][] }
  | { ok: false; errors: ImportValueError[] };

const INTEGER_RE = /^[+-]?\d+$/;
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRUE_LITERALS = new Set(["true", "t", "1", "yes", "y", "on"]);
const FALSE_LITERALS = new Set(["false", "f", "0", "no", "n", "off"]);

type CellResult = { ok: true; value: unknown } | { ok: false; reason: string };

function short(value: string, max = 40): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** The source text of a cell, or `undefined` when it holds nested structure. */
function cellText(cell: ImportCell): string | undefined {
  if (cell.kind === "text") return cell.value;
  if (cell.kind === "json") {
    const value = cell.value;
    if (value === null || typeof value === "object") return undefined;
    return String(value);
  }
  return "";
}

function convertJsonCell(cell: ImportCell): CellResult {
  if (cell.kind === "json") return { ok: true, value: cell.value };
  const raw = cell.kind === "text" ? cell.value : "";
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "an empty value is not valid JSON (use NULL for no value)" };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, reason: `"${short(raw)}" is not valid JSON` };
  }
}

function convertCell(cell: ImportCell, kind: ImportColumnKind): CellResult {
  if (cell.kind === "null") return { ok: true, value: null };
  if (kind === "json") return convertJsonCell(cell);

  const text = cellText(cell);
  if (text === undefined) {
    return {
      ok: false,
      reason: "a nested JSON value cannot be stored in a non-JSON column",
    };
  }

  switch (kind) {
    case "integer": {
      const trimmed = text.trim();
      if (!INTEGER_RE.test(trimmed)) {
        return { ok: false, reason: `"${short(text)}" is not a valid integer` };
      }
      // Passed through as exact decimal text: a JavaScript number would lose
      // precision above 2^53.
      return { ok: true, value: trimmed };
    }
    case "decimal": {
      const trimmed = text.trim();
      if (!DECIMAL_RE.test(trimmed)) {
        return { ok: false, reason: `"${short(text)}" is not a valid number` };
      }
      return { ok: true, value: trimmed };
    }
    case "boolean": {
      const literal = text.trim().toLowerCase();
      if (TRUE_LITERALS.has(literal)) return { ok: true, value: true };
      if (FALSE_LITERALS.has(literal)) return { ok: true, value: false };
      return { ok: false, reason: `"${short(text)}" is not a valid boolean` };
    }
    default:
      // `text` (identifiers, phone numbers, …) and `temporal` (the server parses
      // the declared format) keep the source text as written.
      return { ok: true, value: text };
  }
}

function displayValue(cell: ImportCell): string {
  if (cell.kind === "null") return "NULL";
  if (cell.kind === "text") return cell.value;
  try {
    return JSON.stringify(cell.value) ?? String(cell.value);
  } catch {
    return String(cell.value);
  }
}

/**
 * Convert every mapped cell for its declared column type.
 *
 * Nothing is returned unless the whole batch converts: on the first invalid
 * value the caller gets every offending row/column instead of a partial batch.
 */
export function convertImportRows(
  headers: readonly string[],
  rows: readonly ImportCell[][],
  plan: ImportPlan,
): ConvertResult {
  const errors: ImportValueError[] = [];
  const converted: unknown[][] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const out: unknown[] = [];

    for (let ci = 0; ci < plan.columns.length; ci++) {
      const sourceIndex = plan.sourceIndexes[ci];
      const column = plan.columns[ci];
      const cell: ImportCell = row[sourceIndex] ?? { kind: "null" };
      const result = convertCell(cell, plan.kinds[ci]);

      if (result.ok) {
        out.push(result.value);
        continue;
      }

      const sourceColumn = sourceColumnLabel(headers, sourceIndex);
      errors.push({
        row: r + 1,
        column,
        sourceColumn,
        value: displayValue(cell),
        message: `Row ${r + 1}, column "${column}" (source "${sourceColumn}"): ${result.reason}`,
      });
    }

    converted.push(out);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows: converted };
}

/** One user-facing line for a set of conversion errors (first few + a count). */
export function describeImportErrors(errors: readonly ImportValueError[]): string {
  const shown = errors.slice(0, 5).map((e) => e.message);
  const rest = errors.length - shown.length;
  const suffix = rest > 0 ? `\n…and ${rest} more invalid value${rest === 1 ? "" : "s"}.` : "";
  return `${shown.join("\n")}${suffix}`;
}
