import { HarnessError } from "./errors.mjs";
import {
  COMPOSITE_EDIT_COLUMN,
  COMPOSITE_TABLE,
  COMPOSITE_TABLE_CELLS,
  COMPOSITE_TABLE_COLUMNS,
  DEMO_CONNECTION_NAME,
  cellEditorSelector,
  changesQueueSelector,
  commitAllSelector,
  connectionCardSelector,
  gridSelector,
  rowCellSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { cellDiff, matchedValues, observeGridCells, waitForRenderedCells } from "./gridContent.mjs";
import { pollUntil } from "./poll.mjs";
import { DEFAULT_TIMEOUT_MS, waitForElement } from "./smokeFlow.mjs";

export const DEFAULT_INTERVAL_MS = 250;

function clock(options) {
  return {
    sleep: options.sleep,
    now: options.now,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    nowMs: options.now ?? (() => Date.now()),
  };
}

/**
 * A value the edit can move to that differs from what is on screen. Quantity is
 * a positive integer, so "+1" keeps the demo's CHECK (quantity > 0) satisfied
 * and is always a real change.
 */
export function nextEditableValue(current) {
  const trimmed = String(current ?? "").trim();
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed) + 1);
  return `${trimmed}-edited`;
}

function describeObservation(cells) {
  const shown = cells.slice(0, 8).map((cell) => JSON.stringify(cell)).join(", ");
  return cells.length > 8 ? `${shown}, …` : shown || "<none>";
}

/**
 * Composite-key edit flow: prove that editing one row of a table with a
 * composite primary key changes exactly that row.
 *
 * The proof is a positional diff of the rendered grid before and after the
 * commit: exactly one rendered cell may change, and it must be the cell that was
 * edited. A single-column Row Identity would also rewrite the sibling row that
 * shares the first key column, which shows up as a second changed cell and
 * fails the flow.
 */
