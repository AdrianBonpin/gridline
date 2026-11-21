import { describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  DEMO_CONNECTION_NAME,
  DEMO_TABLE,
  DEMO_TABLE_CELLS,
  connectionCardSelector,
  gridSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";
import { runDemoSmokeFlow } from "./smokeFlow.mjs";

const CARD = connectionCardSelector();
const TABLE = tableTreeItemSelector();
const GRID = gridSelector();

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

/**
 * Stand-in for the WebDriver transport: each selector becomes "visible" only
 * after a chosen number of polls, and the grid reports scripted text.
 */
function fakeDriver(options: {
  cardAfterPolls?: number;
  tableAfterPolls?: number;
  tableAfterOpenPolls?: number;
  gridText?: string | (() => string);
} = {}) {
  const {
    cardAfterPolls = 1,
    tableAfterPolls = 1,
    tableAfterOpenPolls = 1,
    gridText = `${DEMO_TABLE_CELLS.join(" ")} extra`,
  } = options;
  const clicks: string[] = [];
  let cardPolls = 0;
  let tablePolls = 0;
  let cardClicked = false;
  let gridPolls = 0;

  const driver = {
    async findElement(selector: string) {
      if (selector === CARD) {
        cardPolls += 1;
        return cardPolls >= cardAfterPolls ? { elementId: "card" } : null;
      }
      if (selector === TABLE) {
        if (!cardClicked) return null;
        tablePolls += 1;
        return tablePolls >= tableAfterOpenPolls ? { elementId: "table" } : null;
      }
      if (selector === GRID) {
        gridPolls += 1;
        return { elementId: "grid" };
      }
      return null;
    },
    async click(element: { elementId: string }) {
      clicks.push(element.elementId);
      if (element.elementId === "card") cardClicked = true;
    },
    async elementText() {
      return typeof gridText === "function" ? gridText() : gridText;
    },
    async screenshot() {
      return "iVBORw0KGgo=";
    },
    async pageSource() {
      return "<html><body>fake</body></html>";
    },
    async deleteSession() {},
    clicks,
    get gridPolls() {
      return gridPolls;
    },
  };
  return driver;
}

describe("runDemoSmokeFlow", () => {
  it("opens the seeded demo database and proves rows are on screen", async () => {
    const clock = fakeClock();
    const driver = fakeDriver();
    const result = await runDemoSmokeFlow(driver, {
      intervalMs: 100,
      timeoutMs: 5_000,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(driver.clicks).toEqual(["card", "table"]);
    expect(result.steps.map((step) => step.name)).toEqual([
      `home: ${DEMO_CONNECTION_NAME} card visible`,
      "home: open the demo database",
      `explorer: ${DEMO_TABLE} listed in the table tree`,
      `explorer: open ${DEMO_TABLE}`,
      `grid: seeded ${DEMO_TABLE} rows visible`,
    ]);
    expect(result.gridText).toContain("GL-MSE-001");
  });

  it("waits for the webview instead of failing on the first poll", async () => {
    const clock = fakeClock();
    const driver = fakeDriver({ cardAfterPolls: 3, tableAfterOpenPolls: 2 });
    const result = await runDemoSmokeFlow(driver, {
      intervalMs: 100,
      timeoutMs: 5_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(driver.clicks).toEqual(["card", "table"]);
    expect(result.steps).toHaveLength(5);
  });

  it("fails when the demo connection card never appears and clicks nothing", async () => {
    const clock = fakeClock();
    const driver = fakeDriver({ cardAfterPolls: Number.POSITIVE_INFINITY });
    const failure = runDemoSmokeFlow(driver, {
      intervalMs: 100,
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    });
    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(/demo connection card .*did not appear within 500ms/);
    expect(driver.clicks).toEqual([]);
  });

  it("fails when the grid renders but never shows the seeded rows", async () => {
    const clock = fakeClock();
    const driver = fakeDriver({ gridText: "id sku name price" });
    const failure = runDemoSmokeFlow(driver, {
      intervalMs: 100,
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    });
    await expect(failure).rejects.toThrow(/never showed "GL-MSE-001", "Gridline Wireless Mouse"/);
    await expect(failure).rejects.toThrow(/last grid text: id sku name price/);
    await expect(failure).rejects.toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({ name: `explorer: open ${DEMO_TABLE}` }),
      ]),
    });
  });

  it("keeps polling while only part of the row is rendered", async () => {
    const clock = fakeClock();
    let polls = 0;
    const driver = fakeDriver({
      gridText: () => {
        polls += 1;
        return polls < 3 ? "GL-MSE-001" : `${DEMO_TABLE_CELLS.join(" ")}`;
      },
    });
    const result = await runDemoSmokeFlow(driver, {
      intervalMs: 100,
      timeoutMs: 5_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(result.gridText).toBe(DEMO_TABLE_CELLS.join(" "));
    expect(driver.gridPolls).toBeGreaterThanOrEqual(3);
  });

  it("reports the grid element itself when it never renders", async () => {
    const clock = fakeClock();
    const driver = fakeDriver();
    const withoutGrid = {
      ...driver,
      findElement: async (selector: string) =>
        selector === GRID ? null : driver.findElement(selector),
    };
    const failure = runDemoSmokeFlow(withoutGrid, {
      intervalMs: 100,
      timeoutMs: 300,
      sleep: clock.sleep,
      now: clock.now,
    });
    await expect(failure).rejects.toThrow(/"\[role=\\"grid\\"\]" never rendered/);
  });
});
