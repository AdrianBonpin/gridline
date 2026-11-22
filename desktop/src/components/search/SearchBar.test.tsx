import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { SearchBar, SEARCH_DEBOUNCE_MS } from "./SearchBar";
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

  it("clears the search and exits search mode on Escape", () => {
    useUiStore.setState({ searchQuery: "prod" });
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i);
    // input mirrors the store value
    expect((input as HTMLInputElement).value).toBe("prod");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useUiStore.getState().searchQuery).toBe("");
  });

  it("drops a queued search term once a connection string is detected", () => {
    const onDetectUrl = vi.fn();
    render(<SearchBar onDetectUrl={onDetectUrl} />);
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;

    // `postgresql://user:pass@` has no host, so it is not a connection string
    // yet: it arms the search debounce.
    fireEvent.change(input, { target: { value: "postgresql://user:pass@" } });
    // The next character makes it one, while the debounce is still pending.
    fireEvent.change(input, { target: { value: "postgresql://user:pass@host/db" } });
    expect(onDetectUrl).toHaveBeenCalledWith("postgresql://user:pass@host/db");

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));

    // The stale prefix must never reach the store: it would put Home back into
    // search mode and, through the store mirror, truncate the typed URL.
    expect(useUiStore.getState().searchQuery).toBe("");
    expect(input).toHaveValue("postgresql://user:pass@host/db");
  });

  it("does not resurrect a search that was cleared elsewhere", () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "prod" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(useUiStore.getState().searchQuery).toBe("prod");

    // Another keystroke is still queued when the Clear button (folder
    // breadcrumb) empties the query; the queued term must not come back.
    fireEvent.change(input, { target: { value: "prod2" } });
    act(() => useUiStore.getState().clearFilters());
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));

    expect(useUiStore.getState().searchQuery).toBe("");
    expect(input).toHaveValue("");
  });

  it("does not write to the store after unmount", () => {
    const { unmount } = render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "prod" } });
    unmount();
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(useUiStore.getState().searchQuery).toBe("");
  });
});
