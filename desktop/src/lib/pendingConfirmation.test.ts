import { describe, it, expect } from "vitest";
import {
  confirmationStatus,
  createPendingConfirmation,
  statementPreview,
  type LiveConfirmationContext,
} from "./pendingConfirmation";
import { planExecution } from "./executionGuard";
import type { ChangeOrigin } from "./changeOrigin";

const ORIGIN: ChangeOrigin = {
  connectionId: "c1",
  database: "mydb",
  target: "postgresql|localhost|5432|dev|mydb",
  targetLabel: "postgresql dev@localhost:5432/mydb",
};

const OTHER_DATABASE: ChangeOrigin = { ...ORIGIN, database: "analytics" };
const RETARGETED: ChangeOrigin = { ...ORIGIN, target: "other-target" };

const SCRIPT = "DELETE FROM users";

/** Raise a confirmation the same way an Execution Entry Point does. */
function raise(sql: string, overrides: Record<string, unknown> = {}) {
  const plan = planExecution(sql);
  return createPendingConfirmation(
    {
      tabId: "q1",
      origin: ORIGIN,
      sql: plan.sql,
      intent: {},
      ...overrides,
    },
    plan.analysis,
  );
}

/** The live viewer state a confirmation is checked against. */
function live(
  overrides: Partial<LiveConfirmationContext> & { query?: string } = {},
): LiveConfirmationContext {
  const { query = SCRIPT, ...rest } = overrides;
  return {
    activeTabId: "q1",
    tabs: [{ id: "q1", tabType: "query", query, origin: ORIGIN }],
    origin: ORIGIN,
    ...rest,
  };
}

describe("createPendingConfirmation", () => {
  it("binds the confirmation to the exact tab, origin, SQL revision, and intent", () => {
    const pending = raise(SCRIPT, { intent: { page: 3, pageSize: 100 } });
    expect(pending).toMatchObject({
      tabId: "q1",
      origin: ORIGIN,
      sql: SCRIPT,
      intent: { page: 3, pageSize: 100 },
      statementIndex: 1,
      statementCount: 1,
      statement: SCRIPT,
    });
    // The verdict the dialog explains is the one the request was routed on.
    expect(pending.analysis.destructive).toBe(true);
  });

  it("keeps the reviewed text exactly as it will be executed, not the tab's raw text", () => {
    const pending = raise("  DELETE FROM users \n");
    expect(pending.sql).toBe(SCRIPT);
  });

  it("names the offending statement and its position in the script", () => {
    const pending = raise("SELECT 1;\nDROP TABLE demo;\nSELECT 2;");
    expect(pending.statement).toBe("DROP TABLE demo");
    expect(pending.statementIndex).toBe(2);
    expect(pending.statementCount).toBe(3);
  });

  it("reports no statement for text it could not classify", () => {
    // `planExecution` fails closed and still asks; there is no statement to name.
    const pending = raise("CALL refresh_all()");
    expect(pending.statement).toBe("CALL refresh_all()");
    expect(pending.analysis.reason).toBe("unknown");
  });
});

describe("confirmationStatus", () => {
  it("stays valid while the request is unchanged", () => {
    expect(confirmationStatus(raise(SCRIPT), live())).toBe("valid");
  });

  it("cancels when another tab becomes active", () => {
    const pending = raise(SCRIPT);
    const status = confirmationStatus(
      pending,
      live({
        activeTabId: "q2",
        tabs: [
          { id: "q1", tabType: "query", query: SCRIPT, origin: ORIGIN },
          { id: "q2", tabType: "query", query: "SELECT 1", origin: ORIGIN },
        ],
      }),
    );
    expect(status).toBe("tab-switched");
  });

  it("cancels when the confirmed tab was closed", () => {
    const status = confirmationStatus(
      raise(SCRIPT),
      live({ activeTabId: null, tabs: [] }),
    );
    expect(status).toBe("tab-closed");
  });

  it("cancels when the reviewed SQL was edited", () => {
    const status = confirmationStatus(
      raise(SCRIPT),
      live({ query: "DELETE FROM users WHERE id = 1" }),
    );
    expect(status).toBe("sql-edited");
  });

  it("tolerates insignificant whitespace around the reviewed SQL", () => {
    expect(confirmationStatus(raise(SCRIPT), live({ query: `${SCRIPT}\n` }))).toBe(
      "valid",
    );
  });

  it("cancels when the viewer moved to another database", () => {
    const status = confirmationStatus(
      raise(SCRIPT),
      live({
        origin: OTHER_DATABASE,
        tabs: [
          {
            id: "q1",
            tabType: "query",
            query: SCRIPT,
            origin: OTHER_DATABASE,
          },
        ],
      }),
    );
    expect(status).toBe("origin-changed");
  });

  it("cancels when the saved connection was retargeted", () => {
    const status = confirmationStatus(
      raise(SCRIPT),
      live({
        origin: RETARGETED,
        tabs: [{ id: "q1", tabType: "query", query: SCRIPT, origin: RETARGETED }],
      }),
    );
    expect(status).toBe("origin-changed");
  });

  it("treats a confirmation with no origin as never valid", () => {
    const pending = raise(SCRIPT, { origin: null });
    expect(confirmationStatus(pending, live())).toBe("origin-changed");
    expect(
      confirmationStatus(pending, {
        activeTabId: "q1",
        tabs: [{ id: "q1", tabType: "query", query: SCRIPT, origin: null }],
        origin: null,
      }),
    ).toBe("origin-changed");
  });
});

describe("statementPreview", () => {
  it("returns the statement text the dialog names", () => {
    expect(statementPreview("DROP TABLE demo", 2, 3)).toBe(
      "Statement 2 of 3\nDROP TABLE demo",
    );
  });

  it("omits the position when there is only one statement", () => {
    expect(statementPreview("DROP TABLE demo", null, 1)).toBe("DROP TABLE demo");
  });

  it("never invents a statement it does not have", () => {
    expect(statementPreview(null, 2, 3)).toBe("Statement 2 of 3");
    expect(statementPreview(null, null, 1)).toBe("");
  });
});
