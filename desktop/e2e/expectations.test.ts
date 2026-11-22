import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPOSITE_EDIT_COLUMN,
  COMPOSITE_TABLE,
  COMPOSITE_TABLE_CELLS,
  COMPOSITE_TABLE_COLUMNS,
  DEMO_CONNECTION_NAME,
  DEMO_TABLE,
  DEMO_TABLE_CELLS,
  REBUILD_DROPPED_COLUMN,
  REBUILD_REFUSED_DROPPED_COLUMN,
  cellEditorSelector,
  changesQueueSelector,
  commitAllSelector,
  connectionCardSelector,
  gridSelector,
  rowCellSelector,
  tableTreeItemSelector,
} from "./expectations.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("demo smoke expectations", () => {
  it("names the connection the demo seeder actually creates", () => {
    // The seeder owns the name; the harness must not invent its own label.
    const seeder = read("desktop/src-tauri/src/commands/demo.rs");
    const declared = /const DEMO_CONNECTION_NAME: &str = "([^"]+)";/.exec(seeder);
    expect(declared, "DEMO_CONNECTION_NAME missing from demo.rs").not.toBeNull();
    expect(DEMO_CONNECTION_NAME).toBe(declared![1]);
  });

  it("expects a table that exists in the seeded demo schema", () => {
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${DEMO_TABLE} (`);
  });

  it("expects cell values that are literally seeded into that table", () => {
    // Guards the smoke assertion against silently stale fixture text: the
    // strings we wait for on screen must appear in the seed data verbatim.
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    const insert = new RegExp(
      `INSERT OR IGNORE INTO ${DEMO_TABLE} \\([^)]*\\) VALUES([\\s\\S]*?);\\n`,
    ).exec(schema);
    expect(insert, `no seed INSERT for ${DEMO_TABLE}`).not.toBeNull();
    expect(DEMO_TABLE_CELLS.length).toBeGreaterThan(0);
    for (const cell of DEMO_TABLE_CELLS) {
      expect(insert![1]).toContain(`'${cell}'`);
    }
  });

  it("builds selectors that only match the demo target", () => {
    expect(connectionCardSelector()).toBe(
      `[data-testid="connection-card"][data-connection-name="${DEMO_CONNECTION_NAME}"]`,
    );
    expect(tableTreeItemSelector()).toBe(
      `[data-testid="table-tree-item"][data-table-name="${DEMO_TABLE}"]`,
    );
    expect(gridSelector()).toBe('[role="grid"]');
  });
});

describe("composite-key edit flow expectations", () => {
  it("uses a demo table whose primary key really is composite", () => {
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    const table = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${COMPOSITE_TABLE} \\(([\\s\\S]*?)\\);`,
    ).exec(schema);
    expect(table, `no CREATE TABLE for ${COMPOSITE_TABLE}`).not.toBeNull();
    const body = table![1];
    // both key columns must be in the primary key, or the flow proves nothing
    expect(/PRIMARY KEY \(([^)]*)\)/.test(body)).toBe(true);
    const pkColumns = /PRIMARY KEY \(([^)]*)\)/.exec(body)![1]
      .split(",")
      .map((c) => c.trim());
    expect(pkColumns).toEqual(["order_id", "product_id"]);
    // the flow edits a column that is NOT part of the key
    expect(pkColumns).not.toContain(COMPOSITE_EDIT_COLUMN);
  });

  it("declares the table's columns in the seeded order", () => {
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    const body = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${COMPOSITE_TABLE} \\(([\\s\\S]*?)\\);`,
    ).exec(schema)![1];
    const declared = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("PRIMARY KEY"))
      .map((line) => line.split(/\s+/)[0]);
    expect(declared).toEqual(COMPOSITE_TABLE_COLUMNS);
  });

  it("waits for values the seeder actually produces for that table", () => {
    // The prices of products 1 and 3, which seed the table's unit_price column.
    const seeder = read("desktop/src-tauri/src/commands/demo_schema.sql");
    expect(seeder).toContain("34.99");
    expect(seeder).toContain("44.99");
    expect(COMPOSITE_TABLE_CELLS).toEqual(["34.99", "44.99"]);
  });

  it("addresses grid cells and the commit affordances by stable selectors", () => {
    expect(rowCellSelector(0, 2)).toBe('[role="grid"] [data-index="0"] > div:nth-child(4)');
    expect(cellEditorSelector()).toBe('[data-testid="cell-editor"] input');
    expect(changesQueueSelector()).toBe('[data-testid="changes-queue-toggle"]');
    expect(commitAllSelector()).toBe('[data-testid="commit-all"]');
  });
});

describe("SQLite rebuild flow expectations", () => {
  function demoTableBody(): string {
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    const table = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${COMPOSITE_TABLE} \\(([\\s\\S]*?)\\);`,
    ).exec(schema);
    expect(table, `no CREATE TABLE for ${COMPOSITE_TABLE}`).not.toBeNull();
    return table![1];
  }

  it("drops a column a preserved object actually names", () => {
    // The refusal only fires for a dropped column that a preserved index,
    // trigger, constraint, or generated expression uses (`blockers_for()`).
    // A fixture that drops a column nothing names asserts a refusal that can
    // never happen — the stale premise this constant replaced.
    const body = demoTableBody();
    expect(COMPOSITE_TABLE_COLUMNS).toContain(REBUILD_REFUSED_DROPPED_COLUMN);

    // …it is named by an explicit index…
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    const index = new RegExp(
      `CREATE INDEX IF NOT EXISTS \\w+ ON ${COMPOSITE_TABLE}\\(${REBUILD_REFUSED_DROPPED_COLUMN}\\)`,
    ).test(schema);
    // …and by a foreign key (inline `REFERENCES` on the column, or a table-level
    // FOREIGN KEY clause that lists it).
    const columnLine = body
      .split("\n")
      .find((line) => line.trim().startsWith(`${REBUILD_REFUSED_DROPPED_COLUMN} `));
    const inlineFk = !!columnLine && /REFERENCES/i.test(columnLine);
    const tableFk = new RegExp(
      `FOREIGN KEY\\s*\\([^)]*${REBUILD_REFUSED_DROPPED_COLUMN}`,
      "i",
    ).test(body);
    expect(
      index || inlineFk || tableFk,
      `${REBUILD_REFUSED_DROPPED_COLUMN} must be named by a preserved object, ` +
        "or the rebuild refusal cannot fire",
    ).toBe(true);
  });

  it("keeps a column the guard does not refuse for", () => {
    // `unit_price` is named by nothing preserved, so dropping it must NOT be
    // expected to refuse (this is why it is no longer the refusal fixture).
    const schema = read("desktop/src-tauri/src/commands/demo_schema.sql");
    expect(REBUILD_REFUSED_DROPPED_COLUMN).not.toBe(REBUILD_DROPPED_COLUMN);
    expect(
      new RegExp(`ON ${COMPOSITE_TABLE}\\(${REBUILD_DROPPED_COLUMN}\\)`).test(schema),
    ).toBe(false);
  });
});
