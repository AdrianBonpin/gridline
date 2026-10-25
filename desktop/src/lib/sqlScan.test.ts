import { describe, it, expect } from "vitest";
import {
  analyzeScript,
  classifyStatement,
  hasSchemaModifyingStatement,
  scanWords,
  splitStatements,
} from "./sqlScan";

/**
 * Shared cross-language vectors. Every row of this table also appears in
 * `desktop/src-tauri/src/db/sql_split.test.rs::shared_cross_language_vectors`.
 * Keep the two tables byte-identical.
 */
const SHARED_VECTORS: Array<{ sql: string; expected: string[] }> = [
  { sql: "SELECT 1; SELECT 2", expected: ["SELECT 1", "SELECT 2"] },
  { sql: "SELECT 'a;b'; SELECT 2", expected: ["SELECT 'a;b'", "SELECT 2"] },
  { sql: "SELECT 'it''s'; SELECT 2", expected: ["SELECT 'it''s'", "SELECT 2"] },
  { sql: 'SELECT "a;b"; SELECT `x;y`', expected: ['SELECT "a;b"', "SELECT `x;y`"] },
  {
    sql: "SELECT 1 -- ; not a boundary\n; SELECT 2",
    expected: ["SELECT 1 -- ; not a boundary", "SELECT 2"],
  },
  { sql: "SELECT /* ; */ 1", expected: ["SELECT /* ; */ 1"] },
  { sql: "SELECT $$a;b$$; SELECT 2", expected: ["SELECT $$a;b$$", "SELECT 2"] },
  { sql: "SELECT $fn$x;y$fn$; SELECT 2", expected: ["SELECT $fn$x;y$fn$", "SELECT 2"] },
  { sql: "SELECT a$b", expected: ["SELECT a$b"] },
  { sql: "SELECT 1$", expected: ["SELECT 1$"] },
  { sql: "-- nothing\n; SELECT 1", expected: ["SELECT 1"] },
  { sql: "/* c */", expected: [] },
  { sql: "", expected: [] },
  { sql: "  ;  ; ", expected: [] },
  {
    sql: "DELIMITER //\nSELECT 1; SELECT 2//\nDELIMITER ;\nSELECT 3;",
    expected: ["SELECT 1; SELECT 2", "SELECT 3"],
  },
];

describe("splitStatements — shared cross-language vectors", () => {
  for (const { sql, expected } of SHARED_VECTORS) {
    it(`splits ${JSON.stringify(sql)}`, () => {
      expect(splitStatements(sql)).toEqual(expected);
    });
  }
});

describe("splitStatements — conservative edge cases", () => {
  it("keeps an unterminated quote inside one statement (never splits it)", () => {
    expect(splitStatements("SELECT 'a;b")).toEqual(["SELECT 'a;b"]);
  });

  it("keeps an unterminated block comment inside one statement", () => {
    expect(splitStatements("SELECT /* a;b")).toEqual(["SELECT /* a;b"]);
  });

  // PLAN DEVIATION (Task 2): the plan expected ["SELECT $$a;b"], but that is
  // not what the reference Rust splitter does — `dollar_quote_end` returns None
  // for an unclosed body, so the `$`s are literal text and the `;` still
  // splits. Verified against `cargo test` output: ["SELECT $$a", "b"].
  it("treats an unclosed dollar quote as literal text, so a following ; still splits", () => {
    expect(splitStatements("SELECT $$a;b")).toEqual(["SELECT $$a", "b"]);
  });

  // PLAN DEVIATION (Task 2): statement text keeps its comments verbatim, which
  // is the Rust contract (`sql_split.rs` module docs). The directive is still
  // ignored — only one statement is produced.
  it("ignores a DELIMITER directive inside a line comment", () => {
    expect(splitStatements("-- DELIMITER //\nSELECT 1;")).toEqual(["-- DELIMITER //\nSELECT 1"]);
  });

  it("ignores a DELIMITER directive inside a quoted string", () => {
    expect(splitStatements("SELECT 'DELIMITER //';\nSELECT 2;")).toEqual([
      "SELECT 'DELIMITER //'",
      "SELECT 2",
    ]);
  });

  // PLAN DEVIATION (Task 2): the directive is rejected (delimiter stays `;`),
  // so the line is ordinary text and stays inside the single statement it
  // terminates — matching the existing Rust test
  // `delimiter_with_trailing_junk_is_ordinary_text`.
  it("does not treat a DELIMITER-like word with trailing text as a directive", () => {
    expect(splitStatements("DELIMITER // extra\nSELECT 1;")).toEqual([
      "DELIMITER // extra\nSELECT 1",
    ]);
  });

  it("treats a MySQL executable comment as a statement", () => {
    expect(splitStatements("/*!50003 CREATE PROCEDURE p() SELECT 1 */")).toEqual([
      "/*!50003 CREATE PROCEDURE p() SELECT 1 */",
    ]);
  });
});

