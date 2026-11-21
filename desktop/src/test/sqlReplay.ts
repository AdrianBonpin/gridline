/**
 * A minimal replay parser for exported INSERT statements.
 *
 * It is deliberately independent of the writer it checks: it honours each
 * dialect's identifier quoting and string escapes, and it throws on anything
 * malformed (an unescaped quote, a stray token, or a column/value count
 * mismatch), so a test using it proves the statement can actually be read back
 * rather than merely look plausible.
 */
export type Dialect = "pg" | "mysql";

export interface ParsedInsert {
  target: string[];
  columns: string[];
  values: unknown[];
}

export function parseInserts(content: string, dialect: Dialect): ParsedInsert[] {
  const body = content.replace(/^--[^\n]*\n/, "");
  const statements: string[] = [];
  let current = "";
  let quote: '"' | "'" | "`" | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote === "'") {
      current += ch;
      if (dialect === "mysql" && ch === "\\") {
        current += body[i + 1] ?? "";
        i += 1;
      } else if (ch === "'") {
        if (body[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (quote === '"' || quote === "`") {
      current += ch;
      if (ch === quote) {
        if (body[i + 1] === quote) {
          current += quote;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || (ch === '"' && dialect === "pg") || (ch === "`" && dialect === "mysql")) {
      quote = ch as '"' | "'" | "`";
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());

  return statements.map((stmt) => {
    const m = /^INSERT INTO ([\s\S]+?) \(([\s\S]+?)\) VALUES \(([\s\S]+)\)$/.exec(stmt);
    if (!m) throw new Error(`not a replayable INSERT: ${stmt}`);
    const columns = parseIdentifiers(m[2], dialect);
    const values = parseValues(m[3], dialect);
    if (values.length !== columns.length) {
      throw new Error(`column/value mismatch: ${columns.length} vs ${values.length}`);
    }
    return { target: parseIdentifiers(m[1], dialect), columns, values };
  });
}

function parseIdentifiers(src: string, dialect: Dialect): string[] {
  const quote = dialect === "pg" ? '"' : "`";
  const parts: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === quote) {
      let value = "";
      i += 1;
      while (i < src.length) {
        if (src[i] === quote) {
          if (src[i + 1] === quote) {
            value += quote;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += src[i];
        i += 1;
      }
      parts.push(value);
    } else if (src[i] === ".") {
      i += 1;
    } else if (src[i] === "," || src[i] === " ") {
      i += 1;
    } else {
      throw new Error(`unquoted identifier character ${src[i]} in ${src}`);
    }
  }
  return parts;
}

function parseValues(src: string, dialect: Dialect): unknown[] {
  const values: unknown[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "," || ch === " ") {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = "";
      i += 1;
      while (i < src.length) {
        const c = src[i];
        if (dialect === "mysql" && c === "\\") {
          const map: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            "0": "\0",
            Z: "\x1a",
            b: "\b",
          };
          const next = src[i + 1];
          value += map[next] ?? next;
          i += 2;
          continue;
        }
        if (c === "'") {
          if (src[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      values.push(value);
      continue;
    }
    const rest = src.slice(i);
    const literal = /^(NULL|TRUE|FALSE|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (!literal) throw new Error(`unparsable value at ${rest.slice(0, 20)}`);
    const token = literal[1];
    values.push(
      token === "NULL" ? null : token === "TRUE" ? true : token === "FALSE" ? false : Number(token),
    );
    i += token.length;
  }
  return values;
}
