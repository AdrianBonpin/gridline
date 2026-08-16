import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { QueriesPanel } from "./QueriesPanel";
import { useQueryStore } from "../../stores/queryStore";
import { TooltipProvider } from "../ui/Tooltip";

vi.mock("../../stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));

type MockStore = Record<string, unknown>;

function setMocks(historyOverrides = {}, savedOverrides = {}) {
  const store: MockStore = {
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
  };
  (useQueryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: MockStore) => unknown) => sel(store),
  );
  return store;
}

function renderPanel(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  setMocks();
});

describe("QueriesPanel", () => {
  it("renders Queries header with History/Saved dropdown", () => {
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByLabelText("History/Saved")).toBeInTheDocument();
    // Dropdown shows the current value (History by default)
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("switches between History and Saved Queries via the dropdown", async () => {
    const user = userEvent.setup();
    setMocks({}, {
      savedQueries: [
        { id: "q1", connection_id: "c1", name: "My Saved", query_text: "SELECT 2", folder: "", created_at: "", updated_at: "" },
      ],
      savedLoading: false,
    });
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await user.click(screen.getByLabelText("History/Saved"));
    await user.click(screen.getByText("Saved Queries"));
    await waitFor(() => {
      expect(screen.getByText("My Saved")).toBeInTheDocument();
    });
  });

  it("shows empty state when no history", async () => {
    setMocks({ history: [], historyStale: false });
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no queries yet/i)).toBeInTheDocument();
    });
  });

  it("loads history scoped to the connection on mount", async () => {
    const store = setMocks({ historyStale: true });
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await waitFor(() => {
      expect(store.loadHistory).toHaveBeenCalledWith("c1");
    });
  });

  it("loads saved queries scoped to the connection on mount", async () => {
    const store = setMocks();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await waitFor(() => {
      expect(store.loadSavedQueries).toHaveBeenCalledWith("c1");
    });
  });

  it("shows history entries; clicking a row restores the query into the editor", async () => {
    const onRestore = vi.fn();
    const store = setMocks({
      history: [
        { id: "h1", connection_id: "c1", query_text: "SELECT 1", execution_time_ms: 5, row_count: 1, status: "success", error_message: null, executed_at: "2026-01-01", favorite: false },
      ],
      historyStale: false,
    });
    const user = userEvent.setup();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={onRestore} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/SELECT 1/)).toBeInTheDocument();
    });

    // Load/Run sub-buttons are gone
    expect(screen.queryByLabelText("Load query into editor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Run query from history")).not.toBeInTheDocument();

    // Clicking the row loads the query into the editor
    await user.click(screen.getByText(/SELECT 1/));
    expect(onRestore).toHaveBeenCalledWith("SELECT 1");

    // Favorite toggle still exists, toggles the favorite, and does NOT restore
    onRestore.mockClear();
    await user.click(screen.getByLabelText("Favorite"));
    expect(store.toggleFavorite).toHaveBeenCalledWith("h1", "c1");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("shows saved queries; clicking a row restores it, delete works without restoring", async () => {
    const onRestore = vi.fn();
    const store = setMocks({}, {
      savedQueries: [
        { id: "q1", connection_id: "c1", name: "My Saved", query_text: "SELECT 2", folder: "", created_at: "", updated_at: "" },
      ],
      savedLoading: false,
    });
    const user = userEvent.setup();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={onRestore} />,
    );
    // Switch to Saved Queries via the dropdown
    await user.click(screen.getByLabelText("History/Saved"));
    await user.click(screen.getByText("Saved Queries"));
    await waitFor(() => {
      expect(screen.getByText("My Saved")).toBeInTheDocument();
    });

    // Load/Run sub-buttons are gone
    expect(screen.queryByLabelText("Load saved query")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Run saved query")).not.toBeInTheDocument();

    // Clicking the row loads the query into the editor
    await user.click(screen.getByText("My Saved"));
    expect(onRestore).toHaveBeenCalledWith("SELECT 2");

    // Delete button exists, deletes, and does NOT restore
    onRestore.mockClear();
    await user.click(screen.getByLabelText("Delete saved query"));
    expect(store.deleteSavedQuery).toHaveBeenCalledWith("q1");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("shows Favorites and Clear icons in history mode only", async () => {
    const user = userEvent.setup();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    expect(screen.getByLabelText("Show favorites only")).toBeInTheDocument();
    expect(screen.getByLabelText("Clear history")).toBeInTheDocument();

    // Switch to saved mode — the history-only icons disappear
    await user.click(screen.getByLabelText("History/Saved"));
    await user.click(screen.getByText("Saved Queries"));

    expect(screen.queryByLabelText("Show favorites only")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clear history")).not.toBeInTheDocument();
  });

  it("toggles favorites only and clears history for the connection", async () => {
    const store = setMocks({ history: [], historyStale: false });
    const user = userEvent.setup();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await user.click(screen.getByLabelText("Show favorites only"));
    expect(store.setFavoritesOnly).toHaveBeenCalledWith(true);
    await user.click(screen.getByLabelText("Clear history"));
    expect(store.clearHistory).toHaveBeenCalledWith("c1");
  });

  it("filters history by search query and syncs to the store", async () => {
    const store = setMocks({
      history: [
        { id: "h1", connection_id: "c1", query_text: "SELECT 1", execution_time_ms: 5, row_count: 1, status: "success", error_message: null, executed_at: "2026-01-01", favorite: false },
        { id: "h2", connection_id: "c1", query_text: "SELECT 2", execution_time_ms: 5, row_count: 1, status: "success", error_message: null, executed_at: "2026-01-01", favorite: false },
      ],
      historyStale: false,
    });
    const user = userEvent.setup();
    renderPanel(
      <QueriesPanel connectionId="c1" onRestore={() => {}} />,
    );
    await user.click(screen.getByLabelText("Search queries"));
    const input = screen.getByPlaceholderText("Filter queries…");
    await user.type(input, "SELECT 2");
    await waitFor(() => {
      expect(store.setHistorySearch).toHaveBeenCalledWith("SELECT 2");
    });
    expect(screen.queryByText("SELECT 1")).not.toBeInTheDocument();
    expect(screen.getByText("SELECT 2")).toBeInTheDocument();
  });
});