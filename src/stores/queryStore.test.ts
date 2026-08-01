import { describe, it, expect, beforeEach, vi } from "vitest";
import { useQueryStore } from "./queryStore";
import * as commands from "../lib/commands";

// Mock the commands module
vi.mock("../lib/commands", () => ({
  getQueryHistory: vi.fn().mockResolvedValue([]),
  clearQueryHistory: vi.fn().mockResolvedValue(undefined),
  setHistoryFavorite: vi.fn().mockResolvedValue(undefined),
  getSavedQueries: vi.fn().mockResolvedValue([]),
  saveQuery: vi.fn().mockResolvedValue({
    id: "q-new",
    connection_id: "c1",
    name: "New",
    query_text: "SELECT 1",
    folder: "",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  }),
  updateSavedQuery: vi.fn().mockResolvedValue(undefined),
  deleteSavedQuery: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  // Reset the store to initial state before each test
  useQueryStore.setState({
    history: null,
    historyLoading: false,
    historyError: null,
    historyStale: true,
    savedQueries: null,
    savedLoading: false,
    savedError: null,
    historyScope: null,
    historySearch: "",
    favoritesOnly: false,
  });
  vi.clearAllMocks();
});

describe("queryStore — history", () => {
  it("loadHistory fetches and stores entries, clears stale flag", async () => {
    const mockEntries = [
      {
        id: "h1", connection_id: "c1", query_text: "SELECT 1",
        execution_time_ms: 5, row_count: 1, status: "success",
        error_message: null, executed_at: "2026-01-01", favorite: false,
      },
    ];
    vi.mocked(commands.getQueryHistory).mockResolvedValueOnce(mockEntries);

    await useQueryStore.getState().loadHistory("c1");

    const state = useQueryStore.getState();
    expect(state.history).toEqual(mockEntries);
    expect(state.historyStale).toBe(false);
    expect(state.historyLoading).toBe(false);
    expect(state.historyError).toBeNull();
  });

  it("loadHistory sets error on failure", async () => {
    vi.mocked(commands.getQueryHistory).mockRejectedValueOnce(new Error("fail"));

    await useQueryStore.getState().loadHistory("c1");

    const state = useQueryStore.getState();
    expect(state.historyError).toBe("fail");
    expect(state.historyLoading).toBe(false);
  });

  it("clearHistory calls clearQueryHistory then resets", async () => {
    await useQueryStore.getState().clearHistory("c1");

    expect(commands.clearQueryHistory).toHaveBeenCalledWith("c1");
    const state = useQueryStore.getState();
    expect(state.history).toEqual([]);
    expect(state.historyStale).toBe(false);
  });

  it('loadHistory("") maps the All-connections sentinel to null (global scope)', async () => {
    await useQueryStore.getState().loadHistory("");
    expect(commands.getQueryHistory).toHaveBeenCalledWith(null, 200, 0);
  });

  it("loadHistory(undefined) maps to null (global scope)", async () => {
    await useQueryStore.getState().loadHistory(undefined);
    expect(commands.getQueryHistory).toHaveBeenCalledWith(null, 200, 0);
  });

  it('clearHistory("") maps the All-connections sentinel to null (global scope)', async () => {
    await useQueryStore.getState().clearHistory("");
    expect(commands.clearQueryHistory).toHaveBeenCalledWith(null);
  });

  it("toggleFavorite optimistic-updates then refetches on failure", async () => {
    const mockEntries = [
      { id: "h1", connection_id: "c1", query_text: "X", execution_time_ms: null, row_count: null, status: "success", error_message: null, executed_at: "", favorite: false },
      { id: "h2", connection_id: "c1", query_text: "Y", execution_time_ms: null, row_count: null, status: "success", error_message: null, executed_at: "", favorite: false },
    ];
    vi.mocked(commands.getQueryHistory).mockResolvedValueOnce(mockEntries);
    await useQueryStore.getState().loadHistory("c1");

    // Toggle h1
    vi.mocked(commands.setHistoryFavorite).mockResolvedValueOnce(undefined);
    await useQueryStore.getState().toggleFavorite("h1", "c1");

    let state = useQueryStore.getState();
    expect(state.history![0].favorite).toBe(true); // optimistic set

    // On failure, refetch
    const reverted = [
      { id: "h1", connection_id: "c1", query_text: "X", execution_time_ms: null, row_count: null, status: "success", error_message: null, executed_at: "", favorite: false },
      { id: "h2", connection_id: "c1", query_text: "Y", execution_time_ms: null, row_count: null, status: "success", error_message: null, executed_at: "", favorite: false },
    ];
    vi.mocked(commands.setHistoryFavorite).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(commands.getQueryHistory).mockResolvedValueOnce(reverted);

    // First toggle h2 — should fail and refetch
    await useQueryStore.getState().toggleFavorite("h2", "c1");
    state = useQueryStore.getState();
    expect(state.history![1].favorite).toBe(false); // rolled back via refetch
  });
});

describe("queryStore — saved queries", () => {
  it("loadSavedQueries fetches and stores entries", async () => {
    const mockSaved = [{ id: "q1", connection_id: "c1", name: "Q1", query_text: "SELECT 1", folder: "", created_at: "", updated_at: "" }];
    vi.mocked(commands.getSavedQueries).mockResolvedValueOnce(mockSaved);

    await useQueryStore.getState().loadSavedQueries("c1");

    const state = useQueryStore.getState();
    expect(state.savedQueries).toEqual(mockSaved);
    expect(state.savedLoading).toBe(false);
    expect(state.savedError).toBeNull();
  });

  it("saveCurrentQuery calls saveQuery with correct input", async () => {
    vi.mocked(commands.saveQuery).mockResolvedValueOnce({
      id: "new-q", connection_id: "c1", name: "MyQ", query_text: "SELECT 2", folder: "r", created_at: "", updated_at: "",
    });

    await useQueryStore.getState().saveCurrentQuery({ connectionId: "c1", name: "MyQ", queryText: "SELECT 2", folder: "r" });

    expect(commands.saveQuery).toHaveBeenCalledWith({ connectionId: "c1", name: "MyQ", queryText: "SELECT 2", folder: "r" });
  });

  it("renameSavedQuery calls updateSavedQuery", async () => {
    await useQueryStore.getState().renameSavedQuery("q1", { name: "Renamed" });
    expect(commands.updateSavedQuery).toHaveBeenCalledWith("q1", { name: "Renamed" });
  });

  it("deleteSavedQuery calls deleteSavedQuery and removes from list", async () => {
    const mockSaved = [{ id: "q1", connection_id: "c1", name: "Q1", query_text: "SELECT 1", folder: "", created_at: "", updated_at: "" }];
    vi.mocked(commands.getSavedQueries).mockResolvedValueOnce(mockSaved);
    await useQueryStore.getState().loadSavedQueries("c1");

    vi.mocked(commands.deleteSavedQuery).mockResolvedValueOnce(undefined);
    await useQueryStore.getState().deleteSavedQuery("q1");

    expect(commands.deleteSavedQuery).toHaveBeenCalledWith("q1");
  });
});