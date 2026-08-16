import { parseCsv } from "./csvParser";

export interface NormalizedImport {
  headers: string[];
  rows: string[][];
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

    let rows: Record<string, unknown>[];
    if (Array.isArray(parsed)) {
      rows = parsed as Record<string, unknown>[];
    } else if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed);
      const arrays = values.filter((v): v is Record<string, unknown>[] => Array.isArray(v));
      if (arrays.length === 1 && values.length === 1) {
        rows = arrays[0];
      } else {
        rows = [parsed as Record<string, unknown>];
      }
    } else {
      throw new Error("JSON import must be an array of objects or an object");
    }

    if (rows.length === 0) return { headers: [], rows: [] };

    const headers = Object.keys(rows[0] ?? {});
    const data = rows.map((r) => headers.map((h) => String((r as Record<string, unknown>)[h] ?? "")));
    return { headers, rows: data };
  }

  return parseCsv(text);
}

export function coerceRow(v: string): unknown {
  if (v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}