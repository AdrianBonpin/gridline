import { HarnessError } from "./errors.mjs";
import { pollUntil } from "./poll.mjs";

/**
 * Rendered-content assertions for the data grid.
 *
 * WebKitWebDriver's rendered-text endpoint (`GET /element/{id}/text`) is not
 * usable as the assertion source for this grid: it returns inline content only,
 * so a cell that renders a bare text node inside a block `<div>` reports an
 * empty string (headers, which wrap their label in a `<span>`, do report text).
 * Asserting on `/text` therefore fails forever on a perfectly rendered grid.
 *
 * `desktop/src/components/grid/VirtualDataGrid.tsx` renders every cell with its
 * display value in the `title` attribute, which the attribute endpoint
 * (`GET /element/{id}/attribute/title`) reports correctly. That is what this
 * module asserts: the value must be present on a rendered cell element.
 *
 * Page source is deliberately *not* an assertion path. A value can appear in
 * `page-source.html` (for example inside a non-rendered subtree) while nothing
 * on screen shows it, so source containment is only ever used to explain a
 * failure that the cell assertion already detected.
 */

/** Cap on cells inspected per poll, so a huge rendered page cannot stall a run. */
export const MAX_OBSERVED_CELLS = 800;

/**
 * CSS selector for the cells of rendered data rows. Only data rows carry
 * `data-index` (`VirtualDataGrid` sets it per virtual row), so header cells and
 * popovers can never satisfy the assertion. `> div` selects the row's cells;
 * the leading selection/insert column simply has no title and no text.
 */
export function gridCellSelector(gridSelectorValue) {
  return `${gridSelectorValue} [data-index] > div`;
}

/** Collapse whitespace so a wrapped cell still compares to a plain fixture value. */
export function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read the values a rendered grid is actually showing.
 *
 * @param {{findElements: Function, getAttribute: Function, elementText: Function}} driver
 * @param {string} gridSelectorValue
 * @returns {Promise<{cellCount: number, cells: string[]}>} one entry per non-empty rendered cell
 */
export async function observeGridCells(driver, gridSelectorValue) {
  const elements = await driver.findElements(gridCellSelector(gridSelectorValue));
  const inspected = elements.slice(0, MAX_OBSERVED_CELLS);
  const cells = [];

  for (const element of inspected) {
    // The cell's own value attribute is authoritative: it holds exactly what
    // the user sees in the cell (FK cells prefix it with the reference, JSON
    // cells show their shape summary instead).
    const title = normalize(await driver.getAttribute(element, "title"));
    if (title) {
      cells.push(title);
      continue;
    }
    // Engines that do report block text (and any cell without a title) still
    // contribute; the cell element remains the scope of the assertion.
    const text = normalize(await driver.elementText(element));
    if (text) cells.push(text);
  }

  return { cellCount: elements.length, cells };
}

/**
 * Positional difference between two rendered-cell observations.
 *
 * Positions are cell indices in the flattened, header-free cell list, so a
 * change at one position means exactly one rendered cell moved. Rows that
 * appear or disappear show up as a length mismatch, which the caller must treat
 * as a failure rather than as "one cell changed".
 *
 * @param {{cells: string[]}} before
 * @param {{cells: string[]}} after
 * @returns {Array<{index: number, before: string, after: string}>}
 */
export function cellDiff(before, after) {
  const length = Math.min(before.cells.length, after.cells.length);
  const diff = [];
  for (let index = 0; index < length; index += 1) {
    if (before.cells[index] !== after.cells[index]) {
      diff.push({ index, before: before.cells[index], after: after.cells[index] });
    }
  }
  return diff;
}

/** Fixture values a rendered-cell observation does not show. */
export function missingValues(cells, expected) {
  return expected.filter((needle) => !cells.some((cell) => cell.includes(needle)));
}

/** Fixture values a rendered-cell observation does prove are on screen. */
export function matchedValues(cells, expected) {
  return expected.filter((needle) => cells.some((cell) => cell.includes(needle)));
}

