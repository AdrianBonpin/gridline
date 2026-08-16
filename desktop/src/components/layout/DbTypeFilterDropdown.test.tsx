import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DbTypeFilterDropdown } from "./DbTypeFilterDropdown";
import { useUiStore } from "../../stores/uiStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("DbTypeFilterDropdown", () => {
  beforeEach(() => {
    useUiStore.setState({ activeDbTypes: [], activeEnvironment: null });
  });

  it("renders a button with Filter icon", () => {
    render(<DbTypeFilterDropdown />);
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("opens dropdown and shows 4 DB types", () => {
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("SQLite")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
  });

  it("toggles DB type filter on click", () => {
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    fireEvent.click(screen.getByText("PostgreSQL"));
    expect(useUiStore.getState().activeDbTypes).toContain("postgresql");
  });

  it("clears all filters with 'Clear all' button", () => {
    useUiStore.setState({ activeDbTypes: ["postgresql", "sqlite"] });
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    fireEvent.click(screen.getByText("Clear all"));
    expect(useUiStore.getState().activeDbTypes).toEqual([]);
  });

  it("shows environment select in dropdown", () => {
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    expect(screen.getByLabelText("Environment filter")).toBeInTheDocument();
  });

  it("selects environment via the select", () => {
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    fireEvent.click(screen.getByLabelText("Environment filter"));
    fireEvent.click(screen.getByText("Production"));
    expect(useUiStore.getState().activeEnvironment).toBe("production");
  });

  it("'All' option clears environment filter", () => {
    useUiStore.setState({ activeEnvironment: "production" });
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    fireEvent.click(screen.getByLabelText("Environment filter"));
    fireEvent.click(screen.getByText("All"));
    expect(useUiStore.getState().activeEnvironment).toBeNull();
  });

  it("shows 'None' option for connections without environment", () => {
    render(<DbTypeFilterDropdown />);
    fireEvent.click(screen.getByText("Filters"));
    fireEvent.click(screen.getByLabelText("Environment filter"));
    fireEvent.click(screen.getByText("None"));
    expect(useUiStore.getState().activeEnvironment).toBe("none");
  });

  it("environment filter counts toward badge", () => {
    useUiStore.setState({ activeDbTypes: [], activeEnvironment: "staging" });
    render(<DbTypeFilterDropdown />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});