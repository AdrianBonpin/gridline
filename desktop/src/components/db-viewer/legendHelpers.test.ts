import { describe, it, expect } from "vitest";
import {
  getCardinalityColor,
  getCardinalityLabel,
  LEGEND_ITEMS,
} from "./legendHelpers";

describe("legendHelpers", () => {
  it("getCardinalityColor returns correct colors", () => {
    expect(getCardinalityColor("1:1")).toBe("#22c55e");   // green
    expect(getCardinalityColor("1:N")).toBe("#3b82f6");   // blue
    expect(getCardinalityColor("N:M")).toBe("#f59e0b");   // amber
  });

  it("getCardinalityColor returns fallback for unknown", () => {
    expect(getCardinalityColor("unknown")).toBe("#6b7280"); // gray fallback
  });

  it("getCardinalityLabel returns human-readable labels", () => {
    expect(getCardinalityLabel("1:1")).toBe("One-to-One");
    expect(getCardinalityLabel("1:N")).toBe("One-to-Many");
    expect(getCardinalityLabel("N:M")).toBe("Many-to-Many");
  });

  it("getCardinalityLabel returns raw value for unknown", () => {
    expect(getCardinalityLabel("unknown")).toBe("unknown");
  });

  it("LEGEND_ITEMS has three entries", () => {
    expect(LEGEND_ITEMS).toHaveLength(3);
    expect(LEGEND_ITEMS[0]).toHaveProperty("cardinality");
    expect(LEGEND_ITEMS[0]).toHaveProperty("color");
    expect(LEGEND_ITEMS[0]).toHaveProperty("label");
  });
});