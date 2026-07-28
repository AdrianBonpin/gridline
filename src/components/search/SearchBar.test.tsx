import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { SearchBar } from "./SearchBar";
import { useUiStore } from "../../stores/uiStore";

beforeEach(() => { useUiStore.setState({ searchQuery: "" }); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("SearchBar", () => {
  it("renders a search input", () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });
  it("updates store after 150ms debounce", () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "prod" } });
    act(() => vi.advanceTimersByTime(149));
    expect(useUiStore.getState().searchQuery).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(useUiStore.getState().searchQuery).toBe("prod");
  });

  it("calls onDetectUrl when a connection string is typed", () => {
    const onDetectUrl = vi.fn();
    render(<SearchBar onDetectUrl={onDetectUrl} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "postgresql://user@host/db" } });
    expect(onDetectUrl).toHaveBeenCalledWith("postgresql://user@host/db");
  });
});