/**
 * Whether the DOM source mentions values that no rendered cell exposed. Only
 * used to explain a failure — never to make an assertion pass.
 */
export async function pageSourceMentions(driver, needles) {
  try {
    const source = normalize(await driver.pageSource());
    return needles.filter((needle) => source.includes(needle));
  } catch {
    return [];
  }
}

function sample(cells, limit = 6) {
  if (!cells.length) return "";
  const shown = cells.slice(0, limit).map((cell) => JSON.stringify(cell));
  return cells.length > limit ? `${shown.join(", ")}, …` : shown.join(", ");
}

/**
 * One-line description of what a passing run actually saw on screen, so the job
 * log carries the observation instead of only the word PASS.
 *
 * @param {string[] | undefined} cells
 * @returns {string} e.g. `3 rendered cell(s), e.g. "GL-MSE-001", "Gridline Wireless Mouse"`
 */
export function describeRenderedCells(cells, limit = 4) {
  if (!Array.isArray(cells) || cells.length === 0) return "";
  return `${cells.length} rendered cell(s), e.g. ${sample(cells, limit)}`;
}

/**
 * The fixture values a passing observation proved are on screen — the exact
 * evidence the assertion rests on, printed so a log line can be quoted as proof.
 *
 * @param {string[] | undefined} matched
 * @returns {string} e.g. `"GL-MSE-001", "Gridline Wireless Mouse"`
 */
export function describeMatchedValues(matched) {
  if (!Array.isArray(matched) || matched.length === 0) return "";
  return matched.map((value) => JSON.stringify(value)).join(", ");
}

async function failureReason(driver, { gridSelectorValue, timeoutMs, sawGrid, observation, missing }) {
  const grid = JSON.stringify(gridSelectorValue);
  if (!sawGrid) {
    return `${grid} never rendered within ${timeoutMs}ms, so no grid content could be asserted`;
  }
  if (observation.cellCount === 0) {
    return (
      `${grid} rendered no data cells within ${timeoutMs}ms ` +
      "(the grid mounted but shows no rows)"
    );
  }

  const rendered = missing.map((value) => JSON.stringify(value)).join(", ");
  let message =
    `grid never showed ${rendered} within ${timeoutMs}ms ` +
    `(${observation.cellCount} rendered cell(s); observed: ${sample(observation.cells) || "<none>"})`;

  const inSource = await pageSourceMentions(driver, missing);
  if (inSource.length) {
    message +=
      `; note: the DOM source mentions ${inSource
        .map((value) => JSON.stringify(value))
        .join(", ")} but no rendered cell exposes ` +
      "it, so the value is in the document without being painted (page source is not accepted as proof)";
  }
  return message;
}

/**
 * Wait until the grid is mounted *and* its rendered cells show every expected
 * value. A mounted grid with empty or unrelated cells is a failure, not a pass.
 *
 * @returns {Promise<{cellCount: number, cells: string[]}>}
 */
export async function waitForRenderedCells(driver, gridSelectorValue, expectedCells, options) {
  const { timeoutMs, intervalMs, sleep, now } = options;
  let sawGrid = false;
  /** @type {{cellCount: number, cells: string[]}} */
  let observation = { cellCount: 0, cells: [] };
  let missing = [...expectedCells];

  try {
    return await pollUntil(
      async () => {
        const grid = await driver.findElement(gridSelectorValue);
        if (!grid) return null;
        sawGrid = true;
        observation = await observeGridCells(driver, gridSelectorValue);
        missing = missingValues(observation.cells, expectedCells);
        return missing.length === 0 ? observation : null;
      },
      {
        timeoutMs,
        intervalMs,
        label: `${JSON.stringify(gridSelectorValue)} grid content`,
        sleep,
        now,
      },
    );
  } catch {
    throw new HarnessError(
      await failureReason(driver, { gridSelectorValue, timeoutMs, sawGrid, observation, missing }),
    );
  }
}
