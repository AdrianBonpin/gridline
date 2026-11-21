import { describe, it, expect } from "vitest";
import corpus from "../../fixtures/sql-classification-vectors.json";
import { analyzeScript, classifyStatement, splitStatements } from "./sqlScan";

/**
 * The SQL safety corpus is a single JSON file read by BOTH languages:
 *
 *   desktop/fixtures/sql-classification-vectors.json          <- the corpus
 *   desktop/src/lib/sqlScanCorpus.test.ts                     <- this file (TS)
 *   desktop/src-tauri/src/db/sql_classify.test.rs             <- Rust, same file
 *
 * Every vector asserts the split statements, the per-statement classification
 * and the whole script analysis. Neither language owns the expectations, so a
 * drift between the frontend guard and the backend classifier fails a test
 * instead of surviving as a second hand-maintained table.
 */

interface Vector {
  id: string;
  sql: string;
  statements: string[];
  kinds: string[];
  analysis: {
    destructive: boolean;
    firstDestructiveIndex: number | null;
    totalStatements: number;
    reason: string | null;
  };
}

const vectors = corpus.vectors as unknown as Vector[];

describe("shared SQL classification corpus", () => {
  it("is a non-empty corpus with unique vector ids", () => {
    expect(vectors.length).toBeGreaterThan(10);
    const ids = vectors.map((vector) => vector.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const vector of vectors) {
      expect(vector.id, vector.sql).toMatch(/^[a-z0-9-]+$/);
    }
  });

  for (const vector of vectors) {
    it(`classifies ${vector.id}: ${JSON.stringify(vector.sql)}`, () => {
      const statements = splitStatements(vector.sql);
      expect(statements).toEqual(vector.statements);

      // Every split statement is classified, so a splitter change that hides a
      // statement from the classifier cannot pass unnoticed.
      expect(statements.map((statement) => classifyStatement(statement))).toEqual(vector.kinds);

      expect(analyzeScript(vector.sql)).toEqual(vector.analysis);
    });
  }
});
