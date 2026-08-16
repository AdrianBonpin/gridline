import { zipSync, strToU8 } from "fflate";
import type { ColumnInfo } from "./types";

/** Minimal OOXML spreadsheet: one sheet, every cell as an inline string
 * (t="inlineStr") so Excel never evaluates a cell as a formula — the
 * formula-injection mitigation required by the spec. */
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

function buildColsXML(columns: ColumnInfo[]): string {
  const maxW = columns.map((c) => Math.min(60, Math.max(8, c.name.length + 2)));
  return `<cols>${maxW.map((w, i) => `\n  <col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}\n</cols>`;
}

function buildCellsXML(rows: unknown[][], columns: ColumnInfo[]): string {
  let cells = "";
  cells += `<row r="1">` + columns
    .map((c, i) => `<c r="${colLetter(i + 1)}1" t="inlineStr"><is><t>${esc(c.name)}</t></is></c>`)
    .join("") + `</row>`;
  rows.forEach((row, rIdx) => {
    const r = rIdx + 2;
    cells += `<row r="${r}">` + row
      .map((v, i) => {
        const ref = `${colLetter(i + 1)}${r}`;
        const t = v === null || v === undefined ? "" : String(v);
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(t)}</t></is></c>`;
      })
      .join("") + `</row>`;
  });
  return cells;
}

export function buildXlsx(rows: unknown[][], columns: ColumnInfo[]): Uint8Array {
  const colsXML = buildColsXML(columns);
  const cells = buildCellsXML(rows, columns);

  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXML}<sheetData>${cells}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(ct),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
  });
}