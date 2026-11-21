import { describe, expect, it } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  cellDiff,
  describeMatchedValues,
  describeRenderedCells,
  gridCellSelector,
  matchedValues,
  missingValues,
  observeGridCells,
  waitForRenderedCells,
} from "./gridContent.mjs";

const GRID = '[role="grid"]';
const CELLS = gridCellSelector(GRID);

interface FakeCell {
  elementId: string;
  /** What WebKitWebDriver's `/attribute/title` reports for the cell. */
  title: string | null;
  /** What WebKitWebDriver's `/text` reports for the cell. */
  text: string;
}

/**
 * Stand-in for a real WebKitWebDriver session driving
 * `desktop/src/components/grid/VirtualDataGrid.tsx`.
 *
 * The recorded behaviour this models: every cell is a block `<div>` whose text
 * lives in a bare text node, so `/text` answers "" — while `/attribute/title`
 * answers the rendered value. Asserting on `/text` was the false negative this
 * harness must never reintroduce.
 */
function fakeWebKitDriver(cells: () => FakeCell[], options: { pageSource?: string } = {}) {
  const current = () => cells();
  return {
    gridPresent: true,
    findElement: async (selector: string) =>
      selector === GRID ? { elementId: "grid" } : null,
    findElements: async (selector: string) =>
      selector === CELLS
        ? current().map((cell) => ({ elementId: cell.elementId }))
        : [],
    getAttribute: async (element: { elementId: string }, name: string) => {
      if (name !== "title") throw new Error(`unexpected attribute ${name}`);
      const cell = current().find((entry) => entry.elementId === element.elementId);
      if (!cell) throw new Error("stale element reference");
      return cell.title;
    },
    elementText: async (element: { elementId: string }) => {
      const cell = current().find((entry) => entry.elementId === element.elementId);
      if (!cell) throw new Error("stale element reference");
      return cell.text;
    },
    pageSource: async () => options.pageSource ?? "<html><body></body></html>",
  };
}

const DEMO_CELLS: FakeCell[] = [
  { elementId: "cell-1", title: "GL-MSE-001", text: "" },
  { elementId: "cell-2", title: "Gridline Wireless Mouse", text: "" },
];

