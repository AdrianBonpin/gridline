import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationControls } from "./PaginationControls";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { QueryResult } from "../../lib/types";

const user = userEvent.setup();

const mockData: QueryResult = {
  columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
  rows: Array.from({ length: 100 }, (_, i) => [i + 1]),
  row_count: 100,
};

describe("PaginationControls", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
  });

  it("shows nothing when no active tab", () => {
    const { container } = render(<PaginationControls />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when active tab has no data", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const { container } = render(<PaginationControls />);
    expect(container.firstChild).toBeNull();
  });

  it("renders page info when tab has data", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<PaginationControls />);
    expect(screen.getByText(/1-50 of 100/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
  });

  it("navigates to next page", async () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<PaginationControls />);
    const nextButton = screen.getByRole("button", { name: /next page/i });
    await user.click(nextButton);

    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.page).toBe(2);
    expect(screen.getByText(/51-100 of 100/i)).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 2/i)).toBeInTheDocument();
  });

  it("navigates to previous page", async () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);
    useDbViewerStore.getState().setPage(tabId, 2);

    render(<PaginationControls />);
    const prevButton = screen.getByRole("button", { name: /previous page/i });
    await user.click(prevButton);

    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.page).toBe(1);
    expect(screen.getByText(/1-50 of 100/i)).toBeInTheDocument();
  });

  it("disables previous button on first page", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);

    render(<PaginationControls />);
    const prevButton = screen.getByRole("button", { name: /previous page/i });
    const nextButton = screen.getByRole("button", { name: /next page/i });
    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();
  });

  it("disables next button on last page", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().setTabData(tabId, mockData);
    useDbViewerStore.getState().setPage(tabId, 2);

    render(<PaginationControls />);
    const prevButton = screen.getByRole("button", { name: /previous page/i });
    const nextButton = screen.getByRole("button", { name: /next page/i });
    expect(prevButton).not.toBeDisabled();
    expect(nextButton).toBeDisabled();
  });
});