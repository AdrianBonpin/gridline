import { create } from "zustand";
import type { ActiveView, DbType } from "../lib/types";

interface UiState {
  searchQuery: string;
  activeFolderId: string | null;
  activeTagIds: string[];
  activeDbTypes: DbType[];
  activeView: ActiveView;
  selectedItemIds: string[];
  prefilledConnectionString: string | null;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (q: string) => void;
  setActiveFolderId: (id: string | null) => void;
  toggleTag: (id: string) => void;
  toggleDbType: (type: DbType) => void;
  clearFilters: () => void;
  toggleItemSelection: (id: string) => void;
  selectAllItems: (ids: string[]) => void;
  clearSelection: () => void;
  setPrefilledConnectionString: (value: string) => void;
  clearPrefilledConnectionString: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home", selectedItemIds: [], prefilledConnectionString: null,
  setActiveView: (view) => set({ activeView: view }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveFolderId: (id) => set({ activeFolderId: id, selectedItemIds: [] }),
  toggleTag: (id) => set((s) => ({ activeTagIds: s.activeTagIds.includes(id) ? s.activeTagIds.filter((t) => t !== id) : [...s.activeTagIds, id] })),
  toggleDbType: (type) => set((s) => ({ activeDbTypes: s.activeDbTypes.includes(type) ? s.activeDbTypes.filter((t) => t !== type) : [...s.activeDbTypes, type] })),
  clearFilters: () => set({ searchQuery: "", activeTagIds: [], activeDbTypes: [], activeFolderId: null }),
  toggleItemSelection: (id) => set((s) => ({
    selectedItemIds: s.selectedItemIds.includes(id)
      ? s.selectedItemIds.filter((i) => i !== id)
      : [...s.selectedItemIds, id],
  })),
  selectAllItems: (ids) => set({ selectedItemIds: ids }),
  clearSelection: () => set({ selectedItemIds: [] }),
  setPrefilledConnectionString: (value) => set({ prefilledConnectionString: value }),
  clearPrefilledConnectionString: () => set({ prefilledConnectionString: null }),
}));