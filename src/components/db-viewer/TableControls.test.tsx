import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TableControls } from "./TableControls";
import { TooltipProvider } from "../ui/Tooltip";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { ViewerTab } from "../../stores/dbViewerStore";

const columns = [
  {
    name: "id",
    data_type: "integer",
    is_nullable: false,
    is_pk: true,
    is_fk: false,
    fk_ref: null,
    default_value: null,
  },
];

function makeTab(overrides: Partial<ViewerTab> = {}): ViewerTab {
  return {
    id: "tab-1",
    schema: "public",
    table: "users",
    page: 1,
    pageSize: 50,
    loading: false,
    error: null,
    data: { columns, rows: [[1]], total_rows: 1, page: 1, page_size: 50 },
    filterRules: [],
    sortRules: [],
    hiddenColumns: [],
    smartSortApplied: true,
    tabType: "table",
    ...overrides,
  };
}

function seed(tabs: ViewerTab[], activeTabId: string) {
  useDbViewerStore.getState().reset();
  useDbViewerStore.setState({ tabs, activeTabId });
}

function renderControls(
  props: Partial<ComponentProps<typeof TableControls>> = {},
) {
  return render(
    <TooltipProvider>
      <TableControls
        connectionId="c1"
        schema="public"
        table="users"
        columns={columns}
        rows={[[1]]}
        hiddenColumns={new Set()}
        onToggleColumn={() => {}}
        onRefresh={() => {}}
        filterRules={[]}
        onFilterChange={() => {}}
        sortRules={[]}
        onSortChange={() => {}}
        selectedCount={0}
        selectedRows={[]}
        onClearSelection={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("TableControls", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    seed([makeTab()], "tab-1");
    const onRefresh = vi.fn();
    renderControls({ onRefresh });

    fireEvent.click(screen.getByLabelText(/refresh table/i));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not spin the refresh icon or show the pulse when idle", () => {
    seed([makeTab()], "tab-1");
    const { container } = renderControls();

    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("refresh-pulse")).not.toBeInTheDocument();
  });

  it("spins the refresh icon and shows the pulse overlay while the tab is loading", () => {
    seed([makeTab({ loading: true })], "tab-1");
    const { container } = renderControls();

    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByTestId("refresh-pulse")).toBeInTheDocument();
  });

  it("shows the refreshing indicators when auto-refresh fires and clears them when done", () => {
    vi.useFakeTimers();
    seed([makeTab()], "tab-1");
    const onRefresh = vi.fn(() => {
      useDbViewerStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === "tab-1" ? { ...t, loading: true } : t,
        ),
      }));
    });
    const { container } = renderControls({
      onRefresh,
      defaultRefreshRate: 5000,
    });

    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("refresh-pulse")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.getByTestId("refresh-pulse")).toBeInTheDocument();

    // Once the fetch completes the indicators disappear
    act(() => {
      useDbViewerStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === "tab-1" ? { ...t, loading: false } : t,
        ),
      }));
    });
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("refresh-pulse")).not.toBeInTheDocument();
  });

  it("defers auto-refresh when the user switches tabs (resets the timer)", () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    seed([makeTab(), makeTab({ id: "tab-2", table: "orders" })], "tab-1");
    renderControls({ onRefresh, defaultRefreshRate: 5000 });

    // Not yet a full interval
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    // User switches to another tab → countdown restarts
    act(() => {
      useDbViewerStore.setState({ activeTabId: "tab-2" });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onRefresh).not.toHaveBeenCalled();

    // Full interval after the switch finally fires
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});