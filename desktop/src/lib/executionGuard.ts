/** The single routing seam every Execution Entry Point goes through.
 *
 * `AGENTS.md`/`GLOSSARY.md` define an **Execution Entry Point** as any user
 * action or timer that can send SQL to a database — the run button, the
 * toolbar re-run control, a history or saved-query run, refresh, auto-refresh,
 * paging, export. Each of those must apply the same destructive-script
 * analysis; routing them all through `planExecution` is what makes "changing
 * the entry point cannot bypass confirmation" a structural property instead of
 * five separate call sites that happen to agree today.
 *
 * Classification itself lives in `sqlScan.ts` (ticket 15 — one analyzer, one
 * vector corpus shared with the Rust backend). This module adds only the
 * routing decision and the fail-closed wrapper around it.
 */
import { analyzeScript, type ScriptAnalysis } from "./sqlScan";

export type ExecutionAnalyzer = (sql: string) => ScriptAnalysis;

/** Verdict used whenever classification could not be established. */
const UNPROVABLE: ScriptAnalysis = {
  destructive: true,
  firstDestructiveIndex: 1,
  totalStatements: 1,
  reason: "unknown",
};

const NOTHING_TO_RUN: ScriptAnalysis = {
  destructive: false,
  firstDestructiveIndex: null,
  totalStatements: 0,
  reason: null,
};

/**
 * Classify `sql` for execution, failing closed.
 *
 * A blank script executes nothing, so it needs no confirmation. Anything else
 * that the analyzer could not judge — it threw, or answered without a usable
 * verdict — is treated exactly like an unprovable statement: confirmation is
 * required. Never weaken this to `false`: an unclassified script may write.
 */
export function analyzeForExecution(
  sql: string,
  analyze: ExecutionAnalyzer = analyzeScript,
): ScriptAnalysis {
  if (sql.trim() === "") return NOTHING_TO_RUN;
  let analysis: ScriptAnalysis | null | undefined;
  try {
    analysis = analyze(sql);
  } catch {
    return UNPROVABLE;
  }
  if (!analysis || typeof analysis.destructive !== "boolean") {
    return UNPROVABLE;
  }
  return analysis;
}

export interface ExecutionPlan {
  /** Exactly the text to execute — nothing else may be substituted for it. */
  sql: string;
  /** False when the request carries no executable text (nothing to run). */
  hasText: boolean;
  /** The verdict this request was routed on. */
  analysis: ScriptAnalysis;
  /** True when the user must confirm before the text is sent to the database. */
  needsConfirmation: boolean;
}

/**
 * Decide what an Execution Entry Point should do with `sql`.
 *
 * The text is trimmed first so classification and execution see the same
 * string: a verdict about `" DELETE …"` must not be applied to a differently
 * framed script. Callers route on `needsConfirmation` and execute `plan.sql`,
 * which is why editing the editor (or a stale cached verdict) cannot run text
 * that was never reviewed.
 */
export function planExecution(
  sql: string,
  analyze: ExecutionAnalyzer = analyzeScript,
): ExecutionPlan {
  const text = sql.trim();
  if (text === "") {
    return {
      sql: "",
      hasText: false,
      analysis: NOTHING_TO_RUN,
      needsConfirmation: false,
    };
  }
  const analysis = analyzeForExecution(text, analyze);
  return {
    sql: text,
    hasText: true,
    analysis,
    needsConfirmation: analysis.destructive,
  };
}
