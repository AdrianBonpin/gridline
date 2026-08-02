import { describe, it, expect, beforeEach, vi } from "vitest";
import { useConnectionStore } from "./connectionStore";
import * as commands from "../lib/commands";
import type { Connection, Folder, Tag } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const makeConn = (over: Partial<Connection> = {}): Connection => ({
  id: "c1", name: "P", db_type: "postgresql", host: "h", port: 5432,
  username: null, folder_id: null, keychain_ref: null, tag_ids: [],
  favorite: false, created_at: "", updated_at: "", ...over,
});

beforeEach(() => {
  useConnectionStore.setState({ connections: [], folders: [], tags: [], loading: false, error: null });
  vi.restoreAllMocks();
});

describe("connectionStore", () => {
  it("loadAll fetches connections, folders, tags", async () => {
    const folders: Folder[] = [{ id: "f1", name: "root", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }];
    const tags: Tag[] = [{ id: "t1", name: "prod", color: "#f00", created_at: "" }];
    const conns: Connection[] = [makeConn()];
    vi.spyOn(commands, "getConnections").mockResolvedValue(conns);
    vi.spyOn(commands, "getFolders").mockResolvedValue(folders);
    vi.spyOn(commands, "getTags").mockResolvedValue(tags);
    await useConnectionStore.getState().loadAll();
    expect(useConnectionStore.getState().connections).toEqual(conns);
    expect(useConnectionStore.getState().folders).toEqual(folders);
    expect(useConnectionStore.getState().tags).toEqual(tags);
  });

  it("loadAll sets error on failure", async () => {
    vi.spyOn(commands, "getConnections").mockRejectedValue(new Error("fail"));
    vi.spyOn(commands, "getFolders").mockResolvedValue([]);
    vi.spyOn(commands, "getTags").mockResolvedValue([]);
    await useConnectionStore.getState().loadAll();
    expect(useConnectionStore.getState().error).toContain("fail");
  });

  it("createConnection adds to list on success", async () => {
    const created = makeConn({ id: "c2", name: "New" });
    vi.spyOn(commands, "createConnection").mockResolvedValue(created);
    await useConnectionStore.getState().createConnection({ name: "New", db_type: "postgresql", host: "h", port: 5432 });
    expect(useConnectionStore.getState().connections).toContainEqual(created);
  });

  it("deleteConnection removes from list", async () => {
    useConnectionStore.setState({ connections: [makeConn({ id: "c1" })] });
    vi.spyOn(commands, "deleteConnection").mockResolvedValue(undefined);
    await useConnectionStore.getState().deleteConnection("c1");
    expect(useConnectionStore.getState().connections).toEqual([]);
  });

  it("createFolder adds to folders", async () => {
    const folder: Folder = { id: "f1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" };
    vi.spyOn(commands, "createFolder").mockResolvedValue(folder);
    await useConnectionStore.getState().createFolder({ name: "Work", parent_id: null });
    expect(useConnectionStore.getState().folders).toContainEqual(folder);
  });
});

describe("moveConnection", () => {
  const baseConn: Connection = {
    id: "c1",
    name: "My DB",
    db_type: "postgresql",
    host: "localhost",
    port: null,
    username: null,
    database: "mydb",
    folder_id: null,
    keychain_ref: null,
    environment: null,
    ssh_host: null,
    ssh_port: null,
    ssh_user: null,
    ssh_auth_method: null,
    ssh_private_key_path: null,
    ssl_mode: null,
    ssl_ca_path: null,
    ssl_cert_path: null,
    ssl_key_path: null,
    tag_ids: [],
    favorite: false,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  };

  beforeEach(() => {
    useConnectionStore.setState({
      connections: [
        baseConn,
        { ...baseConn, id: "c2", name: "Other", folder_id: "folder-1" },
      ],
    });
  });

  it("optimistically moves connection to a folder", async () => {
    vi.spyOn(commands, "updateConnection").mockResolvedValueOnce({
      ...baseConn,
      folder_id: "folder-2",
    } as Connection);

    await useConnectionStore.getState().moveConnection("c1", "folder-2");

    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === "c1");
    expect(conn?.folder_id).toBe("folder-2");
  });

  it("moves connection to root when folderId is null", async () => {
    vi.spyOn(commands, "updateConnection").mockResolvedValueOnce({
      ...baseConn,
      id: "c2",
      folder_id: null,
    } as Connection);

    await useConnectionStore.getState().moveConnection("c2", null);

    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === "c2");
    expect(conn?.folder_id).toBeNull();
  });

  it("rolls back on API failure", async () => {
    vi.spyOn(commands, "updateConnection").mockRejectedValueOnce(
      new Error("Network error"),
    );
    const original = useConnectionStore
      .getState()
      .connections.find((c) => c.id === "c1")!;

    await expect(
      useConnectionStore.getState().moveConnection("c1", "folder-3"),
    ).rejects.toThrow("Network error");

    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === "c1");
    expect(conn?.folder_id).toBe(original.folder_id);
  });

  it("no-ops when moving to same folder", async () => {
    const spy = vi.spyOn(commands, "updateConnection");
    await useConnectionStore.getState().moveConnection("c1", null); // c1 is already null
    expect(spy).not.toHaveBeenCalled();
  });

  it("handles rapid successive drags without stale state", async () => {
    const conn1 = makeConn({ id: "c1", folder_id: null });
    const conn2 = makeConn({ id: "c2", folder_id: null, name: "Other" });
    useConnectionStore.setState({
      connections: [conn1, conn2],
      folders: [{ id: "f1", name: "F1", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }],
    });

    // First call hangs until we resolve it; second call resolves immediately
    let resolveFirst: (v: Connection) => void;
    const firstCall = new Promise<Connection>((r) => { resolveFirst = r; });
    let callCount = 0;
    vi.spyOn(commands, "updateConnection").mockImplementation(async (_id, input) => {
      callCount++;
      if (callCount === 1) {
        return firstCall;
      }
      return { ...conn2, folder_id: (input as any).folder_id } as Connection;
    });

    // Start first drag (c1 → f1) — will be pending on updateConnection
    const move1 = useConnectionStore.getState().moveConnection("c1", "f1");
    // Immediately start second drag (c2 → f1) — should complete
    await useConnectionStore.getState().moveConnection("c2", "f1");

    // Second drag should have applied optimistically
    expect(
      useConnectionStore.getState().connections.find((c) => c.id === "c2")?.folder_id
    ).toBe("f1");

    // Resolve the first drag's network call
    resolveFirst!({ ...conn1, folder_id: "f1" } as Connection);
    await move1;

    // Both should be in f1 after both complete
    const state = useConnectionStore.getState();
    expect(state.connections.find((c) => c.id === "c1")?.folder_id).toBe("f1");
    expect(state.connections.find((c) => c.id === "c2")?.folder_id).toBe("f1");
    expect(callCount).toBe(2);
  });
});

