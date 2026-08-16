import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "./useSearch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSearch", () => {
  it("returns initial empty value", () => {
    const { result } = renderHook(() => useSearch(""));
    expect(result.current.debounced).toBe("");
  });

  it("debounces value updates by 150ms", () => {
    const { result, rerender } = renderHook(({ q }) => useSearch(q), {
      initialProps: { q: "" },
    });
    rerender({ q: "prod" });
    expect(result.current.debounced).toBe("");

    act(() => vi.advanceTimersByTime(149));
    expect(result.current.debounced).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debounced).toBe("prod");
  });

  it("resets debounce when value returns to empty", () => {
    const { result, rerender } = renderHook(({ q }) => useSearch(q), {
      initialProps: { q: "" },
    });
    rerender({ q: "x" });
    rerender({ q: "" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.debounced).toBe("");
  });
});