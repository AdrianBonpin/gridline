import { describe, it, expect } from "vitest";
import tauriConf from "../../src-tauri/tauri.conf.json";

describe("tauri bundle config (v0.7.8)", () => {
  it("declares bundled pg_tools resources", () => {
    expect(tauriConf.bundle.resources).toContain("resources/pg_tools/*");
  });
  it("version is 0.7.8", () => {
    expect(tauriConf.version).toBe("0.7.8");
  });
});