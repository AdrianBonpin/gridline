import {
  DEMO_CONNECTION_NAME,
  DEMO_TABLE,
  DEMO_TABLE_CELLS,
  connectionCardSelector,
  gridSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { matchedValues, waitForRenderedCells } from "./gridContent.mjs";
import { pollUntil } from "./poll.mjs";

export const DEFAULT_TIMEOUT_MS = 30_000;
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
 * Wait for a CSS selector to match, polling while the webview boots.
 * @returns {Promise<{elementId: string}>}
 */
export function waitForElement(driver, selector, options) {
  const time = clock(options);
  return pollUntil(() => driver.findElement(selector), {
    timeoutMs: time.timeoutMs,
    intervalMs: time.intervalMs,
    label: options.label ?? `${JSON.stringify(selector)} never rendered`,
    sleep: time.sleep,
    now: time.now,
  });
}

/**
 * The built-product smoke flow: open the seeded demo database and prove a demo
 * table's rows are rendered.
 *
 * The driver is injected, so the whole flow (ordering, waiting, failure
 * messages) is unit-testable; `run.mjs` supplies the real WebDriver transport.
 */
export async function runDemoSmokeFlow(driver, options = {}) {
  const {
    connectionName = DEMO_CONNECTION_NAME,
    table = DEMO_TABLE,
    expectedCells = DEMO_TABLE_CELLS,
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

  try {
    const card = await step(`home: ${connectionName} card visible`, () =>
      waitForElement(driver, connectionCardSelector(connectionName), {
        label: "demo connection card",
        timeoutMs: time.timeoutMs,
        intervalMs: time.intervalMs,
        sleep: time.sleep,
        now: time.now,
      }),
    );
    await step("home: open the demo database", () => driver.click(card));

    const tableItem = await step(`explorer: ${table} listed in the table tree`, () =>
      waitForElement(driver, tableTreeItemSelector(table), {
        label: `table tree item for ${JSON.stringify(table)}`,
        timeoutMs: time.timeoutMs,
        intervalMs: time.intervalMs,
        sleep: time.sleep,
        now: time.now,
      }),
    );
    await step(`explorer: open ${table}`, () => driver.click(tableItem));

    const rendered = await step(`grid: seeded ${table} rows visible`, () =>
      waitForRenderedCells(driver, gridSelector(), expectedCells, {
        timeoutMs: time.timeoutMs,
        intervalMs: time.intervalMs,
        sleep: time.sleep,
        now: time.now,
      }),
    );

    // The values the assertion actually matched, so the run can report them.
    return {
      steps,
      renderedCells: rendered.cells,
      matchedCells: matchedValues(rendered.cells, expectedCells),
      passMessage: "the built app rendered the seeded demo rows",
    };
  } catch (error) {
    // Attach completed steps so the failure report shows how far the app got.
    if (error && typeof error === "object") error.steps = steps;
    throw error;
  }
}
