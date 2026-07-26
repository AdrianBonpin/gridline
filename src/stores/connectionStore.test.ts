import { describe, it, expect, beforeEach, vi } from "vitest";
import { useConnectionStore } from "./connectionStore";
import * as commands from "../lib/commands";
import type { Connection, Folder, Tag } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const makeConn = (over: Partial<Connection> = {}): Connection => ({
  id: "c1", name: "P", db_type: "postgresql", host: "h", port: 5432,
  username: null, folder_id: null, keychain_ref: null, tag_ids: [],
  created_at: "", updated_at: "", ...over,
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