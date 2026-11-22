/** A destructive confirmation bound to the one request it was raised for.
 *
 * Ticket 14 routes every **Execution Entry Point** through
 * `planExecution`/`analyzeForExecution`, and ticket 15 owns the classification
 * behind it. Neither of those says *which* request a confirmation answers, so a
 * dialog raised for one tab could previously be confirmed from another tab,
 * another Change Origin, or after the SQL had been edited — and the confirm
 * handler executed whichever tab happened to be active at click time.
 *
 * This module is the binding, not the routing. A pending confirmation captures
 * the immutable identity of the request — tab, **Change Origin**, exact reviewed
 * SQL revision, and execution intent — and `confirmationStatus` re-checks that
 * identity against live viewer state. Every non-`valid` answer means the
 * confirmation must be cancelled and nothing may execute.
 *
 * The offending statement is read with the same splitter the analysis used
 * (`splitStatements`), so the statement the dialog names is the statement the
 * verdict was about.
 */
import { splitStatements, type ScriptAnalysis } from "./sqlScan";
import { isSameChangeOrigin, type ChangeOrigin } from "./changeOrigin";

/** What an entry point wants to do with the reviewed text, captured with it. */
export interface ExecutionIntent {
  page?: number;
  pageSize?: number;
}

/** The immutable request identity a confirmation is raised for. */
export interface ConfirmationRequest {
  /** The tab whose text was reviewed. Confirmation never moves to another tab. */
  tabId: string;
  /** The Change Origin the request was raised against. */
  origin: ChangeOrigin | null;
  /** Exactly the text that will be executed if the user confirms. */
  sql: string;
  /** Paging intent the confirmation is answerable for. */
  intent?: ExecutionIntent;
}

export interface PendingConfirmation {
  tabId: string;
  origin: ChangeOrigin | null;
  sql: string;
  intent: ExecutionIntent;
  analysis: ScriptAnalysis;
  /** 1-based position of the statement needing confirmation, else null. */
  statementIndex: number | null;
  /** How many statements the reviewed revision contains. */
  statementCount: number;
  /** The offending statement's text, exactly as it was classified. */
  statement: string | null;
}

/**
 * Build the pending confirmation for `request`.
 *
 * `sql` must already be the reviewed revision (`ExecutionPlan.sql`): the text is
 * bound verbatim, so confirming executes the reviewed text and nothing else.
 */
export function createPendingConfirmation(
  request: ConfirmationRequest,
  analysis: ScriptAnalysis,
): PendingConfirmation {
  const statements = splitStatements(request.sql);
  const index = analysis.firstDestructiveIndex;
  const statement =
    index !== null && index >= 1 && index <= statements.length
      ? statements[index - 1]
      : null;
  return {
    tabId: request.tabId,
    origin: request.origin,
    sql: request.sql,
    intent: request.intent ?? {},
    analysis,
    statementIndex: index,
    statementCount: analysis.totalStatements,
    statement,
  };
}

/** The viewer state a pending confirmation is re-checked against. */
export interface LiveConfirmationContext {
  activeTabId: string | null;
  tabs: readonly {
    id: string;
    tabType?: string;
    query?: string;
    origin?: ChangeOrigin | null;
  }[];
  /** The Change Origin the viewer is pointed at right now. */
  origin: ChangeOrigin | null;
}

export type ConfirmationStatus =
  | "valid"
  | "tab-closed"
  | "tab-switched"
  | "sql-edited"
  | "origin-changed";

/**
 * Does `pending` still describe the request the viewer is about to execute?
 *
 * Any answer other than `"valid"` is a cancellation: the confirmation was
 * raised for a request that no longer exists, so confirming it must execute
 * nothing at all rather than execute something else.
 */
export function confirmationStatus(
  pending: PendingConfirmation,
  live: LiveConfirmationContext,
): ConfirmationStatus {
  const tab = live.tabs.find((candidate) => candidate.id === pending.tabId);
  if (!tab) return "tab-closed";
  if (live.activeTabId !== pending.tabId) return "tab-switched";
  if (typeof tab.query === "string" && tab.query.trim() !== pending.sql) {
    return "sql-edited";
  }
  if (tab.origin && !isSameChangeOrigin(tab.origin, pending.origin)) {
    return "origin-changed";
  }
  if (!isSameChangeOrigin(pending.origin, live.origin)) return "origin-changed";
  return "valid";
}

/**
 * One-line description of the statement a confirmation is about.
 *
 * Kept pure so the dialog's wording is testable without a DOM: the position
 * comes from the analysis, the text from the splitter, and neither invents a
 * statement that the reviewed revision does not contain.
 */
export function statementPreview(
  statement: string | null,
  index: number | null,
  count: number,
): string {
  const position =
    index !== null && count > 1 ? `Statement ${index} of ${count}` : null;
  const text = statement?.trim() ? statement.trim() : null;
  return [position, text].filter((part) => part !== null).join("\n");
}
