import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TableControls, formatDuration } from "./TableControls";
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
    editable: true,
    is_generated: false,
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

describe("formatDuration", () => {
  it("formats milliseconds with two decimals", () => {
    expect(formatDuration(15)).toBe("15.00ms");
  });

  it("formats seconds with one decimal once past a second", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(3200)).toBe("3.2s");
  });

  it("formats minutes for long-running queries", () => {
    expect(formatDuration(90000)).toBe("1.5m");
  });

  it("returns an empty string when there is no timing", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
  });
});

describe("TableControls query variant", () => {
  it("shows Export, Re-run, and Columns on the left", () => {
    seed([makeTab({ tabType: "query" })], "tab-1");
    renderControls({ variant: "query" });
    expect(screen.getByLabelText(/export/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/re-run query/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/toggle columns/i)).toBeInTheDocument();
  });

  it("hides table-only controls and the queue", () => {
    seed([makeTab({ tabType: "query" })], "tab-1");
    renderControls({ variant: "query" });
    expect(screen.queryByLabelText(/insert row/i)).toBeNull();
    expect(screen.queryByLabelText(/auto-refresh/i)).toBeNull();
    expect(screen.queryByLabelText(/column filters/i)).toBeNull();
    expect(screen.queryByLabelText(/sort rules/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /action queue/i })).toBeNull();
  });

  it("shows the execution time from the result with a clock", () => {
    seed(
      [
        makeTab({
          tabType: "query",
          data: {
            columns,
            rows: [],
            total_rows: 0,
            page: 1,
            page_size: 50,
            execution_time_ms: 15,
          },
        }),
      ],
      "tab-1",
    );
    renderControls({ variant: "query" });
    expect(screen.getByLabelText(/execution time/i)).toBeInTheDocument();
    expect(screen.getByText("15.00ms")).toBeInTheDocument();
  });

  it("keeps the row count and pagination", () => {
    seed(
      [
        makeTab({
          tabType: "query",
          data: {
            columns,
            rows: [[1]],
            total_rows: 42,
            page: 1,
            page_size: 50,
            execution_time_ms: 15,
          },
        }),
      ],
      "tab-1",
    );
    renderControls({ variant: "query" });
    expect(screen.getByText(/of 42/)).toBeInTheDocument();
    expect(screen.getByLabelText(/next page/i)).toBeInTheDocument();
  });

  it("table variant has no queue button (moved to tab bar) and no execution time", () => {
    seed(
      [
        makeTab({
          data: {
            columns,
            rows: [[1]],
            total_rows: 1,
            page: 1,
            page_size: 50,
            execution_time_ms: 15,
          },
        }),
      ],
      "tab-1",
    );
    renderControls({});
    expect(
      screen.queryByRole("button", { name: /action queue/i }),
    ).toBeNull();
    expect(screen.getByLabelText(/toggle columns/i)).toBeInTheDocument();
    expect(screen.queryByText("15.00ms")).toBeNull();
  });
});

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

  it("waits for an in-flight refresh to complete before restarting the timer", () => {
    vi.useFakeTimers();
    seed([makeTab()], "tab-1");
    const onRefresh = vi.fn(() => {
      useDbViewerStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === "tab-1" ? { ...t, loading: true } : t,
        ),
      }));
    });
    renderControls({ onRefresh, defaultRefreshRate: 5000 });

    // First interval fires the refresh
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // While the refresh is still in flight, the timer must NOT fire again
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Once the refresh completes, a fresh countdown starts
    act(() => {
      useDbViewerStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === "tab-1" ? { ...t, loading: false } : t,
        ),
      }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
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