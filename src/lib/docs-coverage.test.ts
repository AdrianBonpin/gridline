import { describe, it, expect } from "vitest";
// Import the docs as raw strings (vite/client declares `*?raw`); this keeps the
// test free of a `node:fs` dependency so `tsc` (bun run build) stays clean.
import agents from "../../AGENTS.md?raw";
import readme from "../../README.md?raw";

describe("v0.7.5 docs coverage", () => {
  it("AGENTS.md marks inline cell editing complete", () => {
    expect(agents).toContain("Inline cell editing");
    expect(agents).toMatch(/Inline cell editing \| ✅/);
  });
  it("AGENTS.md marks indexes + constraints complete", () => {
    expect(agents).toMatch(/Indexes \(per table\) \| ✅/);
    expect(agents).toMatch(/Constraints \(CHECK, UNIQUE beyond PK\/FK\) \| ✅/);
  });
  it("AGENTS.md marks materialized views complete", () => {
    expect(agents).toMatch(/Materialized views \| ✅/);
  });
  it("AGENTS.md marks stored procedures complete", () => {
    expect(agents).toMatch(/Stored procedures \| ✅/);
  });
  it("AGENTS.md marks favorites + recents + status indicator complete", () => {
    expect(agents).toMatch(/Favorites \/ Recent connections \| ✅/);
    expect(agents).toMatch(/Connection status indicator on cards \| ✅/);
    expect(agents).toMatch(/Move-to-folder bulk action \| ✅/);
  });
  it("README declares v0.7.5", () => {
    expect(readme).toContain("0.7.5");
  });
  it("AGENTS.md marks schema CRUD complete", () => {
    expect(agents).toMatch(/Schema CRUD \| ✅/);
  });
  it("AGENTS.md marks global object search complete", () => {
    expect(agents).toMatch(/Global object search \| ✅/);
  });
  it("AGENTS.md marks copy-as-DDL complete", () => {
    expect(agents).toMatch(/Copy as DDL for any object \| ✅/);
  });
  it("AGENTS.md marks object dependencies complete", () => {
    expect(agents).toMatch(/Object dependencies \| ✅/);
  });
  it("README notes bundled PostgreSQL tools", () => {
    expect(readme.toLowerCase()).toContain("bundled");
  });
  it("README marks inline editing complete (not Upcoming)", () => {
    // Key Features lists inline editing as a shipped feature
    expect(readme).toMatch(/- \*\*Inline cell editing\*\* —/);
    // comparison-table row for the stage→commit queue carries the Gridline ✅ marker
    // (5-column table: Feature | DB Pro | Beekeeper | TablePlus | Gridline)
    expect(readme).toMatch(/Changes queue \(stage → commit\)\s*\|[^|]*❌[^|]*\|[^|]*\|[^|]*\|\s*\*\*✅ Queue → Commit All\*\*/);
    expect(readme).not.toMatch(/Inline cell editing.*Upcoming/);
  });
});