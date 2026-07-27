import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataGrid } from "./DataGrid";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { QueryResult } from "../../lib/types";

const mockData: QueryResult = {
  columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"name",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"email",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", null],
  ],
  total_rows: 2, page: 1, page_size: 50,
};

describe("DataGrid", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("shows empty state when no active tab", () => {
    render(<DataGrid rows={[]} />);
    expect(screen.getByText(/Select a table to view data/i)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabLoading(tabId, true);

    render(<DataGrid rows={[]} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("shows error message in red", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabError(tabId, "Connection failed");

    render(<DataGrid rows={[]} />);
    const error = screen.getByText(/Connection failed/i);
    expect(error).toBeInTheDocument();
    expect(error).toHaveClass("text-red-500");
  });

  it("shows loading state when first opening a tab", () => {
    useDbViewerStore.getState().openTab("public", "users");

    render(<DataGrid rows={[]} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("renders column headers and row data when loaded", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<DataGrid rows={mockData.rows} />);
    expect(screen.getByRole("columnheader", { name: /id/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /name/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /email/ })).toBeInTheDocument();
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

    render(<DataGrid rows={mockData.rows} />);
    const nullCell = screen.getByText("NULL");
    expect(nullCell).toHaveClass("italic");
    expect(nullCell).toHaveClass("text-text-muted");
  });
});