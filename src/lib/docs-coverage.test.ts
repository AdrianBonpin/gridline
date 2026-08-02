import { describe, it, expect } from "vitest";
// Import the docs as raw strings (vite/client declares `*?raw`); this keeps the
// test free of a `node:fs` dependency so `tsc` (bun run build) stays clean.
import agents from "../../AGENTS.md?raw";
import readme from "../../README.md?raw";

describe("v0.5.0 docs coverage", () => {
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
  it("README declares v0.5.0", () => {
    expect(readme).toContain("0.5.0");
  });
  it("README marks inline editing complete (not Upcoming)", () => {
    // Gridline's comparison-table cell carries the ✅ marker
    expect(readme).toMatch(/Inline cell editing \| ✅ \| ✅ \| \*\*✅/);
    expect(readme).not.toMatch(/Inline cell editing.*Upcoming/);
  });
});