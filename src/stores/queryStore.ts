import { create } from "zustand";
import type { QueryHistoryEntry, SavedQuery, SaveQueryInput, UpdateSavedQueryPatch } from "../lib/commands";
import {
  getQueryHistory,
  clearQueryHistory,
  setHistoryFavorite,
  getSavedQueries,
  saveQuery,
  updateSavedQuery,
  deleteSavedQuery,
} from "../lib/commands";

interface QueryState {
  // History
  history: QueryHistoryEntry[] | null;
  historyLoading: boolean;
  historyError: string | null;
  historyStale: boolean;
  historyScope: string | null; // null = all connections, string = connectionId
  historySearch: string;
  favoritesOnly: boolean;

  // Saved queries
  savedQueries: SavedQuery[] | null;
  savedLoading: boolean;
  savedError: string | null;

  // Actions — History
  loadHistory: (connectionId?: string) => Promise<void>;
  clearHistory: (connectionId?: string) => Promise<void>;
  toggleFavorite: (id: string, connectionId: string) => Promise<void>;
  invalidateHistory: (connectionId: string) => void;
  setHistoryScope: (scope: string | null) => void;
  setHistorySearch: (search: string) => void;
  setFavoritesOnly: (on: boolean) => void;

  // Actions — Saved queries
  loadSavedQueries: (connectionId?: string | null) => Promise<void>;
  saveCurrentQuery: (input: SaveQueryInput) => Promise<SavedQuery>;
  renameSavedQuery: (id: string, patch: UpdateSavedQueryPatch) => Promise<void>;
  deleteSavedQuery: (id: string) => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  history: null,
  historyLoading: false,
  historyError: null,
  historyStale: true,
  historyScope: null,
  historySearch: "",
  favoritesOnly: false,
  savedQueries: null,
  savedLoading: false,
  savedError: null,

  loadHistory: async (connectionId) => {
    set({ historyLoading: true, historyError: null });
    try {
      const rows = await getQueryHistory(connectionId ?? "", 200, 0);
      set({ history: rows, historyStale: false, historyLoading: false });
    } catch (e) {
      set({ historyError: e instanceof Error ? e.message : String(e), historyLoading: false });
    }
  },

  clearHistory: async (connectionId) => {
    await clearQueryHistory(connectionId ?? "");
    set({ history: [], historyStale: false });
  },

  toggleFavorite: async (id, connectionId) => {
    const prev = get().history;
    if (prev) {
      // Optimistic toggle
      set({
        history: prev.map((e) =>
          e.id === id ? { ...e, favorite: !e.favorite } : e,
        ),
      });
    }
    try {
      await setHistoryFavorite(id, connectionId);
    } catch {
      // Roll back by refetching
      await get().loadHistory(connectionId);
    }
  },

  invalidateHistory: (connectionId) => {
    // Only invalidate if the current scope includes this connection
    const scope = get().historyScope;
    if (scope === null || scope === connectionId) {
      set({ historyStale: true });
    }
  },

  setHistoryScope: (scope) => set({ historyScope: scope, historyStale: true }),
  setHistorySearch: (search) => set({ historySearch: search }),
  setFavoritesOnly: (on) => set({ favoritesOnly: on }),

  loadSavedQueries: async (connectionId) => {
    set({ savedLoading: true, savedError: null });
    try {
      const rows = await getSavedQueries(connectionId ?? null);
      set({ savedQueries: rows, savedLoading: false });
    } catch (e) {
      set({ savedError: e instanceof Error ? e.message : String(e), savedLoading: false });
    }
  },

  saveCurrentQuery: async (input) => {
    const result = await saveQuery(input);
    // Refresh the list
    await get().loadSavedQueries(input.connectionId);
    return result;
  },

  renameSavedQuery: async (id, patch) => {
    await updateSavedQuery(id, patch);
    // Refresh — we don't know which scope the panel was viewing, so reload all
    await get().loadSavedQueries(null);
  },

  deleteSavedQuery: async (id) => {
    await deleteSavedQuery(id);
    // Optimistic: remove from local state
    const prev = get().savedQueries;
    if (prev) {
      set({ savedQueries: prev.filter((q) => q.id !== id) });
    }
  },
}));