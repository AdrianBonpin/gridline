import { create } from "zustand";
import type { Settings } from "../lib/types";
import * as cmd from "../lib/commands";

interface SettingsState {
  settings: Settings | null; loading: boolean; error: string | null;
  load: () => Promise<void>;
  updateSetting: (key: string, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null, loading: false, error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await cmd.getSettings();
      set({ settings, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  updateSetting: async (key, value) => {
    await cmd.updateSetting(key, value);
    await get().load();
  },
}));