import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DbTypeFilterDropdown } from "./DbTypeFilterDropdown";
import { useUiStore } from "../../stores/uiStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("DbTypeFilterDropdown", () => {
  beforeEach(() => {
    useUiStore.setState({ activeDbTypes: [] });
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
});