import { zipSync, strToU8 } from "fflate";
import { projectDeclaredCells } from "./rowIdentity";
import type { ColumnInfo } from "./types";

/** Minimal OOXML spreadsheet: one sheet. Text is written as an inline string
 * (t="inlineStr") so Excel never evaluates a cell as a formula — the
 * formula-injection mitigation required by the spec — while numbers, booleans,
 * dates and NULL keep their native Excel type instead of being stringified. */
const XML_ESCAPES: [RegExp, string][] = [
  [/&/g, "&amp;"],
  [/</g, "&lt;"],
  [/>/g, "&gt;"],
  [/"/g, "&quot;"],
];
function esc(s: string): string {
  for (const [re, w] of XML_ESCAPES) s = s.replace(re, w);
  return s;
}
function colLetter(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Characters XML 1.0 cannot carry at all; Excel rejects the workbook if they
 *  survive. Tabs and line breaks are legal and are kept. */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
/** Excel treats a bare CR as a document error; normalise to LF. */
function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(XML_ILLEGAL, "");
}

/** Style indexes into `cellXfs` in styles.xml. */
const STYLE_DATE = 1;
const STYLE_DATETIME = 2;

const NUMERIC_BASE_TYPES = new Set([
  "int", "int2", "int4", "int8", "integer", "smallint", "bigint", "tinyint",
  "mediumint", "serial", "bigserial", "smallserial", "decimal", "numeric",
  "real", "float", "float4", "float8", "double", "double precision", "number",
  "year",
]);

/** The bare base type of a declared column (`numeric(10,2)` → `numeric`). */
function baseType(dataType: string): string {
  return dataType
    .toLowerCase()
    .split("(")[0]
    .replace(/\bunsigned\b|\bzerofill\b|\bvarying\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNumericType(dataType: string): boolean {
  return NUMERIC_BASE_TYPES.has(baseType(dataType));
}

/** `date` for a calendar date, `datetime` for an instant/timestamp. */
function dateKind(dataType: string): "date" | "datetime" | null {
  const base = baseType(dataType);
  if (base === "date") return "date";
  if (base === "timestamp" || base === "timestamptz" || base === "datetime") return "datetime";
  return null;
}

/**
 * Excel's serial day number for a wall-clock ISO value.
 *
 * Excel counts days from the fictional 1899-12-30 epoch (it keeps Lotus'
 * 1900-02-29 leap-day bug), so the value is computed from UTC parts to stay
 * free of the viewer's local time zone. A trailing UTC offset is dropped: the
 * grid shows the database's wall clock, and the sheet shows the same.
 */
export function excelSerialFromIso(value: string, withTime: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, frac] = m;
  const days =
    (Date.UTC(Number(y), Number(mo) - 1, Number(d)) - Date.UTC(1899, 11, 30)) / 86_400_000;
  if (!withTime) return days;
  const seconds =
    Number(hh ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(ss ?? 0) + Number(frac ? `0.${frac}` : 0);
  return days + seconds / 86_400;
}

/** A decimal string Excel can hold exactly (≤15 significant digits). */
function exactNumericString(s: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const digits = s.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  if (digits.length === 0 || digits.length > 15) return null;
  return Number(s);
}

function textCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(normalizeText(text))}</t></is></c>`;
}

/**
 * One body cell, typed from the declared column and the decoded value:
 * a real number for numeric columns, a boolean for booleans, a formatted date
 * serial for date/timestamp columns, an empty cell for NULL, and an inline
 * string otherwise.
 */
export function xlsxCellXml(ref: string, value: unknown, dataType: string): string {
  if (value === null || value === undefined) return `<c r="${ref}"/>`;

  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  if (typeof value === "number") {
    // A non-finite numeric has no number cell form, and a numeric value in a
    // non-numeric column stays text rather than being reinterpreted.
    if (!Number.isFinite(value) || !isNumericType(dataType)) return textCell(ref, String(value));
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  if (typeof value === "string") {
    const kind = dateKind(dataType);
    if (kind) {
      const serial = excelSerialFromIso(value, kind === "datetime");
      if (serial !== null) {
        return `<c r="${ref}" s="${kind === "date" ? STYLE_DATE : STYLE_DATETIME}"><v>${serial}</v></c>`;
      }
    }
    if (isNumericType(dataType)) {
      const n = exactNumericString(value);
      // A value Excel cannot hold exactly (bigint beyond 15 digits, a value
      // with leading zeros) stays text rather than silently losing precision.
      if (n !== null) return `<c r="${ref}"><v>${n}</v></c>`;
    }
    return textCell(ref, value);
  }

  // json/jsonb arrive already decoded; keep the structure readable as JSON.
  return textCell(ref, JSON.stringify(value) ?? String(value));
}

function buildColsXML(columns: ColumnInfo[]): string {
  const maxW = columns.map((c) => Math.min(60, Math.max(8, c.name.length + 2)));
  return `<cols>${maxW.map((w, i) => `\n  <col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}\n</cols>`;
}

function buildCellsXML(rows: unknown[][], columns: ColumnInfo[]): string {
  let cells = "";
  cells += `<row r="1">` + columns
    .map((c, i) => textCell(`${colLetter(i + 1)}1`, c.name))
    .join("") + `</row>`;
  rows.forEach((row, rIdx) => {
    const r = rIdx + 2;
    // Declared columns only — a trailing backend row locator (rowid/ctid) is
    // not data and must not become a spreadsheet column.
    cells += `<row r="${r}">` + projectDeclaredCells(row, columns)
      .map((v, i) => xlsxCellXml(`${colLetter(i + 1)}${r}`, v, columns[i].data_type))
      .join("") + `</row>`;
  });
  return cells;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function buildXlsx(rows: unknown[][], columns: ColumnInfo[]): Uint8Array {
  const colsXML = buildColsXML(columns);
  const cells = buildCellsXML(rows, columns);

  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXML}<sheetData>${cells}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(ct),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
  });
}
