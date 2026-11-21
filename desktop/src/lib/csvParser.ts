/**
 * CSV parsing for data import.
 *
 * Two things matter beyond splitting on commas:
 *
 * 1. **Source columns are positional.** `headers[i]` and `rows[r][i]` describe
 *    source column `i`. Headers are *labels*, not keys: a file may repeat a
 *    header, and looking a column up by header text would copy one column's
 *    values into another column's target.
 * 2. **Empty string is not NULL.** An unquoted empty field means "no value
 *    here" (NULL once imported); a quoted empty field (`""`) is a deliberate
 *    empty string. Only the declared column type can decide what that means,
 *    so the parser reports which one it saw and lets conversion decide.
 *
 * Malformed input is refused rather than repaired: an unterminated quoted
 * field, a quote inside an unquoted field, or a row whose width differs from
 * the header all throw before any of the file is staged. Silently padding or
 * truncating rows imports invented data.
 */

/** One parsed CSV field. `quoted` records whether the file author quoted it. */
export interface CsvCell {
  text: string;
  quoted: boolean;
}

export interface ParsedCsv {
  /** Field labels, in source order. May repeat — never use as a key. */
  headers: string[];
  /** Data rows; `rows[r][i]` is source column `i` of data row `r`. */
  rows: CsvCell[][];
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, "");
  if (text.trim() === "") throw new Error("CSV input is empty");

  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  /** The current row has a comma or a quote, so it is not a blank line. */
  let rowTouched = false;
  let line = 1;
  let quoteLine = 1;

  const endField = () => {
    row.push({ text: field, quoted });
    field = "";
    quoted = false;
  };

  const endRow = () => {
    endField();
    // A wholly empty physical line (no delimiter, no quote) is layout, not a
    // row: trailing blank lines are common and are not data.
    if (!(row.length === 1 && row[0].text === "" && !rowTouched)) rows.push(row);
    row = [];
    rowTouched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          // A closing quote ends the field: only a delimiter, a line break or
          // the end of the file may follow. Gluing the next character on
          // (`"a"b` → `ab`) would import a value the file never held.
          const next = text[i + 1];
          if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
            throw new Error(
              `CSV has text after a closing quote (line ${line}). Quote the whole field and double any quote inside it ("").`,
            );
          }
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field !== "") {
        // RFC 4180 allows a quote only at the start of a field; accepting one
        // mid-field makes `5" screen` and a broken quote indistinguishable.
        throw new Error(
          `CSV has a stray quote inside an unquoted field (line ${line}). Quote the whole field and double any quote inside it ("") to keep it.`,
        );
      }
      inQuotes = true;
      quoted = true;
      rowTouched = true;
      quoteLine = line;
      continue;
    }

    if (ch === ",") {
      rowTouched = true;
      endField();
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      continue;
    }

    field += ch;
  }

  if (inQuotes) {
    throw new Error(
      `CSV has an unterminated quoted field (line ${quoteLine}). Every opening quote needs a closing quote.`,
    );
  }
  if (field !== "" || row.length > 0 || quoted) endRow();

  const [headers, ...data] = rows;
  if (!headers) throw new Error("CSV input is empty");

  const width = headers.length;
  for (let r = 0; r < data.length; r++) {
    const cells = data[r];
    if (cells.length !== width) {
      throw new Error(
        `CSV row ${r + 1} has ${cells.length} field${cells.length === 1 ? "" : "s"} but the header has ${width}. ` +
          "Every row must have the same number of fields; no row is padded or truncated.",
      );
    }
  }

  return { headers: headers.map((h) => h.text), rows: data };
}
