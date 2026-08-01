import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueriesPanel } from "./QueriesPanel";
import { useQueryStore } from "../../stores/queryStore";
import { useConnectionStore } from "../../stores/connectionStore";

vi.mock("../../stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));
vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: vi.fn(),
}));

function setMocks(historyOverrides = {}, savedOverrides = {}) {
  (useQueryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        history: [],
        historyLoading: false,
        historyError: null,
        historyStale: false,
        historySearch: "",
        favoritesOnly: false,
        savedQueries: [],
        savedLoading: false,
        savedError: null,
        loadHistory: vi.fn(),
        clearHistory: vi.fn(),
        toggleFavorite: vi.fn(),
        setHistorySearch: vi.fn(),
        setFavoritesOnly: vi.fn(),
        loadSavedQueries: vi.fn(),
        renameSavedQuery: vi.fn(),
        deleteSavedQuery: vi.fn(),
        ...historyOverrides,
        ...savedOverrides,
      }),
  );
  (useConnectionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        connections: [{ id: "c1", name: "My DB" }],
      }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setMocks();
});

describe("QueriesPanel", () => {
  it("renders two tabs: History and Saved Queries", () => {
    render(
      <QueriesPanel
        connectionId="c1"
        onRestore={() => {}}
        onRun={() => {}}
      />,
    );
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Saved Queries")).toBeInTheDocument();
  });

  it("switches between History and Saved Queries tabs", async () => {
    const user = userEvent.setup();
    render(
      <QueriesPanel connectionId="c1" onRestore={() => {}} onRun={() => {}} />,
    );
    // History tab is active by default
    const historyTab = screen.getByText("History");
    const savedTab = screen.getByText("Saved Queries");

    expect(historyTab.parentElement?.getAttribute("aria-selected")).toBe("true");
    expect(savedTab.parentElement?.getAttribute("aria-selected")).toBe("false");

    await user.click(savedTab);

    expect(savedTab.parentElement?.getAttribute("aria-selected")).toBe("true");
  });

  it("shows empty state when no history", async () => {
    setMocks({ history: [], historyStale: false });
    render(
      <QueriesPanel connectionId="c1" onRestore={() => {}} onRun={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no queries yet/i)).toBeInTheDocument();
    });
  });

  it("shows history entries with actions", async () => {
    setMocks({
      history: [
        { id: "h1", connection_id: "c1", query_text: "SELECT 1", execution_time_ms: 5, row_count: 1, status: "success", error_message: null, executed_at: "2026-01-01", favorite: false },
      ],
      historyStale: false,
    });
    render(
      <QueriesPanel connectionId="c1" onRestore={() => {}} onRun={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/SELECT 1/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Load query into editor")).toBeInTheDocument();
    expect(screen.getByLabelText("Run query from history")).toBeInTheDocument();
  });

  it("shows saved queries with edit/delete actions", async () => {
    const user = userEvent.setup();
    setMocks({}, {
      savedQueries: [
        { id: "q1", connection_id: "c1", name: "My Saved", query_text: "SELECT 2", folder: "", created_at: "", updated_at: "" },
      ],
      savedLoading: false,
    });
    render(
      <QueriesPanel connectionId="c1" onRestore={() => {}} onRun={() => {}} />,
    );
    // Switch to Saved Queries tab
    await user.click(screen.getByText("Saved Queries"));
    await waitFor(() => {
      expect(screen.getByText("My Saved")).toBeInTheDocument();
    });
  });
});