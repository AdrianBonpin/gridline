/** Pure SQL splitter used by the destructive-query guard.
 *
 * Mirrors `desktop/src-tauri/src/db/sql_split.rs`. The two must accept the
 * same language — `sqlScan.test.ts` and `sql_split.test.rs` assert the same
 * input vectors so drift becomes a test failure, not a code-review question.
 *
 * Understood constructs: single/double/backtick quoting with doubled-quote
 * escapes, `--` line comments, C-style block comments, PostgreSQL
 * dollar-quoting (`$$…$$`, `$tag$…$tag$`), and MySQL `DELIMITER` directives.
 * Conservative by design: anything we cannot confidently close stays inside
 * the current statement rather than being split into a fragment that might
 * still be executable.
 */

type Chars = string[];

/** Read a quoted region starting at `chars[i] === quote`. Doubled quotes escape. */
function readQuoted(chars: Chars, i: number, quote: string): { text: string; next: number } {
  let out = quote;
  let j = i + 1;
  while (j < chars.length) {
    const c = chars[j];
    out += c;
    j += 1;
    if (c === quote) {
      if (j < chars.length && chars[j] === quote) {
        out += quote;
        j += 1;
      } else {
        break;
      }
    }
  }
  return { text: out, next: j };
}

/** Read through the first `stop` match (inclusive) or to the end of input. */
function readUntil(
  chars: Chars,
  i: number,
  stop: (c: string) => boolean,
): { text: string; next: number } {
  let out = "";
  let j = i;
  while (j < chars.length) {
    const c = chars[j];
    out += c;
    j += 1;
    if (stop(c)) break;
  }
  return { text: out, next: j };
}

/** Read a C-style block comment (no nesting). */
function readBlockComment(chars: Chars, i: number): { text: string; next: number } {
  let out = "/*";
  let j = i + 2;
  while (j < chars.length) {
    const c = chars[j];
    out += c;
    j += 1;
    if (c === "*" && chars[j] === "/") {
      out += "/";
      j += 1;
      break;
    }
  }
  return { text: out, next: j };
}

/** Index just past the closing `$tag$`, or null when this is not a closable dollar quote. */
function dollarQuoteEnd(chars: Chars, start: number): number | null {
  let j = start + 1;
  if (j < chars.length && chars[j] === "$") {
    return findDollarClose(chars, j + 1, "");
  }
  let tag = "";
  while (j < chars.length && /[A-Za-z0-9_]/.test(chars[j])) {
    tag += chars[j];
    j += 1;
  }
  if (tag === "" || j >= chars.length || chars[j] !== "$") return null;
  return findDollarClose(chars, j + 1, tag);
}

function findDollarClose(chars: Chars, from: number, tag: string): number | null {
  const closing = Array.from(`$${tag}$`);
  for (let j = from; j + closing.length <= chars.length; j += 1) {
    let hit = true;
    for (let k = 0; k < closing.length; k += 1) {
      if (chars[j + k] !== closing[k]) {
        hit = false;
        break;
      }
    }
    if (hit) return j + closing.length;
  }
  return null;
}

/** True if the fragment contains anything other than whitespace and comments. */
export function hasExecutableText(stmt: string): boolean {
  const chars: Chars = Array.from(stmt);
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === "'" || c === '"' || c === "`") return true;
    if (c === "-" && chars[i + 1] === "-") {
      i = readUntil(chars, i, (ch) => ch === "\n").next;
      continue;
    }
    if (c === "/" && chars[i + 1] === "*") {
      // MySQL executable comments run on the server, so a fragment made only
      // of one is still a statement.
      if (chars[i + 2] === "!") return true;
      i = readBlockComment(chars, i).next;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    return true;
  }
  return false;
}

/** Match a MySQL `DELIMITER <token>` directive that occupies a whole line. */
function matchDelimiterDirective(chars: Chars, i: number): { end: number; token: string } | null {
  let j = i;
  while (j < chars.length && (chars[j] === " " || chars[j] === "\t")) j += 1;
  for (const expected of "DELIMITER") {
    if (j >= chars.length || chars[j].toUpperCase() !== expected) return null;
    j += 1;
  }
  if (j >= chars.length || (chars[j] !== " " && chars[j] !== "\t")) return null;
  while (j < chars.length && (chars[j] === " " || chars[j] === "\t")) j += 1;
  const start = j;
  while (j < chars.length && ![" ", "\t", "\r", "\n"].includes(chars[j])) j += 1;
  if (start === j) return null;
  const token = chars.slice(start, j).join("");
  let k = j;
  while (k < chars.length && (chars[k] === " " || chars[k] === "\t")) k += 1;
  if (k < chars.length && chars[k] !== "\r" && chars[k] !== "\n") return null;
  while (k < chars.length && (chars[k] === "\r" || chars[k] === "\n")) k += 1;
  return { end: k, token };
}

