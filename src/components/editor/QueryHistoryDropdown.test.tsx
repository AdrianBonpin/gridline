import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryHistoryDropdown } from "./QueryHistoryDropdown";
import { useQueryStore } from "../../stores/queryStore";
import { TooltipProvider } from "../ui/Tooltip";

// Mock queryStore
vi.mock("../../stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));

const mockLoadHistory = vi.fn();
const mockClearHistory = vi.fn();
const mockToggleFavorite = vi.fn();

function setStoreState(overrides: Record<string, unknown> = {}) {
  (useQueryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        history: null,
        historyLoading: false,
        historyError: null,
        historyStale: true,
        loadHistory: mockLoadHistory,
        clearHistory: mockClearHistory,
        toggleFavorite: mockToggleFavorite,
        ...overrides,
      }),
  );
}

function renderDropdown(props: {
  connectionId: string;
  onRestore?: (sql: string) => void;
  onRun?: (sql: string) => void;
}) {
  return render(
    <TooltipProvider>
      <QueryHistoryDropdown
        connectionId={props.connectionId}
        onRestore={props.onRestore ?? (() => {})}
        onRun={props.onRun ?? (() => {})}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setStoreState();
});

describe("QueryHistoryDropdown", () => {
  it("opens dropdown on button click and loads history if stale", async () => {
    const user = userEvent.setup();
    renderDropdown({ connectionId: "conn-1" });

    const btn = screen.getByLabelText("Query history");
    await user.click(btn);

    // Should trigger loadHistory because stale
    expect(mockLoadHistory).toHaveBeenCalledWith("conn-1");

    // Dropdown menu should appear (check for empty state)
    await waitFor(() => {
      expect(screen.getByText(/no queries/i)).toBeInTheDocument();
    });
  });

  it("displays history items with metadata", async () => {
    const user = userEvent.setup();
    setStoreState({
      history: [
        {
          id: "h1",
          connection_id: "conn-1",
          query_text: "SELECT * FROM users",
          execution_time_ms: 42,
          row_count: 10,
          status: "success",
          error_message: null,
          executed_at: "2026-01-01T12:00:00Z",
          favorite: false,
        },
      ],
      historyStale: false,
    });

    renderDropdown({ connectionId: "conn-1" });

    await user.click(screen.getByLabelText("Query history"));

    await waitFor(() => {
      expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
      expect(screen.getByText(/42ms/)).toBeInTheDocument();
      expect(screen.getByText(/10 rows/)).toBeInTheDocument();
    });
  });

  it("calls onRestore when Load button clicked", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    setStoreState({
      history: [
        {
          id: "h1",
          connection_id: "conn-1",
          query_text: "SELECT 1",
          execution_time_ms: 1,
          row_count: 1,
          status: "success",
          error_message: null,
          executed_at: "",
          favorite: false,
        },
      ],
      historyStale: false,
    });

    renderDropdown({ connectionId: "conn-1", onRestore });
    await user.click(screen.getByLabelText("Query history"));
    await user.click(screen.getByLabelText("Load query into editor"));

    expect(onRestore).toHaveBeenCalledWith("SELECT 1");
  });

  it("calls onRun when Run button clicked", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    setStoreState({
      history: [
        {
          id: "h1",
          connection_id: "conn-1",
          query_text: "SELECT 1",
          execution_time_ms: 1,
          row_count: 1,
          status: "success",
          error_message: null,
          executed_at: "",
          favorite: false,
        },
      ],
      historyStale: false,
    });

    renderDropdown({ connectionId: "conn-1", onRun });
    await user.click(screen.getByLabelText("Query history"));
    await user.click(screen.getByLabelText("Run query from history"));

    expect(onRun).toHaveBeenCalledWith("SELECT 1");
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    renderDropdown({ connectionId: "conn-1" });

    await user.click(screen.getByLabelText("Query history"));
    // Menu is open
    expect(screen.getByText(/no queries/i)).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText(/no queries/i)).not.toBeInTheDocument();
    });
  });
});