import { HarnessError } from "./errors.mjs";
import {
  DEMO_CONNECTION_NAME,
  DEMO_TABLE,
  DEMO_TABLE_CELLS,
  connectionCardSelector,
  gridSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { pollUntil } from "./poll.mjs";

export const DEFAULT_TIMEOUT_MS = 30_000;
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

function snippet(text, limit = 240) {
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
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
 * Wait until the grid element exists *and* its rendered text contains every
 * expected cell value. A mounted grid with empty or placeholder content is a
 * failure, not a pass: this is the assertion that the demo data actually
 * reached the screen.
 *
 * @returns {Promise<string>} the matching grid text
 */
export async function waitForGridContent(driver, selector, expectedCells, options) {
  const time = clock(options);
  let lastText = "";
  let missing = [...expectedCells];
  let sawGrid = false;

  try {
    return await pollUntil(
      async () => {
        const grid = await driver.findElement(selector);
        if (!grid) return null;
        sawGrid = true;
        lastText = await driver.elementText(grid);
        missing = expectedCells.filter((cell) => !lastText.includes(cell));
        return missing.length === 0 ? lastText : null;
      },
      {
        timeoutMs: time.timeoutMs,
        intervalMs: time.intervalMs,
        label: `${JSON.stringify(selector)} grid content`,
        sleep: time.sleep,
        now: time.now,
      },
    );
  } catch (error) {
    if (!sawGrid) {
      throw new HarnessError(
        `${JSON.stringify(selector)} never rendered within ${time.timeoutMs}ms, so no grid content could be asserted`,
      );
    }
    throw new HarnessError(
      `grid never showed ${missing.map((cell) => JSON.stringify(cell)).join(", ")} ` +
        `within ${time.timeoutMs}ms (last grid text: ${snippet(lastText) || "<empty>"})`,
    );
  }
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

    const gridText = await step(`grid: seeded ${table} rows visible`, () =>
      waitForGridContent(driver, gridSelector(), expectedCells, {
        timeoutMs: time.timeoutMs,
        intervalMs: time.intervalMs,
        sleep: time.sleep,
        now: time.now,
      }),
    );

    return { steps, gridText };
  } catch (error) {
    // Attach completed steps so the failure report shows how far the app got.
    if (error && typeof error === "object") error.steps = steps;
    throw error;
  }
}