/** Split `sql` into ordered statement texts. Comment-only fragments are dropped. */
export function splitStatements(sql: string): string[] {
  const chars: Chars = Array.from(sql);
  const statements: string[] = [];
  let current = "";
  let delimiter = [";"];
  let i = 0;

  const flush = () => {
    const text = current.trim();
    if (hasExecutableText(text)) statements.push(text);
    current = "";
  };

  while (i < chars.length) {
    if (i === 0 || chars[i - 1] === "\n") {
      const directive = matchDelimiterDirective(chars, i);
      if (directive) {
        delimiter = Array.from(directive.token);
        i = directive.end;
        continue;
      }
    }

    const c = chars[i];
    const atDelimiter =
      i + delimiter.length <= chars.length &&
      delimiter.every((d, k) => chars[i + k] === d);

    if (c === "'" || c === '"' || c === "`") {
      const quoted = readQuoted(chars, i, c);
      current += quoted.text;
      i = quoted.next;
      continue;
    }
    if (c === "-" && chars[i + 1] === "-") {
      const line = readUntil(chars, i, (ch) => ch === "\n");
      current += line.text;
      i = line.next;
      continue;
    }
    if (c === "/" && chars[i + 1] === "*") {
      const block = readBlockComment(chars, i);
      current += block.text;
      i = block.next;
      continue;
    }
    if (atDelimiter) {
      flush();
      i += delimiter.length;
      continue;
    }
    if (c === "$") {
      const end = dollarQuoteEnd(chars, i);
      if (end !== null) {
        current += chars.slice(i, end).join("");
        i = end;
        continue;
      }
    }
    current += c;
    i += 1;
  }

  flush();
  return statements;
}

// --- classification ---------------------------------------------------------

/**
 * Verbs that never change data or schema. Allowlist-based on purpose: an
 * unlisted verb falls through to `unknown`, which asks for confirmation
 * (issue #50: "ask for confirmation when classification is uncertain").
 */
const READ_VERBS = new Set([
  "SELECT", "VALUES", "TABLE", "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
  "SET", "RESET", "BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT",
  "SAVEPOINT", "RELEASE", "ANALYZE", "VACUUM", "REINDEX", "CLUSTER",
  "CHECKPOINT", "DECLARE", "FETCH", "MOVE", "CLOSE", "LISTEN", "UNLISTEN",
  "NOTIFY", "LOCK", "UNLOCK", "DISCARD", "DEALLOCATE", "PREPARE", "PRAGMA",
  "USE", "HELP",
]);

/** Verbs that change rows. */
const WRITE_VERBS = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT", "LOAD",
]);

/**
 * Verbs that change schema. `TRUNCATE` lives here (not in WRITE_VERBS) to
 * preserve the documented behaviour that the object tree refreshes after a
 * schema-modifying run — `TRUNCATE` is still destructive, so it prompts
 * either way.
 */
const SCHEMA_VERBS = new Set([
  "CREATE", "DROP", "ALTER", "RENAME", "COMMENT", "GRANT", "REVOKE",
  "REFRESH", "IMPORT", "TRUNCATE",
]);

/** Verbs inside a `WITH` chain that make the whole statement a write. */
const CTE_WRITE_VERBS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE"]);

export type StatementKind = "read" | "write" | "schema" | "unknown";

export interface ScriptAnalysis {
  /** True when running this script needs an explicit confirmation. */
  destructive: boolean;
  /** 1-based index of the first statement needing confirmation, else null. */
  firstDestructiveIndex: number | null;
  totalStatements: number;
  reason: "write" | "schema" | "unknown" | null;
}

/**
 * Every bare word in `sql`, uppercased, with quoted regions, comments and
 * dollar-quoted bodies skipped. This is what makes keyword detection
 * immune to `SELECT 'DROP TABLE t'`.
 */
export function scanWords(sql: string): string[] {
  const chars: Chars = Array.from(sql);
  const words: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === "'" || c === '"' || c === "`") {
      i = readQuoted(chars, i, c).next;
      continue;
    }
    if (c === "-" && chars[i + 1] === "-") {
      i = readUntil(chars, i, (ch) => ch === "\n").next;
      continue;
    }
    if (c === "/" && chars[i + 1] === "*") {
      i = readBlockComment(chars, i).next;
      continue;
    }
    if (c === "$") {
      const end = dollarQuoteEnd(chars, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let word = "";
      while (i < chars.length && /[A-Za-z0-9_$]/.test(chars[i])) {
        word += chars[i];
        i += 1;
      }
      words.push(word.toUpperCase());
      continue;
    }
    i += 1;
  }
  return words;
}

/** Classify a single statement. See `SCRIPT_DESTRUCTIVE_REASONS` for the reasons. */
export function classifyStatement(stmt: string): StatementKind {
  const words = scanWords(stmt);
  if (words.length === 0) return "read"; // nothing executes

  const first = words[0];
  if (first === "WITH") {
    // A data-modifying CTE can sit anywhere in the chain, e.g.
    //   WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d
    // which writes even though the trailing verb is SELECT. Fail closed.
    return words.slice(1).some((word) => CTE_WRITE_VERBS.has(word)) ? "write" : "read";
  }
  if (SCHEMA_VERBS.has(first)) return "schema";
  if (WRITE_VERBS.has(first)) return "write";
  if (READ_VERBS.has(first)) return "read";
  return "unknown";
}

/**
 * Inspect **every** statement in the script, not just the first one.
 * `SELECT 1; DROP TABLE demo;` must prompt (issue #50).
 */
export function analyzeScript(sql: string): ScriptAnalysis {
  const statements = splitStatements(sql);
  for (let index = 0; index < statements.length; index += 1) {
    const kind = classifyStatement(statements[index]);
    if (kind === "write" || kind === "schema" || kind === "unknown") {
      return {
        destructive: true,
        firstDestructiveIndex: index + 1,
        totalStatements: statements.length,
        reason: kind,
      };
    }
  }
  return {
    destructive: false,
    firstDestructiveIndex: null,
    totalStatements: statements.length,
    reason: null,
  };
}

/** True when ANY statement in `sql` changes schema (drives the tree refresh). */
export function hasSchemaModifyingStatement(sql: string): boolean {
  return splitStatements(sql).some((stmt) => classifyStatement(stmt) === "schema");
}
