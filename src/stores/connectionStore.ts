import { create } from "zustand";
import type { Connection, ConnectionInput, Folder, FolderInput, Tag, TagInput } from "../lib/types";
import * as cmd from "../lib/commands";

interface ConnectionState {
  connections: Connection[]; folders: Folder[]; tags: Tag[];
  loading: boolean; error: string | null;
  loadAll: () => Promise<void>;
  createConnection: (input: ConnectionInput) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  createFolder: (input: FolderInput) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createTag: (input: TagInput) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [], folders: [], tags: [], loading: false, error: null,
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [connections, folders, tags] = await Promise.all([cmd.getConnections(), cmd.getFolders(), cmd.getTags()]);
      set({ connections, folders, tags, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  createConnection: async (input) => {
    const conn = await cmd.createConnection(input);
    set((s) => ({ connections: [...s.connections, conn] }));
  },
  deleteConnection: async (id) => {
    await cmd.deleteConnection(id);
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },
  createFolder: async (input) => {
    const folder = await cmd.createFolder(input);
    set((s) => ({ folders: [...s.folders, folder] }));
  },
  deleteFolder: async (id) => {
    await cmd.deleteFolder(id);
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id), connections: s.connections.map((c) => c.folder_id === id ? { ...c, folder_id: null } : c) }));
  },
  createTag: async (input) => {
    const tag = await cmd.createTag(input);
    set((s) => ({ tags: [...s.tags, tag] }));
  },
  deleteTag: async (id) => {
    await cmd.deleteTag(id);
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id), connections: s.connections.map((c) => c.tag_ids.includes(id) ? { ...c, tag_ids: c.tag_ids.filter((t) => t !== id) } : c) }));
  },
}));