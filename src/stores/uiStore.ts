import { create } from "zustand";
import type { ActiveView, DbType } from "../lib/types";

interface UiState {
  searchQuery: string;
  activeFolderId: string | null;
  activeTagIds: string[];
  activeDbTypes: DbType[];
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  setSearchQuery: (q: string) => void;
  setActiveFolderId: (id: string | null) => void;
  toggleTag: (id: string) => void;
  toggleDbType: (type: DbType) => void;
  clearFilters: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home",
  setActiveView: (view) => set({ activeView: view }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setActiveFolderId: (id) => set({ activeFolderId: id }),
  toggleTag: (id) => set((s) => ({ activeTagIds: s.activeTagIds.includes(id) ? s.activeTagIds.filter((t) => t !== id) : [...s.activeTagIds, id] })),
  toggleDbType: (type) => set((s) => ({ activeDbTypes: s.activeDbTypes.includes(type) ? s.activeDbTypes.filter((t) => t !== type) : [...s.activeDbTypes, type] })),
  clearFilters: () => set({ searchQuery: "", activeTagIds: [], activeDbTypes: [], activeFolderId: null }),
}));