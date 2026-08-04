import { describe, it, expect } from "vitest";
import pkg from "../../package.json";

describe("version", () => {
  it("declares v0.6.0 across the app shell", () => {
    expect(pkg.version).toBe("0.6.0");
  });
});