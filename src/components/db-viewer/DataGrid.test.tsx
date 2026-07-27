import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataGrid } from "./DataGrid";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { QueryResult } from "../../lib/types";

const mockData: QueryResult = {
  columns: ["id", "name", "email"],
  rows: [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: null },
  ],
  row_count: 2,
};

describe("DataGrid", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("shows empty state when no active tab", () => {
    render(<DataGrid />);
    expect(screen.getByText(/Select a table to view data/i)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabLoading(tabId, true);

    render(<DataGrid />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("shows error message in red", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabError(tabId, "Connection failed");

    render(<DataGrid />);
    const error = screen.getByText(/Connection failed/i);
    expect(error).toBeInTheDocument();
    expect(error).toHaveClass("text-red-500");
  });

  it("shows data loading hint when no data", () => {
    useDbViewerStore.getState().openTab("public", "users");

    render(<DataGrid />);
    expect(screen.getByText(/Loading table data/i)).toBeInTheDocument();
  });

  it("renders column headers and row data when loaded", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<DataGrid />);
    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "email" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("renders NULL values as italic muted text", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<DataGrid />);
    const nullCell = screen.getByText("NULL");
    expect(nullCell).toHaveClass("italic");
    expect(nullCell).toHaveClass("text-text-muted");
  });
});