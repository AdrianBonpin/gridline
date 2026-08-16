import { describe, it, expect } from "vitest";
import { INPUT_ROUNDING } from "./uiConstants";

describe("uiConstants", () => {
  it("exposes a rounded (non-pill) radius class for inputs", () => {
    expect(INPUT_ROUNDING).toBe("rounded-lg");
  });
});