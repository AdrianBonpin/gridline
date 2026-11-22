import { describe, it, expect } from "vitest";
import tauriConf from "../../src-tauri/tauri.conf.json";

// The version number itself is asserted once, in version.test.ts (which reads
// this file among every other version statement); this file covers the bundle
// configuration around it.
describe("tauri bundle config", () => {
  it("declares bundled pg_tools resources", () => {
    expect(tauriConf.bundle.resources).toContain("resources/pg_tools/*");
  });
  it("declares a .sql file association with alternate rank", () => {
    const assoc = tauriConf.bundle.fileAssociations;
    expect(Array.isArray(assoc)).toBe(true);
    const sql = (assoc as { ext?: string[]; rank?: string; role?: string }[])
      .find((a) => a.ext?.includes("sql"));
    expect(sql, "a .sql association must be declared").toBeDefined();
    // Alternate: appear under "Open With" without hijacking the default handler.
    expect(sql!.rank).toBe("Alternate");
    expect(sql!.role).toBe("Editor");
  });
});