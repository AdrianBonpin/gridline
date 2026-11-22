import { HarnessError } from "./errors.mjs";
import {
  COMPOSITE_TABLE_COLUMNS,
  DEMO_CONNECTION_NAME,
  REBUILD_CREATED_CELLS,
  REBUILD_CREATED_TABLE,
  REBUILD_DROPPED_COLUMN,
  REBUILD_DROPPED_VALUES,
  REBUILD_REFUSAL_WORDS,
  REBUILD_REFUSED_DROPPED_COLUMN,
  REBUILD_REFUSED_TABLE,
  changesQueueSelector,
  commitAllSelector,
  connectionCardSelector,
  destructiveDialogConfirmSelector,
  destructiveDialogSelector,
  gridSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
  queryEditorSurfaceSelector,
  rebuildFixtureScript,
  rebuildRefusalSelector,
  removeColumnSelector,
  runQuerySelector,
  tableFormStageSelector,
  tableMenuItemSelector,
  tableOptionsSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { matchedValues, observeGridCells, waitForRenderedCells } from "./gridContent.mjs";
import { pollUntil } from "./poll.mjs";
import { DEFAULT_TIMEOUT_MS, waitForElement } from "./smokeFlow.mjs";

export const DEFAULT_INTERVAL_MS = 250;

/**
 * The real clock.
 *
 * `run.mjs` injects only the budget (`timeoutMs`/`intervalMs`), never a clock, so
 * a flow that calls `time.sleep(...)` directly needs a working default: the unit
 * fakes always supply one, which is how the missing default went unnoticed until
 * the built-product lane reached that step.
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clock(options) {
  return {
    sleep: options.sleep ?? defaultSleep,
    now: options.now,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    nowMs: options.now ?? (() => Date.now()),
  };
}

/**
 * A SQLite rebuild either completes as one change or changes nothing.
 *
 * The flow drives the real built product through both halves of that promise:
 *
 * 1. **Refused before mutation.** The demo's `order_items` carries a composite
 *    key, a CHECK, a foreign key, and an index, all of which the rebuild script
 *    preserves. Dropping a column one of those preserved objects *names*
 *    (`product_id`: the explicit index, and its own foreign key) cannot be
 *    reproduced, so the editor must show the blocker, keep Stage disabled, and
 *    stage nothing.
 * 2. **Completed atomically.** A table the flow creates itself (a shape a
 *    rebuild can reproduce) is rebuilt by dropping a column: values land in
 *    their own columns, the dropped column's values disappear, and no row is
 *    lost. If the rebuild were not one transaction, the copy/drop/rename would
 *    show up as missing rows here.
 *
 * The driver is injected, so the flow is unit-testable with a fake; `run.mjs`
 * supplies the real WebDriver transport.
 */
export async function runSqliteRebuildFlow(driver, options = {}) {
  const {
    connectionName = DEMO_CONNECTION_NAME,
    refusedTable = REBUILD_REFUSED_TABLE,
    refusedDroppedColumn = REBUILD_REFUSED_DROPPED_COLUMN,
    createdTable = REBUILD_CREATED_TABLE,
    expectedCells = REBUILD_CREATED_CELLS,
    droppedColumn = REBUILD_DROPPED_COLUMN,
    droppedValues = REBUILD_DROPPED_VALUES,
  } = options;
  const time = clock(options);
  /** @type {Array<{name: string, durationMs: number}>} */
  const steps = [];

  async function step(name, action) {
    const startedAt = time.nowMs();
    const value = await action();
    steps.push({ name, durationMs: time.nowMs() - startedAt });
    return value;
  }

  const waitOptions = () => ({
    timeoutMs: time.timeoutMs,
    intervalMs: time.intervalMs,
    sleep: time.sleep,
    now: time.now,
  });

  function waitFor(selector, label) {
    return waitForElement(driver, selector, { ...waitOptions(), label });
  }

  async function waitForAbsent(selector, label) {
    return pollUntil(
      async () => ((await driver.findElement(selector)) ? null : true),
      { ...waitOptions(), label },
    );
  }

  /** Open the table editor for `table` through the tree row's actions menu. */
  async function openTableEditor(table) {
    const overflow = await waitFor(
      tableOptionsSelector(table),
      `actions menu for ${JSON.stringify(table)}`,
    );
    await driver.click(overflow);
    const editItem = await waitFor(
      tableMenuItemSelector("edit_table"),
      "Edit Table… menu item",
    );
    await driver.click(editItem);
  }

  /** Every "Remove column" control in the editor, in column order. */
  async function removeControls() {
    return pollUntil(
      async () => {
        const found = await driver.findElements(removeColumnSelector());
        return found.length > 0 ? found : null;
      },
      { ...waitOptions(), label: "the editor's Remove column controls" },
    );
  }

  /**
   * Drop the table's last column, which SQLite's ALTER TABLE cannot express, so
   * the editor has to stage a rebuild (or refuse one).
   */
  async function removeLastColumn() {
    const controls = await removeControls();
    await driver.click(controls[controls.length - 1]);
  }

  /**
   * Drop a specific column of the demo table, by its position in the seeded
   * column order (`COMPOSITE_TABLE_COLUMNS`, asserted against the seeder in
   * `expectations.test.ts`).
   *
   * The refusal half has to drop a column a *preserved object names*, so the
   * removed column cannot simply be "the last one".
   */
  async function removeTableColumn(column) {
    const index = COMPOSITE_TABLE_COLUMNS.indexOf(column);
    if (index === -1) {
      throw new HarnessError(
        `the fixture column ${JSON.stringify(column)} is not one of ` +
          `${JSON.stringify(COMPOSITE_TABLE_COLUMNS)}`,
      );
    }
    const controls = await removeControls();
    if (controls.length <= index) {
      throw new HarnessError(
        `the editor rendered ${controls.length} column(s), so the Remove control ` +
          `for ${JSON.stringify(column)} (index ${index}) is not there`,
      );
    }
    await driver.click(controls[index]);
  }

  /** Pending changes for the active origin, as the tab bar shows them. */
  async function pendingCount() {
    const toggle = await driver.findElement(changesQueueSelector());
    if (!toggle) return 0;
    const text = String(await driver.elementText(toggle)).trim();
    const digits = text.replace(/\D/g, "");
    return digits === "" ? 0 : Number(digits);
  }

  async function stageDisabled(stage) {
    return (await driver.getAttribute(stage, "disabled")) !== null;
  }

  try {
    await step(`home: ${connectionName} card visible and opened`, async () => {
      const card = await waitFor(
        connectionCardSelector(connectionName),
        "demo connection card",
      );
      await driver.click(card);
    });

    // --- 1. A shape that cannot be rebuilt faithfully is refused -----------
    await step(`refusal: open the editor for ${refusedTable}`, () =>
      openTableEditor(refusedTable),
    );
    await step(
      `refusal: drop ${refusedDroppedColumn}, which a preserved object names`,
      () => removeTableColumn(refusedDroppedColumn),
    );

    const reason = await step(
      "refusal: the table editor shows the blocker itself",
      async () => {
        const banner = await waitFor(
          rebuildRefusalSelector(),
          "the table editor's rebuild refusal banner",
        );
        const text = String(await driver.elementText(banner)).trim();
        if (!REBUILD_REFUSAL_WORDS.some((word) => text.includes(word))) {
          throw new HarnessError(
            `the editor refused the rebuild without naming a blocker ` +
              `(expected one of ${REBUILD_REFUSAL_WORDS.join(", ")}); it showed ` +
              `${JSON.stringify(text)}`,
          );
        }
        // The refusal has to be about *this* submission: the blocker it names is
        // the column the edit drops, not a generic property of the table.
        if (!text.includes(refusedDroppedColumn)) {
          throw new HarnessError(
            `the refusal does not name the dropped column ` +
              `${JSON.stringify(refusedDroppedColumn)}; it showed ` +
              `${JSON.stringify(text)}`,
          );
        }
        return text;
      },
    );

    await step("refusal: Stage stays disabled", async () => {
      const stage = await waitFor(tableFormStageSelector(), "the editor's Stage button");
      if (!(await stageDisabled(stage))) {
        throw new HarnessError(
          "Stage must be disabled while the editor reports that the rebuild is blocked",
        );
      }
    });

    await step("refusal: nothing was staged", async () => {
      // Give the app a poll interval in which a buggy guard could still stage.
      await time.sleep(time.intervalMs);
      const pending = await pendingCount();
      if (pending !== 0) {
        throw new HarnessError(
          `a refused rebuild was staged anyway (${pending} pending change(s)); ` +
            "a refusal must leave the changes queue untouched",
        );
      }
    });

    // --- 2. A rebuild that can be faithful completes ----------------------
    await step(`fixture: create ${createdTable} through the query workspace`, async () => {
      const newQuery = await waitFor(newQueryTabSelector(), "New query tab button");
      await driver.click(newQuery);
      await waitFor(queryEditorInputSelector(), "query editor");
      // Focus the rendered editor surface, not the hidden input: Monaco's
      // `textarea.inputarea` is a 1x1 element behind `.view-lines`, so neither a
      // click nor element-targeted keys reach it (see `queryEditorInputSelector`).
      const surface = await waitFor(queryEditorSurfaceSelector(), "query editor surface");
      await driver.click(surface);
      await driver.typeText(rebuildFixtureScript());
      const run = await waitFor(runQuerySelector(), "Run query button");
      await driver.click(run);
      // CREATE TABLE is a schema change, so it needs the destructive confirmation.
      await waitFor(
        destructiveDialogSelector(),
        "destructive confirmation for the fixture's CREATE TABLE",
      );
      const confirm = await waitFor(
        destructiveDialogConfirmSelector(),
        "confirmation button",
      );
      await driver.click(confirm);
      await waitForAbsent(
        destructiveDialogSelector(),
        "the destructive confirmation should close after confirming",
      );
    });

    await step(`fixture: ${createdTable} is listed in the table tree`, () =>
      waitFor(tableTreeItemSelector(createdTable), `table tree item for ${createdTable}`),
    );
    await step(`rebuild: open the editor for ${createdTable}`, () =>
      openTableEditor(createdTable),
    );
    await step("rebuild: drop a column to force a rebuild", () =>
      removeLastColumn(),
    );

    const stage = await step("rebuild: the editor reports no blocker", async () => {
      const button = await waitFor(tableFormStageSelector(), "the editor's Stage button");
      await pollUntil(
        async () => ((await stageDisabled(button)) ? null : true),
        { ...waitOptions(), label: "Stage to become enabled for a rebuild that is allowed" },
      );
      if (await driver.findElement(rebuildRefusalSelector())) {
        throw new HarnessError(
          "the editor shows a rebuild refusal for a table the rebuild can reproduce",
        );
      }
      return button;
    });

    await step("rebuild: stage the rebuild", () => driver.click(stage));

    await step("rebuild: commit the staged rebuild", async () => {
      const toggle = await waitFor(changesQueueSelector(), "changes queue toggle");
      await driver.click(toggle);
      const commit = await waitFor(commitAllSelector(), "Commit All button");
      await driver.click(commit);
      await pollUntil(async () => ((await pendingCount()) === 0 ? true : null), {
        ...waitOptions(),
        label: "the committed rebuild to leave no pending change",
      });
    });

    await step(`rebuild: open ${createdTable} again`, async () => {
      const item = await waitFor(
        tableTreeItemSelector(createdTable),
        `table tree item for ${createdTable}`,
      );
      await driver.click(item);
    });

    const grid = await step(
      "grid: the rebuilt table still shows every row",
      () => waitForRenderedCells(driver, gridSelector(), expectedCells, waitOptions()),
    );

    await step("grid: the dropped column's values are gone", async () => {
      const observation = await observeGridCells(driver, gridSelector());
      const survivors = droppedValues.filter((value) =>
        observation.cells.includes(value),
      );
      if (survivors.length) {
        throw new HarnessError(
          `the rebuilt table still renders ${survivors
            .map((value) => JSON.stringify(value))
            .join(", ")} from the dropped column ${JSON.stringify(droppedColumn)}`,
        );
      }
    });

    return {
      steps,
      renderedCells: grid.cells,
      matchedCells: matchedValues(grid.cells, expectedCells),
      evidence: [
        `refusal: ${JSON.stringify(refusedTable)} was refused before staging — ${reason}`,
        `rebuild: ${JSON.stringify(createdTable)} completed and still renders ${expectedCells
          .map((value) => JSON.stringify(value))
          .join(", ")}`,
        `rebuild: the dropped column ${JSON.stringify(droppedColumn)} no longer renders`,
      ],
      passMessage:
        "a SQLite rebuild was refused before staging for an unpreservable shape and completed atomically for a supported one",
    };
  } catch (error) {
    if (error && typeof error === "object") error.steps = steps;
    throw error;
  }
}
