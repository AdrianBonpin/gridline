import { describe, it, expect, vi, afterEach } from "vitest";
import { isMacOS } from "./platform";

describe("isMacOS", () => {
  afterEach(() => {
    vi.stubGlobal("navigator", undefined);
  });

  it("true on MacIntel/Mac platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; X)" });
    expect(isMacOS()).toBe(true);
  });

  it("false on Win32", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(isMacOS()).toBe(false);
  });

  it("false on Linux", () => {
    vi.stubGlobal("navigator", { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux)" });
    expect(isMacOS()).toBe(false);
  });
});