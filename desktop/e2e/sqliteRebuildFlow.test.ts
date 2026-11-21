import { describe, expect, it } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  REBUILD_CREATED_CELLS,
  REBUILD_REFUSED_TABLE,
  changesQueueSelector,
  commitAllSelector,
  connectionCardSelector,
  destructiveDialogConfirmSelector,
  destructiveDialogSelector,
  gridSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
  rebuildRefusalSelector,
  removeColumnSelector,
  runQuerySelector,
  tableFormStageSelector,
  tableMenuItemSelector,
  tableOptionsSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { gridCellSelector } from "./gridContent.mjs";
import { runSqliteRebuildFlow } from "./sqliteRebuildFlow.mjs";

/**
 * A fake driver that models exactly the pieces of the app this flow touches: the
 * table tree's actions menu, the editor's column rows and Stage button, the
 * changes queue, and the grid.
 *
 * It deliberately does NOT know the rebuild guard: each test decides whether the
 * app refuses the rich table, whether a refused rebuild still stages something,
 * and whether the completed rebuild loses a row. That is the difference between
 * a correct and a broken application path, so it belongs to the case, not to the
 * fake.
 */
function fakeDriver({
  refusal = null,
  refusedTableStagesAnyway = false,
  commitLosesRows = false,
} = {}) {
  const state = {
    menuTable: null,
    openEditor: null,
    pending: 0,
    createdTableExists: false,
    dialogOpen: false,
    typedSql: "",
    columns: {
      [REBUILD_REFUSED_TABLE]: 4,
      e2e_rebuild: 3,
    },
    gridCells: [],
    clicks: [],
  };

  const element = (kind) => ({ elementId: kind, kind });
  const gridCell = (index) => ({ elementId: `cell-${index}`, kind: "cell", index });
  const editedTable = () =>
    state.menuTable === REBUILD_REFUSED_TABLE ? REBUILD_REFUSED_TABLE : "e2e_rebuild";

  const driver = {
    state,
    async findElement(selector) {
      if (selector === connectionCardSelector()) return element("card");
      if (selector === newQueryTabSelector()) return element("new-query");
      if (selector === queryEditorInputSelector()) return element("editor");
      if (selector === runQuerySelector()) return element("run");
      if (selector === destructiveDialogSelector()) {
        return state.dialogOpen ? element("dialog") : null;
      }
      if (selector === destructiveDialogConfirmSelector()) return element("confirm");
      if (selector === tableOptionsSelector(REBUILD_REFUSED_TABLE)) {
        return element("options-refused");
      }
      if (selector === tableOptionsSelector("e2e_rebuild")) {
        return state.createdTableExists ? element("options-created") : null;
      }
      if (selector === tableMenuItemSelector("edit_table")) return element("edit-item");
      if (selector === rebuildRefusalSelector()) {
        return state.openEditor === REBUILD_REFUSED_TABLE && refusal
          ? element("refusal")
          : null;
      }
      if (selector === tableFormStageSelector()) {
        return state.openEditor ? element("stage") : null;
      }
      if (selector === changesQueueSelector()) return element("queue-toggle");
      if (selector === commitAllSelector()) return element("commit-all");
      if (selector === tableTreeItemSelector("e2e_rebuild")) {
        return state.createdTableExists ? element("tree-created") : null;
      }
      if (selector === gridSelector()) return element("grid");
      return null;
    },
    async findElements(selector) {
      if (selector === gridCellSelector(gridSelector())) {
        return state.gridCells.map((_, index) => gridCell(index));
      }
      if (selector !== removeColumnSelector()) return [];
      if (!state.openEditor) return [];
      const count = state.columns[state.openEditor] ?? 0;
      return Array.from({ length: count }, (_, index) => ({
        elementId: `remove-${index}`,
        kind: "remove",
        index,
      }));
    },
    async getAttribute(el, name) {
      if (name === "disabled") {
        if (el.kind !== "stage") return null;
        // Stage is disabled while the editor reports a blocked rebuild.
        return state.openEditor === REBUILD_REFUSED_TABLE && refusal ? "true" : null;
      }
      if (name === "title") {
        if (el.kind !== "cell") return null;
        return String(state.gridCells[el.index] ?? "");
      }
      return null;
    },
    async elementText(el) {
      if (el.kind === "queue-toggle") {
        return state.pending > 0 ? String(state.pending) : "";
      }
      if (el.kind === "refusal") return `Rebuild blocked — ${refusal}. Nothing will be staged.`;
      return "";
    },
    async click(el) {
      state.clicks.push(el.kind);
      switch (el.kind) {
        case "options-refused":
          state.menuTable = REBUILD_REFUSED_TABLE;
          break;
        case "options-created":
          state.menuTable = "e2e_rebuild";
          break;
        case "edit-item":
          state.openEditor = editedTable();
          break;
        case "remove":
          state.columns[state.openEditor] -= 1;
          // A broken guard might stage a change for a table it just refused.
          if (
            refusedTableStagesAnyway &&
            state.openEditor === REBUILD_REFUSED_TABLE
          ) {
            state.pending += 1;
          }
          break;
        case "stage":
          // A refused rebuild must never be staged; the case decides whether the
          // broken app does it anyway.
          state.openEditor = null;
          state.pending += 1;
          break;
        case "commit-all":
          state.pending = 0;
          state.columns.e2e_rebuild = 2;
          state.gridCells = commitLosesRows ? ["1", "alpha"] : ["1", "alpha", "2", "beta"];
          break;
        case "tree-created":
          if (!state.gridCells.length) {
            state.gridCells = ["1", "alpha", "first", "2", "beta", "second"];
          }
          break;
        case "confirm":
          state.dialogOpen = false;
          state.createdTableExists = true;
          break;
        default:
          break;
      }
    },
    async sendKeys(el, text) {
      if (el.kind !== "editor") throw new Error("typed outside the query editor");
      state.typedSql = text;
    },
  };

  // Clicking the refused table's Stage must be impossible; if the flow ever
  // clicks it, the guard is broken and the case fails on the pending count.
  const originalClickForRun = driver.click.bind(driver);
  driver.click = async (el) => {
    if (el.kind === "run") {
      state.dialogOpen = true;
      state.clicks.push("run");
      return;
    }
    await originalClickForRun(el);
  };

  return driver;
}

