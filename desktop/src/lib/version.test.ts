import { describe, it, expect } from "vitest";
import pkg from "../../package.json";

describe("version", () => {
  it("declares v0.8.1 across the app shell", () => {
    expect(pkg.version).toBe("0.8.1");
  });
});