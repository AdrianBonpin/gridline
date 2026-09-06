import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TableControls, formatDuration } from "./TableControls";
import { TooltipProvider } from "../ui/Tooltip";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as exportData from "../../lib/exportData";
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

  it("hides the Insert Row button for a materialized view", () => {
    seed([makeTab()], "tab-1");
    renderControls({ isMatview: true });
    expect(screen.queryByLabelText(/insert row/i)).toBeNull();
  });

  it("stages an insert with only editable columns when Insert Row is clicked", () => {
    const cols = [
      { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: "nextval('users_id_seq')", editable: false, is_generated: false },
      { name: "name", data_type: "text", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
      { name: "created_at", data_type: "timestamp", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: "now()", editable: true, is_generated: false },
    ];
    seed([makeTab({ data: { columns: cols, rows: [], total_rows: 0, page: 1, page_size: 50 } })], "tab-1");
    renderControls({ columns: cols, rows: [] });
    fireEvent.click(screen.getByLabelText(/insert row/i));
    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe("insert");
    expect(queue[0].newData).toEqual({ name: null, created_at: null });
  });

  it("renders the column filter popover with the + Add filter action", () => {
    seed([makeTab()], "tab-1");
    renderControls();
    fireEvent.click(screen.getByLabelText(/column filters/i));
    expect(screen.getByText("Column Filters")).toBeInTheDocument();
    expect(screen.getByText("+ Add filter")).toBeInTheDocument();
  });

  it("debounces filter value edits so a query only fires after the user stops typing", () => {
    vi.useFakeTimers();
    seed([makeTab()], "tab-1");
    const onFilterChange = vi.fn();
    renderControls({
      onFilterChange,
      filterRules: [
        { id: "r1", column: "id", operator: "contains", value: "" },
      ],
    });

    fireEvent.click(screen.getByLabelText(/column filters/i));

    const input = screen.getByPlaceholderText("value");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    // No commit yet — the debounce hasn't elapsed.
    expect(onFilterChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Only the final value is committed, once.
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith([
      expect.objectContaining({ value: "abc" }),
    ]);
  });

  it("closes the filter popover when the button is clicked while it is open", () => {
    seed([makeTab()], "tab-1");
    renderControls();

    fireEvent.click(screen.getByLabelText(/column filters/i));
    expect(screen.getByText("Column Filters")).toBeInTheDocument();

    // Clicking the button while open closes it (plain toggle).
    fireEvent.click(screen.getByLabelText(/column filters/i));
    expect(screen.queryByText("Column Filters")).not.toBeInTheDocument();
  });

  it("toggles the sort rules popover open and closed", () => {
    seed([makeTab()], "tab-1");
    renderControls();

    fireEvent.click(screen.getByLabelText(/sort rules/i));
    expect(screen.getByText("Sort Rules")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/sort rules/i));
    expect(screen.queryByText("Sort Rules")).not.toBeInTheDocument();
  });

  it("toggles the auto-refresh dropdown open and closed", () => {
    seed([makeTab()], "tab-1");
    renderControls();

    fireEvent.click(screen.getByLabelText(/auto-refresh/i));
    expect(screen.getByText("Off")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/auto-refresh/i));
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("toggles the show/hide columns dropdown open and closed", () => {
    seed([makeTab()], "tab-1");
    renderControls();

    fireEvent.click(screen.getByLabelText(/toggle columns/i));
    expect(screen.getByText("Visible columns")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/toggle columns/i));
    expect(screen.queryByText("Visible columns")).not.toBeInTheDocument();
  });

  it("toggles the export dropdown open and closed", () => {
    seed([makeTab()], "tab-1");
    renderControls();

    fireEvent.click(screen.getByLabelText(/export/i));
    expect(screen.getByText("JSON")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/export/i));
    expect(screen.queryByText("JSON")).not.toBeInTheDocument();
  });

  it("export dropdown includes the Excel option", () => {
    seed([makeTab()], "tab-1");
    renderControls();
    fireEvent.click(screen.getByLabelText(/export/i));
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(screen.getByText("CSV")).toBeInTheDocument();
    expect(screen.getByText("SQL")).toBeInTheDocument();
    expect(screen.getByText("Markdown")).toBeInTheDocument();
    expect(screen.getByText("Excel")).toBeInTheDocument();
  });

  it("notifies after a successful export", () => {
    seed([makeTab()], "tab-1");
    useNotificationStore.getState().notifications.length = 0;
    vi.spyOn(exportData, "exportData").mockImplementation(() => {});
    renderControls();
    fireEvent.click(screen.getByLabelText(/export/i));
    fireEvent.click(screen.getByText("Excel"));
    const st = useNotificationStore.getState();
    expect(
      st.notifications.some((n) => n.message.toLowerCase().includes("exported")),
    ).toBe(true);
  });
});