function immediate() {
  let clock = 0;
  return {
    intervalMs: 10,
    timeoutMs: 1_000,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe("grid rendered-cell assertions", () => {
  it("scopes the assertion to data rows, not the grid or its headers", () => {
    const selector = gridCellSelector(GRID);
    expect(selector).toContain(GRID);
    expect(selector).toContain("[data-index]");
  });

  it("reports found when /text is empty but the cell title holds the value", async () => {
    // This is the exact recorded WebKitWebDriver behaviour: the value is in the
    // cell's title attribute, `/text` answers "". The old text-based assertion
    // failed here forever; the attribute-based one must pass.
    const driver = fakeWebKitDriver(() => DEMO_CELLS);

    expect(await driver.elementText({ elementId: "cell-1" })).toBe("");
    expect(DEMO_CELLS.every((cell) => cell.text === "")).toBe(true);

    const observed = await observeGridCells(driver, GRID);
    expect(observed.cellCount).toBe(2);
    expect(missingValues(observed.cells, ["GL-MSE-001", "Gridline Wireless Mouse"])).toEqual([]);

    const rendered = await waitForRenderedCells(
      driver,
      GRID,
      ["GL-MSE-001", "Gridline Wireless Mouse"],
      immediate(),
    );
    expect(rendered.cells).toEqual(["GL-MSE-001", "Gridline Wireless Mouse"]);
  });

  it("normalizes whitespace so a wrapped cell still matches its fixture value", async () => {
    const driver = fakeWebKitDriver(() => [
      { elementId: "cell-1", title: "  Gridline   Wireless\nMouse  ", text: "" },
    ]);
    const rendered = await waitForRenderedCells(driver, GRID, ["Gridline Wireless Mouse"], immediate());
    expect(rendered.cells).toEqual(["Gridline Wireless Mouse"]);
  });

  it("fails when the grid shows other rows", async () => {
    const driver = fakeWebKitDriver(() => [
      { elementId: "cell-1", title: "GL-KBD-001", text: "" },
      { elementId: "cell-2", title: "Gridline Mechanical Keyboard", text: "" },
    ]);
    const failure = waitForRenderedCells(
      driver,
      GRID,
      ["GL-MSE-001", "Gridline Wireless Mouse"],
      immediate(),
    );
    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(/grid never showed "GL-MSE-001", "Gridline Wireless Mouse"/);
    await expect(failure).rejects.toThrow(/observed: "GL-KBD-001", "Gridline Mechanical Keyboard"/);
  });

  it("fails when the grid mounted with no data rows", async () => {
    const driver = fakeWebKitDriver(() => []);
    const failure = waitForRenderedCells(driver, GRID, ["GL-MSE-001"], immediate());
    await expect(failure).rejects.toThrow(/rendered no data cells/);
  });

  it("fails when the grid never renders", async () => {
    const driver = {
      ...fakeWebKitDriver(() => DEMO_CELLS),
      findElement: async () => null,
    };
    const failure = waitForRenderedCells(driver, GRID, ["GL-MSE-001"], {
      ...immediate(),
      timeoutMs: 30,
    });
    await expect(failure).rejects.toThrow(/"\[role=\\"grid\\"\]" never rendered within 30ms/);
  });

  it("does not accept page source as proof, but explains the gap", async () => {
    // The value is in the DOM (so page source contains it) yet no rendered cell
    // exposes it. Page-source containment must never turn this into a pass.
    const driver = fakeWebKitDriver(
      () => [
        { elementId: "cell-1", title: "{ 4 keys }", text: "" },
        { elementId: "cell-2", title: "34.99", text: "" },
      ],
      {
        pageSource:
          '<html><body><div role="grid"><div data-index="1"><div title="{ 4 keys }">GL-MSE-001</div></div></div></body></html>',
      },
    );
    const failure = waitForRenderedCells(driver, GRID, ["GL-MSE-001"], immediate());
    await expect(failure).rejects.toThrow(/grid never showed "GL-MSE-001"/);
    await expect(failure).rejects.toThrow(
      /the DOM source mentions "GL-MSE-001" but no rendered cell exposes it/,
    );
    await expect(failure).rejects.toThrow(/page source is not accepted as proof/);
  });

  it("describes what a passing run observed, and nothing when nothing was rendered", () => {
    // The pass line in the job log must carry the observation; an empty grid
    // must not produce a bogus "0 rendered cells" success line.
    expect(describeRenderedCells(undefined)).toBe("");
    expect(describeRenderedCells([])).toBe("");
    expect(describeRenderedCells(DEMO_CELLS.map((cell) => cell.title))).toBe(
      '2 rendered cell(s), e.g. "GL-MSE-001", "Gridline Wireless Mouse"',
    );
    expect(describeRenderedCells(["a", "b", "c", "d", "e"])).toBe(
      '5 rendered cell(s), e.g. "a", "b", "c", "d", …',
    );
  });

  it("separates the fixture values that were rendered from the ones that were not", () => {
    const cells = ["GL-MSE-001", "Gridline Wireless Mouse", "34.99"];
    expect(matchedValues(cells, ["GL-MSE-001", "GL-KBD-001"])).toEqual(["GL-MSE-001"]);
    expect(missingValues(cells, ["GL-MSE-001", "GL-KBD-001"])).toEqual(["GL-KBD-001"]);
    expect(describeMatchedValues(["GL-MSE-001", "Gridline Wireless Mouse"])).toBe(
      '"GL-MSE-001", "Gridline Wireless Mouse"',
    );
    expect(describeMatchedValues([])).toBe("");
    expect(describeMatchedValues(undefined)).toBe("");
  });

  it("keeps polling while only part of the row has rendered", async () => {
    let polls = 0;
    const driver = fakeWebKitDriver(() => {
      polls += 1;
      return polls < 3
        ? [{ elementId: "cell-1", title: "GL-MSE-001", text: "" }]
        : DEMO_CELLS;
    });
    const rendered = await waitForRenderedCells(
      driver,
      GRID,
      ["GL-MSE-001", "Gridline Wireless Mouse"],
      immediate(),
    );
    expect(rendered.cellCount).toBe(2);
    expect(polls).toBeGreaterThanOrEqual(3);
  });
});

describe("cellDiff", () => {
  it("reports the single position that changed", () => {
    expect(
      cellDiff({ cells: ["a", "b", "c"] }, { cells: ["a", "B", "c"] }),
    ).toEqual([{ index: 1, before: "b", after: "B" }]);
  });

  it("reports every changed position (a composite-key bug changes siblings)", () => {
    expect(
      cellDiff({ cells: ["1", "2", "1", "2"] }, { cells: ["1", "97", "1", "97"] }),
    ).toEqual([
      { index: 1, before: "2", after: "97" },
      { index: 3, before: "2", after: "97" },
    ]);
  });

  it("returns nothing when the observation is unchanged", () => {
    expect(cellDiff({ cells: ["a"] }, { cells: ["a"] })).toEqual([]);
  });
});
