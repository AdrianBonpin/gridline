import { create } from "zustand";
import type { Connection, ConnectionInput, Folder, FolderInput, Tag, TagInput } from "../lib/types";
import * as cmd from "../lib/commands";

interface ConnectionState {
  connections: Connection[]; folders: Folder[]; tags: Tag[];
  tagOrder: string[];
  loading: boolean; error: string | null;
  loadAll: () => Promise<void>;
  loadTagOrder: () => Promise<void>;
  setTagOrder: (order: string[]) => Promise<void>;
  createConnection: (input: ConnectionInput) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  createFolder: (input: FolderInput) => Promise<void>;
  updateFolder: (id: string, input: FolderInput) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createTag: (input: TagInput) => Promise<void>;
  updateTag: (id: string, input: TagInput) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  addTagToItems: (tagId: string, folderIds: string[], connectionIds: string[]) => Promise<void>;
  cachePassword: (connectionId: string, password: string) => Promise<void>;
  getConnectionPassword: (connectionId: string) => Promise<string | null>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [], folders: [], tags: [], tagOrder: [], loading: false, error: null,
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [connections, folders, tags] = await Promise.all([cmd.getConnections(), cmd.getFolders(), cmd.getTags()]);
      set({ connections, folders, tags, loading: false });
      // Also load tag order
      get().loadTagOrder();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  loadTagOrder: async () => {
    try {
      const settings = await cmd.getSettings();
      if (settings.tag_order) {
        try {
          const order = JSON.parse(settings.tag_order);
          if (Array.isArray(order)) set({ tagOrder: order });
        } catch {}
      }
    } catch {}
  },
  setTagOrder: async (order) => {
    await cmd.updateSetting("tag_order", JSON.stringify(order));
    set({ tagOrder: order });
  },
  createConnection: async (input) => {
    const conn = await cmd.createConnection(input);
    // Persist password to OS keychain (not SQLite)
    if (input.password) {
      await cmd.saveConnectionPassword(conn.id, input.password);
    }
    set((s) => ({ connections: [...s.connections, conn] }));
  },
  deleteConnection: async (id) => {
    await cmd.deleteConnection(id);
    // Remove password from keychain
    try { await cmd.deleteConnectionPassword(id); } catch { /* ignore */ }
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },
  createFolder: async (input) => {
    const folder = await cmd.createFolder(input);
    set((s) => ({ folders: [...s.folders, folder] }));
  },
  updateFolder: async (id, input) => {
    const folder = await cmd.updateFolder(id, input);
    set((s) => ({ folders: s.folders.map((f) => f.id === id ? folder : f) }));
  },
  deleteFolder: async (id) => {
    await cmd.deleteFolder(id);
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id), connections: s.connections.map((c) => c.folder_id === id ? { ...c, folder_id: null } : c) }));
  },
  createTag: async (input) => {
    const tag = await cmd.createTag(input);
    set((s) => ({ tags: [...s.tags, tag] }));
  },
  updateTag: async (id, input) => {
    const tag = await cmd.updateTag(id, input);
    set((s) => ({ tags: s.tags.map((t) => t.id === id ? tag : t) }));
  },
  deleteTag: async (id) => {
    await cmd.deleteTag(id);
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id),
      connections: s.connections.map((c) => c.tag_ids.includes(id) ? { ...c, tag_ids: c.tag_ids.filter((t) => t !== id) } : c),
      folders: s.folders.map((f) => f.tag_ids.includes(id) ? { ...f, tag_ids: f.tag_ids.filter((t) => t !== id) } : f),
    }));
  },
  cachePassword: async (connectionId, password) => {
    await cmd.saveConnectionPassword(connectionId, password);
  },
  getConnectionPassword: async (connectionId) => {
    return cmd.getConnectionPassword(connectionId);
  },
  addTagToItems: async (tagId, folderIds, connectionIds) => {
    await Promise.all([
      ...folderIds.map((fid) => cmd.addFolderTags(fid, [tagId])),
      ...connectionIds.map((cid) => cmd.addConnectionTags(cid, [tagId])),
    ]);
    set((s) => ({
      folders: s.folders.map((f) =>
        folderIds.includes(f.id) && !f.tag_ids.includes(tagId)
          ? { ...f, tag_ids: [...f.tag_ids, tagId] }
          : f,
      ),
      connections: s.connections.map((c) =>
        connectionIds.includes(c.id) && !c.tag_ids.includes(tagId)
          ? { ...c, tag_ids: [...c.tag_ids, tagId] }
          : c,
      ),
    }));
  },
}));