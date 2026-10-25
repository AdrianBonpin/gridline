import { describe, it, expect } from "vitest";
import { splitStatements } from "./sqlScan";

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