describe("classifyStatement", () => {
  it("classifies reads", () => {
    for (const sql of [
      "SELECT * FROM users",
      "VALUES (1)",
      "EXPLAIN SELECT 1",
      "SHOW TABLES",
      "SET search_path = public",
      "BEGIN",
      "COMMIT",
      "VACUUM",
      "ANALYZE users",
      "REINDEX INDEX i",
      "PRAGMA foreign_keys",
    ]) {
      expect(classifyStatement(sql), sql).toBe("read");
    }
  });

  it("classifies writes", () => {
    for (const sql of [
      "INSERT INTO users VALUES (1)",
      "UPDATE users SET name = 'x'",
      "DELETE FROM users",
      "REPLACE INTO users VALUES (1)",
      "MERGE INTO users USING src ON true WHEN MATCHED THEN DELETE",
      "LOAD DATA INFILE 'a.csv' INTO TABLE t",
    ]) {
      expect(classifyStatement(sql), sql).toBe("write");
    }
  });

  it("classifies schema changes", () => {
    for (const sql of [
      "CREATE TABLE t (id int)",
      "DROP TABLE t",
      "ALTER TABLE t ADD COLUMN a int",
      "RENAME TABLE a TO b",
      "COMMENT ON TABLE t IS 'x'",
      "GRANT SELECT ON t TO bob",
      "REVOKE SELECT ON t FROM bob",
      "TRUNCATE TABLE t",
      "REFRESH MATERIALIZED VIEW mv",
    ]) {
      expect(classifyStatement(sql), sql).toBe("schema");
    }
  });

  it("classifies an unrecognised verb as unknown (fail closed)", () => {
    expect(classifyStatement("CALL do_something()")).toBe("unknown");
    expect(classifyStatement("COPY t FROM '/tmp/x.csv'")).toBe("unknown");
    expect(classifyStatement("EXECUTE stmt")).toBe("unknown");
  });

  it("treats a comment-only statement as read (nothing executes)", () => {
    expect(classifyStatement("-- nothing here")).toBe("read");
    expect(classifyStatement("/* nothing here */")).toBe("read");
  });

  it("classifies WITH by its CTE bodies, not just the trailing verb", () => {
    expect(classifyStatement("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe("read");
    expect(classifyStatement("WITH removed AS (SELECT 1) DELETE FROM demo")).toBe("write");
    expect(classifyStatement("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d")).toBe("write");
    expect(classifyStatement("WITH u AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM u")).toBe("write");
    expect(classifyStatement("WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i")).toBe("write");
  });

  it("ignores keywords inside quoted strings, comments and dollar quotes", () => {
    expect(classifyStatement("SELECT 'DROP TABLE t'")).toBe("read");
    expect(classifyStatement('SELECT "DELETE FROM t"')).toBe("read");
    expect(classifyStatement("SELECT `UPDATE t SET a=1`")).toBe("read");
    expect(classifyStatement("-- DROP TABLE t\nSELECT 1")).toBe("read");
    expect(classifyStatement("/* DELETE FROM t */ SELECT 1")).toBe("read");
    expect(classifyStatement("SELECT $$ DELETE FROM t $$")).toBe("read");
    expect(classifyStatement("SELECT $fn$ UPDATE t $fn$")).toBe("read");
  });
});

describe("analyzeScript", () => {
  it("flags a destructive statement that is not the first (#50 repro)", () => {
    expect(analyzeScript("SELECT 1; DROP TABLE demo;")).toEqual({
      destructive: true,
      firstDestructiveIndex: 2,
      totalStatements: 2,
      reason: "schema",
    });
  });

  it("flags a leading destructive statement", () => {
    expect(analyzeScript("INSERT INTO t VALUES (1); SELECT 1;")).toEqual({
      destructive: true,
      firstDestructiveIndex: 1,
      totalStatements: 2,
      reason: "write",
    });
  });

  it("flags a data-modifying CTE (#50 repro)", () => {
    expect(analyzeScript("WITH removed AS (SELECT 1) DELETE FROM demo;")).toEqual({
      destructive: true,
      firstDestructiveIndex: 1,
      totalStatements: 1,
      reason: "write",
    });
  });

  it("does not flag a read-only script", () => {
    expect(analyzeScript("SELECT 1; SELECT 2; EXPLAIN SELECT 3;")).toEqual({
      destructive: false,
      firstDestructiveIndex: null,
      totalStatements: 3,
      reason: null,
    });
  });

  it("does not flag quoted or commented keywords", () => {
    expect(analyzeScript("SELECT 'DROP TABLE t'; -- DELETE FROM t\nSELECT 2;")).toEqual({
      destructive: false,
      firstDestructiveIndex: null,
      totalStatements: 2,
      reason: null,
    });
    expect(analyzeScript("SELECT $$ DROP TABLE t $$;")).toEqual({
      destructive: false,
      firstDestructiveIndex: null,
      totalStatements: 1,
      reason: null,
    });
  });

  it("does not flag an empty or comment-only script", () => {
    for (const sql of ["", "   ", "-- just a note", "/* just a note */"]) {
      expect(analyzeScript(sql).destructive, sql).toBe(false);
    }
  });

  it("flags an unknown verb", () => {
    expect(analyzeScript("CALL refresh_all();")).toEqual({
      destructive: true,
      firstDestructiveIndex: 1,
      totalStatements: 1,
      reason: "unknown",
    });
  });
});

describe("hasSchemaModifyingStatement", () => {
  it("is true when a later statement is DDL", () => {
    expect(hasSchemaModifyingStatement("SELECT 1; CREATE TABLE t (id int);")).toBe(true);
  });
  it("is false for data-only changes", () => {
    expect(hasSchemaModifyingStatement("INSERT INTO t VALUES (1); DELETE FROM t;")).toBe(false);
  });
  it("is true for TRUNCATE (preserves the documented tree-refresh behaviour)", () => {
    expect(hasSchemaModifyingStatement("TRUNCATE TABLE t")).toBe(true);
  });
  it("is false for an empty script", () => {
    expect(hasSchemaModifyingStatement("")).toBe(false);
  });
});

describe("scanWords", () => {
  it("returns bare tokens outside quotes and comments, uppercased", () => {
    // PLAN DEVIATION (Task 3): the plan wrote `$$ x $$` with "X" in the
    // expectation, but "x" sits *inside* the dollar quote, which Task 2's
    // `dollarQuoteEnd` skips — and the plan's own docstring says
    // "dollar-quoted bodies skipped". Keeping the expected array verbatim and
    // moving the bare token outside the quote is strictly stronger: it proves
    // both that `x` is returned and that the dollar-quoted body is not leaked.
    expect(scanWords("select a -- drop\nfrom \"T\"; /* delete */ $$ ignored $$ x")).toEqual([
      "SELECT",
      "A",
      "FROM",
      "X",
    ]);
  });
});

// Spec §2.2 P1: the guard runs synchronously on every Run and must not stall
// the UI on a large script. The local budget is <2 ms for 1 MB; CI runners
// vary, so the assertion ceiling is generous — it still catches a quadratic
// implementation, which is the failure mode that matters.
describe("performance budget", () => {
  it("splits + classifies a ~1 MB script without going quadratic", () => {
    const oneStatement = "INSERT INTO users (id, name) VALUES (1, 'a;b');\n";
    const script = oneStatement.repeat(
      Math.ceil(1_000_000 / oneStatement.length),
    );
    expect(script.length).toBeGreaterThan(1_000_000);

    const started = performance.now();
    const analysis = analyzeScript(script);
    const elapsed = performance.now() - started;

    expect(analysis.destructive).toBe(true);
    expect(elapsed).toBeLessThan(250);
  });
});
