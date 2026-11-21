import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_CONNECTION_NAME,
  DEMO_TABLE,
  DEMO_TABLE_CELLS,
  connectionCardSelector,
  gridSelector,
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
