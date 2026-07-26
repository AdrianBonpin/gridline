import { describe, it, expect } from "vitest";
import type { Theme } from "./types";

describe("Theme type", () => {
  it("accepts system theme", () => {
    const theme: Theme = "system";
    expect(theme).toBe("system");
  });
});