describe("favorites / recents / move-selection", () => {
  it("toggleFavorite optimistically flips favorite and persists", async () => {
    useConnectionStore.setState({ connections: [makeConn({ id: "c1", favorite: false })] });
    vi.spyOn(commands, "setConnectionFavorite").mockResolvedValue(undefined);
    await useConnectionStore.getState().toggleFavorite("c1");
    expect(useConnectionStore.getState().connections[0].favorite).toBe(true);
    expect(commands.setConnectionFavorite).toHaveBeenCalledWith("c1", true);
  });

  it("toggleFavorite rolls back on failure", async () => {
    useConnectionStore.setState({ connections: [makeConn({ id: "c1", favorite: false })] });
    vi.spyOn(commands, "setConnectionFavorite").mockRejectedValue(new Error("boom"));
    await expect(useConnectionStore.getState().toggleFavorite("c1")).rejects.toThrow("boom");
    expect(useConnectionStore.getState().connections[0].favorite).toBe(false);
  });

  it("loadAll sorts favorites first within the returned list", async () => {
    const fav = makeConn({ id: "a", name: "A", favorite: true });
    const norm = makeConn({ id: "b", name: "B", favorite: false });
    vi.spyOn(commands, "getConnections").mockResolvedValue([norm, fav]);
    vi.spyOn(commands, "getFolders").mockResolvedValue([]);
    vi.spyOn(commands, "getTags").mockResolvedValue([]);
    vi.spyOn(commands, "getSettings").mockResolvedValue({} as any);
    await useConnectionStore.getState().loadAll();
    const ids = useConnectionStore.getState().connections.map((c) => c.id);
    expect(ids[0]).toBe("a");
  });

  it("recordRecent calls the command once", async () => {
    vi.spyOn(commands, "recordRecentConnection").mockResolvedValue(undefined);
    await useConnectionStore.getState().recordRecent("c1");
    expect(commands.recordRecentConnection).toHaveBeenCalledWith("c1");
  });

  describe("duplicateConnection", () => {
    it("copies fields with a '(copy)' name and favorite false", async () => {
      const src = makeConn({ id: "c1", name: "Prod", folder_id: "f1", tag_ids: ["t1"], favorite: true });
      useConnectionStore.setState({ connections: [src] });
      const created = { ...src, id: "c2", name: "Prod (copy)", favorite: false, keychain_ref: null };
      vi.spyOn(commands, "createConnection").mockResolvedValue(created as any);
      const out = await useConnectionStore.getState().duplicateConnection("c1");
      expect(out.name).toBe("Prod (copy)");
      expect(out.favorite).toBe(false);
      expect(commands.createConnection).toHaveBeenCalledWith(expect.objectContaining({
        name: "Prod (copy)",
        host: src.host,
        folder_id: "f1",
        tag_ids: ["t1"],
        password: null,
      }));
    });

    it("throws when the connection is missing", async () => {
      useConnectionStore.setState({ connections: [] });
      await expect(useConnectionStore.getState().duplicateConnection("nope")).rejects.toThrow("not found");
    });
  });

  it("moveSelectionToFolder moves connections and reparents folders", async () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "c1", folder_id: null })],
      folders: [{ id: "f1", name: "f", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }],
    });
    const originalMoveConnection = useConnectionStore.getState().moveConnection;
    vi.spyOn(useConnectionStore.getState(), "moveConnection").mockResolvedValue(undefined);
    vi.spyOn(commands, "updateFolder").mockResolvedValue({} as any);
    await useConnectionStore.getState().moveSelectionToFolder(["c1", "f1"], "target");
    expect(useConnectionStore.getState().connections[0].folder_id).toBe("target");
    expect(useConnectionStore.getState().folders[0].parent_id).toBe("target");
    // Restore the real action so the mock doesn't linger on future state objects
    useConnectionStore.setState({ moveConnection: originalMoveConnection });
  });
});