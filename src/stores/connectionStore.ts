import { create } from "zustand";
import type { Connection, ConnectionInput, Folder, FolderInput, Tag, TagInput } from "../lib/types";
import * as cmd from "../lib/commands";

interface ConnectionState {
  connections: Connection[]; folders: Folder[]; tags: Tag[];
  tagOrder: string[];
  recent: Connection[];
  loading: boolean; error: string | null;
  loadAll: () => Promise<void>;
  loadRecent: () => Promise<void>;
  recordRecent: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  loadTagOrder: () => Promise<void>;
  setTagOrder: (order: string[]) => Promise<void>;
  createConnection: (input: ConnectionInput) => Promise<Connection>;
  deleteConnection: (id: string) => Promise<void>;
  duplicateConnection: (id: string) => Promise<Connection>;
  createFolder: (input: FolderInput) => Promise<void>;
  updateFolder: (id: string, input: FolderInput) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createTag: (input: TagInput) => Promise<void>;
  updateTag: (id: string, input: TagInput) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  addTagToItems: (tagId: string, folderIds: string[], connectionIds: string[]) => Promise<void>;
  moveConnection: (connectionId: string, newFolderId: string | null) => Promise<void>;
  moveSelectionToFolder: (selectedIds: string[], targetFolderId: string | null) => Promise<void>;
  cachePassword: (connectionId: string, password: string) => Promise<void>;
  getConnectionPassword: (connectionId: string) => Promise<string | null>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [], folders: [], tags: [], tagOrder: [], recent: [], loading: false, error: null,
  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [connections, folders, tags] = await Promise.all([cmd.getConnections(), cmd.getFolders(), cmd.getTags()]);
      set({ connections, folders, tags, loading: false });
      // Sort favorites first (stable sort preserves name order within groups)
      set((s) => ({ connections: [...s.connections].sort((a, b) => Number(b.favorite) - Number(a.favorite)) }));
      // Also load tag order
      get().loadTagOrder();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  loadRecent: async () => {
    try {
      const recent = await cmd.getRecentConnections(8);
      const map = new Map(get().connections.map((c) => [c.id, c]));
      set({ recent: recent.map((r) => map.get(r.connection_id)).filter(Boolean) as Connection[] });
    } catch { /* best-effort: recent list is non-critical */ }
  },
  recordRecent: async (id) => {
    try { await cmd.recordRecentConnection(id); } catch { /* best-effort */ }
  },
  toggleFavorite: async (id) => {
    const prev = get().connections;
    const next = prev.map((c) => c.id === id ? { ...c, favorite: !c.favorite } : c);
    set({ connections: next });
    const conn = next.find((c) => c.id === id);
    try {
      await cmd.setConnectionFavorite(id, conn?.favorite ?? false);
    } catch (e) {
      set({ connections: prev }); // rollback
      throw e;
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
    // Persist SSH secrets to OS keychain (not SQLite): password for password
    // auth, passphrase for private-key auth.
    if (input.ssh_host && (input.ssh_auth_method ?? "password") === "password" && input.ssh_password) {
      await cmd.saveConnectionSshPassword(conn.id, input.ssh_password);
    }
    if (input.ssh_host && input.ssh_passphrase) {
      await cmd.saveConnectionSshPassphrase(conn.id, input.ssh_passphrase);
    }
    set((s) => ({ connections: [...s.connections, conn] }));
    return conn;
  },
  duplicateConnection: async (id) => {
    const source = get().connections.find((c) => c.id === id);
    if (!source) throw new Error("Connection not found");
    // Passwords live in the OS keychain and are NEVER copied; the duplicate
    // starts unkeyed and with no favorite flag.
    const input: ConnectionInput = {
      name: `${source.name} (copy)`,
      db_type: source.db_type,
      host: source.host,
      port: source.port,
      username: source.username ?? null,
      database: source.database ?? null,
      folder_id: source.folder_id,
      tag_ids: source.tag_ids ?? [],
      environment: source.environment ?? null,
      ssh_host: source.ssh_host ?? null,
      ssh_port: source.ssh_port ?? null,
      ssh_user: source.ssh_user ?? null,
      ssh_auth_method: (source.ssh_auth_method as ConnectionInput["ssh_auth_method"]) ?? null,
      ssh_private_key_path: source.ssh_private_key_path ?? null,
      ssl_mode: (source.ssl_mode as ConnectionInput["ssl_mode"]) ?? null,
      ssl_ca_path: source.ssl_ca_path ?? null,
      ssl_cert_path: source.ssl_cert_path ?? null,
      ssl_key_path: source.ssl_key_path ?? null,
      password: null,
      use_keychain: false,
    };
    return get().createConnection(input);
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
  moveConnection: async (connectionId, newFolderId) => {
    const state = get();
    const conn = state.connections.find((c) => c.id === connectionId);
    if (!conn) return;
    if (conn.folder_id === newFolderId) return;

    // Capture the snapshot atomically INSIDE the optimistic set()
    // to avoid stale closure issues on rapid successive drags.
    let previousState: { connections: Connection[] };

    // Optimistic update
    set((s) => {
      previousState = { connections: [...s.connections] };
      return {
        connections: s.connections.map((c) =>
          c.id === connectionId ? { ...c, folder_id: newFolderId } : c,
        ),
      };
    });

    try {
      // Build a minimal ConnectionInput with only folder_id changed
      const input: any = {
        name: conn.name,
        db_type: conn.db_type,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        database: conn.database,
        folder_id: newFolderId,
        environment: conn.environment,
        ssh_host: conn.ssh_host,
        ssh_port: conn.ssh_port,
        ssh_user: conn.ssh_user,
        ssh_auth_method: conn.ssh_auth_method,
        ssh_private_key_path: conn.ssh_private_key_path,
        ssl_mode: conn.ssl_mode,
        ssl_ca_path: conn.ssl_ca_path,
        ssl_cert_path: conn.ssl_cert_path,
        ssl_key_path: conn.ssl_key_path,
        tag_ids: conn.tag_ids ?? [],
      };
      await cmd.updateConnection(connectionId, input);
    } catch (e) {
      set({ connections: previousState!.connections });
      throw e;
    }
  },
  moveSelectionToFolder: async (selectedIds, targetFolderId) => {
    const prev = { connections: [...get().connections], folders: [...get().folders] };
    const connIds = new Set<string>();
    const folderIds = new Set<string>();
    for (const id of selectedIds) {
      if (prev.connections.some((c) => c.id === id)) connIds.add(id);
      else if (prev.folders.some((f) => f.id === id)) folderIds.add(id);
    }
    try {
      // Persist first: moveConnection has its own optimistic logic + rollback and
      // would no-op (early-return on same folder_id) if we pre-set the target.
      for (const id of connIds) {
        await get().moveConnection(id, targetFolderId);
      }
      for (const id of folderIds) {
        const f = prev.folders.find((x) => x.id === id);
        if (f) await cmd.updateFolder(id, { name: f.name, parent_id: targetFolderId, tag_ids: f.tag_ids });
      }
    } catch (e) {
      set({ connections: prev.connections, folders: prev.folders });
      throw e;
    }
    // Apply the move optimistically at the end so state always ends moved
    set((s) => ({
      connections: s.connections.map((c) => connIds.has(c.id) ? { ...c, folder_id: targetFolderId } : c),
      folders: s.folders.map((f) => folderIds.has(f.id) ? { ...f, parent_id: targetFolderId } : f),
    }));
  },
}));