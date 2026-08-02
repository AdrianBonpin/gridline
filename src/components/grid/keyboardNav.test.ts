import { describe, it, expect } from "vitest";
import { nextCell } from "./keyboardNav";

describe("keyboardNav", () => {
  it("ArrowRight moves right, clamps at last col", () => {
    expect(nextCell({ row: 0, col: 0 }, "ArrowRight", 5, 3)).toEqual({ row: 0, col: 1 });
    expect(nextCell({ row: 0, col: 2 }, "ArrowRight", 5, 3)).toEqual({ row: 0, col: 2 });
  });
  it("ArrowLeft moves left, clamps at 0", () => {
    expect(nextCell({ row: 1, col: 1 }, "ArrowLeft", 5, 3)).toEqual({ row: 1, col: 0 });
    expect(nextCell({ row: 1, col: 0 }, "ArrowLeft", 5, 3)).toEqual({ row: 1, col: 0 });
  });
  it("ArrowDown/ArrowUp move row, clamp", () => {
    expect(nextCell({ row: 0, col: 1 }, "ArrowDown", 5, 3)).toEqual({ row: 1, col: 1 });
    expect(nextCell({ row: 4, col: 1 }, "ArrowDown", 5, 3)).toEqual({ row: 4, col: 1 });
    expect(nextCell({ row: 4, col: 1 }, "ArrowUp", 5, 3)).toEqual({ row: 3, col: 1 });
  });
  it("Tab wraps to next row; Shift+Tab wraps back", () => {
    expect(nextCell({ row: 0, col: 2 }, "Tab", 5, 3)).toEqual({ row: 1, col: 0 });
    expect(nextCell({ row: 1, col: 0 }, "Shift+Tab", 5, 3)).toEqual({ row: 0, col: 2 });
  });
  it("unknown key returns same cell", () => {
    expect(nextCell({ row: 1, col: 1 }, "x", 5, 3)).toEqual({ row: 1, col: 1 });
  });
});