export async function runCompositeEditFlow(driver, options = {}) {
  const {
    connectionName = DEMO_CONNECTION_NAME,
    table = COMPOSITE_TABLE,
    expectedCells = COMPOSITE_TABLE_CELLS,
    columns = COMPOSITE_TABLE_COLUMNS,
    editColumn = COMPOSITE_EDIT_COLUMN,
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

  const editColumnIndex = columns.indexOf(editColumn);
  if (editColumnIndex < 0) {
    throw new HarnessError(
      `edit column ${JSON.stringify(editColumn)} is not one of ${JSON.stringify(columns)}`,
    );
  }

  try {
    const card = await step(`home: ${connectionName} card visible`, () =>
      waitForElement(driver, connectionCardSelector(connectionName), {
        label: "demo connection card",
        ...waitOptions(),
      }),
    );
    await step("home: open the demo database", () => driver.click(card));

    const tableItem = await step(`explorer: ${table} listed in the table tree`, () =>
      waitForElement(driver, tableTreeItemSelector(table), {
        label: `table tree item for ${JSON.stringify(table)}`,
        ...waitOptions(),
      }),
    );
    await step(`explorer: open ${table}`, () => driver.click(tableItem));

    const rendered = await step(`grid: seeded ${table} rows visible`, () =>
      waitForRenderedCells(driver, gridSelector(), expectedCells, waitOptions()),
    );

    // Precondition: the first two rendered rows must share their first key
    // column, otherwise this fixture cannot demonstrate that siblings survive.
    await step(`grid: first two rows share the first key column`, async () => {
      const first = await driver.getAttribute(
        await driver.findElement(rowCellSelector(0, 0)),
        "title",
      );
      const second = await driver.getAttribute(
        await driver.findElement(rowCellSelector(1, 0)),
        "title",
      );
      if (first === null || second === null) {
        throw new HarnessError(
          `could not read the ${JSON.stringify(columns[0])} cells of the first two rows ` +
            "through the WebDriver attribute endpoint",
        );
      }
      if (first !== second) {
        throw new HarnessError(
          `fixture precondition failed: the first two rendered rows of ${table} have ` +
            `${columns[0]}=${JSON.stringify(first)} and ${JSON.stringify(second)}, so a ` +
            "single-column key would not address a sibling row and the flow would prove nothing",
        );
      }
      return { first, second };
    });

    const before = await step("grid: snapshot the rendered cells", async () => {
      const observation = await observeGridCells(driver, gridSelector());
      if (observation.cells.length < columns.length) {
        throw new HarnessError(
          `the grid rendered ${observation.cells.length} cell(s), fewer than the ` +
            `${columns.length} declared columns of ${table}`,
        );
      }
      return observation;
    });

    const targetSelector = rowCellSelector(0, editColumnIndex);
    const originalValue = await step(`grid: read the ${editColumn} cell to edit`, async () => {
      const cell = await driver.findElement(targetSelector);
      if (!cell) throw new HarnessError(`${targetSelector} never rendered`);
      return driver.getAttribute(cell, "title");
    });
    const editedValue = nextEditableValue(originalValue);

    await step(`grid: edit ${editColumn} of the first row`, async () => {
      const cell = await driver.findElement(targetSelector);
      if (!cell) throw new HarnessError(`${targetSelector} never rendered`);
      // Double-click opens the cell editor; a single click only selects.
      await driver.doubleClick(cell);
      const editor = await waitForElement(driver, cellEditorSelector(), {
        label: "cell editor",
        ...waitOptions(),
      });
      await driver.clear(editor);
      await driver.sendKeys(editor, editedValue);
      await driver.pressEnter();
    });

    await step("changes queue: commit the staged edit", async () => {
      const toggle = await waitForElement(driver, changesQueueSelector(), {
        label: "changes queue toggle",
        ...waitOptions(),
      });
      await driver.click(toggle);
      const commit = await waitForElement(driver, commitAllSelector(), {
        label: "Commit All button",
        ...waitOptions(),
      });
      await driver.click(commit);
    });

    // The assertion: one rendered cell changed, and it is the edited cell. The
    // sibling row (same first key column) must still show its original value.
    const after = await step(
      "grid: only the edited row changed (siblings survived)",
      async () => {
        let last = null;
        try {
          return await pollUntil(
            async () => {
              const observation = await observeGridCells(driver, gridSelector());
              last = observation;
              if (observation.cells.length !== before.cells.length) return null;
              const diff = cellDiff(before, observation);
              if (diff.length === 0) return null;
              if (diff.length > 1) {
                throw new HarnessError(
                  `committing one edit changed ${diff.length} rendered cells ` +
                    `(${diff
                      .map((d) => `${d.index}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`)
                      .join(", ")}); the Row Identity addressed more than the edited row`,
                );
              }
              const [only] = diff;
              if (only.index !== editColumnIndex || only.after !== editedValue) {
                throw new HarnessError(
                  `the edited cell (index ${editColumnIndex} → ${JSON.stringify(editedValue)}) ` +
                    `did not change; instead cell ${only.index} went ` +
                    `${JSON.stringify(only.before)} → ${JSON.stringify(only.after)}`,
                );
              }
              return observation;
            },
            {
              timeoutMs: time.timeoutMs,
              intervalMs: time.intervalMs,
              label: "the committed edit to render without changing sibling rows",
              sleep: time.sleep,
              now: time.now,
            },
          );
        } catch (error) {
          const cells = last ?? before;
          throw new HarnessError(
            `${error instanceof Error ? error.message : String(error)}; ` +
              `rendered cells after the commit: ${describeObservation(cells.cells)}`,
          );
        }
      },
    );

    return {
      steps,
      // Report what the run actually saw, so the job log carries the evidence.
      renderedCells: after.cells,
      matchedCells: matchedValues(after.cells, expectedCells),
      edited: { column: editColumn, from: originalValue, to: editedValue },
    };
  } catch (error) {
    if (error && typeof error === "object") error.steps = steps;
    throw error;
  }
}