const fast = { sleep: async () => {}, intervalMs: 1 };

describe("runSqliteRebuildFlow", () => {
  it("passes when the rich table is refused and the plain table rebuilds", async () => {
    const driver = fakeDriver({
      refusal: "the table declares a CHECK constraint, which a rebuild would drop",
    });

    const result = await runSqliteRebuildFlow(driver, fast);

    const names = result.steps.map((step) => step.name);
    expect(names).toContain("refusal: nothing was staged");
    expect(names).toContain("grid: the rebuilt table still shows every row");
    // the refusal really came from the editor, not from a queue error
    expect(result.evidence[0]).toContain("CHECK constraint");
    expect(result.matchedCells).toEqual(REBUILD_CREATED_CELLS);
    expect(result.passMessage).toContain("refused before staging");
    // the completed rebuild dropped the column and kept both rows
    expect(driver.state.pending).toBe(0);
    expect(driver.state.typedSql).toContain("CREATE TABLE e2e_rebuild");
    expect(driver.state.gridCells).not.toContain("first");
  });

  it("fails when the editor does not surface the refusal", async () => {
    const driver = fakeDriver({ refusal: null });
    await expect(runSqliteRebuildFlow(driver, { ...fast, timeoutMs: 20 })).rejects.toThrow(
      /refusal banner/,
    );
  });

  it("fails when the refusal names no blocker", async () => {
    const driver = fakeDriver({ refusal: "not supported" });
    await expect(runSqliteRebuildFlow(driver, fast)).rejects.toThrow(
      /without naming a blocker/,
    );
  });

  it("fails when a refused rebuild is staged anyway", async () => {
    const driver = fakeDriver({
      refusal: "the table has indexes (idx_order_items_product_id) that a rebuild would drop",
      refusedTableStagesAnyway: true,
    });
    await expect(runSqliteRebuildFlow(driver, { ...fast, timeoutMs: 20 })).rejects.toThrow(
      /staged anyway/,
    );
  });

  it("fails when the completed rebuild loses a row", async () => {
    const driver = fakeDriver({
      refusal: "the table declares a CHECK constraint, which a rebuild would drop",
      commitLosesRows: true,
    });
    await expect(
      runSqliteRebuildFlow(driver, { ...fast, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(HarnessError);
    await expect(
      runSqliteRebuildFlow(driver, { ...fast, timeoutMs: 20 }),
    ).rejects.toThrow(/grid content|rendered no data cells|never showed/);
  });
});
