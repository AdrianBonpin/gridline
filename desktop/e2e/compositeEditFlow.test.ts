import { describe, expect, it } from "vitest";
import {
  COMPOSITE_EDIT_COLUMN,
  COMPOSITE_TABLE,
  COMPOSITE_TABLE_CELLS,
  COMPOSITE_TABLE_COLUMNS,
  connectionCardSelector,
  rowCellSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { nextEditableValue, runCompositeEditFlow } from "./compositeEditFlow.mjs";
import { HarnessError } from "./errors.mjs";

/**
 * Fake driver that models the pieces the flow touches: the seeded grid, the
 * cell editor, and Commit All. It deliberately does NOT know about Row Identity
 * — the test decides, per case, which rendered cells the commit changes, which
 * is exactly the difference between a correct and a buggy application path.
 */
function fakeDriver({ rows, onCommit }) {
  const state = {
    rows: rows.map((row) => [...row]),
    editing: null,
    typed: "",
    pendingCommit: null,
    committed: false,
    clicks: [],
  };

  const cellElement = (row, col) => ({ elementId: `cell-${row}-${col}`, kind: "cell", row, col });
  const element = (kind) => ({ elementId: kind, kind });

  const driver = {
    state,
    async findElement(selector) {
      if (selector === connectionCardSelector()) return element("card");
      if (selector === tableTreeItemSelector(COMPOSITE_TABLE)) return element("table");
      if (selector === '[role="grid"]') return element("grid");
      if (selector === '[data-testid="cell-editor"] input') return element("editor");
      if (selector === '[data-testid="changes-queue-toggle"]') return element("queue-toggle");
      if (selector === '[data-testid="commit-all"]') return element("commit-all");
      const cell = /\[data-index="(\d+)"\] > div:nth-child\((\d+)\)/.exec(selector);
      if (cell) {
        const row = Number(cell[1]);
        const col = Number(cell[2]) - 2;
        if (!state.rows[row] || col < 0) return null;
        return cellElement(row, col);
      }
      return null;
    },
    async findElements(selector) {
      if (selector !== '[role="grid"] [data-index] > div') return [];
      const cells = [];
      state.rows.forEach((row, rowIndex) => {
        row.forEach((_, colIndex) => cells.push(cellElement(rowIndex, colIndex)));
      });
      return cells;
    },
    async getAttribute(el, name) {
      if (name !== "title") return null;
      if (el.kind !== "cell") return null;
      return String(state.rows[el.row][el.col]);
    },
    async elementText() {
      return "";
    },
    async click(el) {
      state.clicks.push(el.kind);
      if (el.kind === "commit-all") {
        onCommit(state);
        state.committed = true;
      }
    },
    async doubleClick(el) {
      if (el.kind !== "cell") throw new Error("double-clicked a non-cell");
      state.editing = { row: el.row, col: el.col };
    },
    async clear() {
      state.typed = "";
    },
    async sendKeys(el, text) {
      if (el.kind !== "editor") throw new Error("typed outside the cell editor");
      state.typed = text;
    },
    async pressEnter() {
      if (!state.editing) return;
      state.pendingCommit = { ...state.editing, value: state.typed };
      state.editing = null;
    },
  };
  return driver;
}

/** The demo fixture's first two rows: same order_id, different product_id. */
const seededRows = () => [
  [1, 1, 2, 34.99],
  [1, 3, 2, 44.99],
  [2, 2, 1, 119.99],
  [2, 4, 3, 499.99],
];

const editColumnIndex = COMPOSITE_TABLE_COLUMNS.indexOf(COMPOSITE_EDIT_COLUMN);

function commitOnlyEditedRow(state) {
  const { row, col, value } = state.pendingCommit;
  state.rows[row][col] = value;
}

describe("nextEditableValue", () => {
  it("moves a numeric cell to a different numeric value", () => {
    expect(nextEditableValue("2")).toBe("3");
    expect(nextEditableValue(7)).toBe("8");
  });

  it("still produces a different value for non-numeric cells", () => {
    expect(nextEditableValue("draft")).toBe("draft-edited");
    expect(nextEditableValue(null)).toBe("-edited");
  });
});

describe("runCompositeEditFlow", () => {
  it("passes when committing an edit changes only the edited row", async () => {
    const driver = fakeDriver({ rows: seededRows(), onCommit: commitOnlyEditedRow });

    const result = await runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1 });

    const names = result.steps.map((step) => step.name);
    expect(names).toContain("grid: first two rows share the first key column");
    expect(names).toContain("grid: only the edited row changed (siblings survived)");
    // the flow really typed a new value into the editor and pressed Enter
    expect(driver.state.committed).toBe(true);
    expect(driver.state.typed).not.toBe("");
    // and it reports what it saw, for the job log
    expect(result.edited).toEqual({
      column: COMPOSITE_EDIT_COLUMN,
      from: "2",
      to: "3",
    });
    expect(result.matchedCells).toEqual(COMPOSITE_TABLE_CELLS);
    // the sibling row (same order_id) still shows its original quantity
    expect(driver.state.rows[1][editColumnIndex]).toBe(2);
    // the edited cell holds the value typed into the editor (edit values are
    // staged as the strings the cell editor produces)
    expect(driver.state.rows[0][editColumnIndex]).toBe("3");
  });

  it("fails when the commit also rewrites the sibling row sharing the first key column", async () => {
    // This is the composite-key bug: only order_id was in the identity, so the
    // UPDATE matched both rows of order 1.
    const driver = fakeDriver({
      rows: seededRows(),
      onCommit(state) {
        const { col, value } = state.pendingCommit;
        state.rows[0][col] = value;
        state.rows[1][col] = value;
      },
    });

    await expect(
      runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1, timeoutMs: 50 }),
    ).rejects.toThrow(/changed 2 rendered cells|addressed more than the edited row/);
  });

  it("refuses to run when the first two rows do not share the first key column", async () => {
    // Without a sibling row the flow cannot prove anything, so it must not pass.
    const rows = seededRows();
    rows[1][0] = 2;
    const driver = fakeDriver({ rows, onCommit: commitOnlyEditedRow });

    await expect(
      runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1 }),
    ).rejects.toBeInstanceOf(HarnessError);
    await expect(
      runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1 }),
    ).rejects.toThrow(/fixture precondition failed/);
  });

  it("fails when the commit changes a different cell than the one edited", async () => {
    const driver = fakeDriver({
      rows: seededRows(),
      onCommit(state) {
        // Simulates an identity that addresses another row entirely.
        state.rows[2][state.pendingCommit.col] = state.pendingCommit.value;
      },
    });

    await expect(
      runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1, timeoutMs: 50 }),
    ).rejects.toThrow(/did not change/);
  });

  it("fails when nothing renders after the commit", async () => {
    const driver = fakeDriver({ rows: seededRows(), onCommit() {} });
    await expect(
      runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1, timeoutMs: 30 }),
    ).rejects.toThrow(/without changing sibling rows/);
  });

  it("targets the declared column index of the edit column", async () => {
    const driver = fakeDriver({ rows: seededRows(), onCommit: commitOnlyEditedRow });
    await runCompositeEditFlow(driver, { sleep: async () => {}, intervalMs: 1 });
    // quantity is the third declared column → the cell selector's 4th child
    expect(editColumnIndex).toBe(2);
    expect(rowCellSelector(0, editColumnIndex)).toContain("nth-child(4)");
  });
});
