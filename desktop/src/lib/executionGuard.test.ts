import { describe, it, expect } from "vitest";
import { analyzeForExecution, planExecution } from "./executionGuard";
import { analyzeScript, type ScriptAnalysis } from "./sqlScan";

const UNPROVABLE: ScriptAnalysis = {
  destructive: true,
  firstDestructiveIndex: 1,
  totalStatements: 1,
  reason: "unknown",
};

const READ_ONLY: ScriptAnalysis = {
  destructive: false,
  firstDestructiveIndex: null,
  totalStatements: 1,
  reason: null,
};

describe("analyzeForExecution", () => {
  it("delegates to the shared script analyzer", () => {
    expect(analyzeForExecution("DELETE FROM users")).toEqual(
      analyzeScript("DELETE FROM users"),
    );
    expect(analyzeForExecution("SELECT 1").destructive).toBe(false);
  });

  it("fails closed when the analyzer throws", () => {
    const analysis = analyzeForExecution("SELECT 1", () => {
      throw new Error("tokenizer exploded");
    });
    expect(analysis).toEqual(UNPROVABLE);
  });

  it("fails closed when the analyzer returns something unusable", () => {
    // A missing/garbled verdict is not evidence of safety, so confirmation is
    // required rather than assuming the script is read-only.
    expect(analyzeForExecution("SELECT 1", () => undefined as never)).toEqual(
      UNPROVABLE,
    );
    expect(
      analyzeForExecution("SELECT 1", () => ({}) as never),
    ).toEqual(UNPROVABLE);
  });

  it("does not ask twice about an empty script", () => {
    expect(analyzeForExecution("   \n\t ").destructive).toBe(false);
  });
});

describe("planExecution", () => {
  it("runs read-only text immediately", () => {
    expect(planExecution("SELECT 1")).toEqual({
      sql: "SELECT 1",
      hasText: true,
      needsConfirmation: false,
      analysis: READ_ONLY,
    });
  });

  it("requires confirmation for data-modifying and schema-modifying text", () => {
    expect(planExecution("DELETE FROM users").needsConfirmation).toBe(true);
    expect(planExecution("DROP TABLE users").needsConfirmation).toBe(true);
  });

  it("requires confirmation for text it cannot classify (fail closed)", () => {
    expect(planExecution("CALL refresh_all()").needsConfirmation).toBe(true);
  });

  it("requires confirmation when the analyzer fails (fail closed)", () => {
    expect(
      planExecution("SELECT 1", () => {
        throw new Error("boom");
      }).needsConfirmation,
    ).toBe(true);
  });

  it("trims the text it classifies so the reviewed text is the executed text", () => {
    expect(planExecution("  SELECT 1 \n")).toEqual({
      sql: "SELECT 1",
      hasText: true,
      needsConfirmation: false,
      analysis: READ_ONLY,
    });
  });

  it("never runs blank text", () => {
    expect(planExecution("")).toEqual({
      sql: "",
      hasText: false,
      needsConfirmation: false,
      analysis: {
        destructive: false,
        firstDestructiveIndex: null,
        totalStatements: 0,
        reason: null,
      },
    });
    expect(planExecution("  \n\t ").hasText).toBe(false);
  });
});
