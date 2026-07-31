import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilteredConnections } from "./useConnections";
import { useConnectionStore } from "../stores/connectionStore";
import { useUiStore } from "../stores/uiStore";
import type { Connection } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const makeConn = (overrides: Partial<Connection> = {}): Connection => ({
  id: "c1",
  name: "Test DB",
  db_type: "postgresql",
  host: "localhost",
  port: 5432,
  username: null,
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  created_at: "",
  updated_at: "",
  database: null,
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
  ...overrides,
});

beforeEach(() => {
  useConnectionStore.setState({
    connections: [
      makeConn({ id: "c1", name: "Root DB", folder_id: null }),
      makeConn({ id: "c2", name: "Nested DB", folder_id: "f1" }),
      makeConn({ id: "c3", name: "Deep DB", folder_id: "f2" }),
    ],
    folders: [
      { id: "f1", name: "F1", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
      { id: "f2", name: "F2", parent_id: "f1", tag_ids: [], created_at: "", updated_at: "" },
    ],
    tags: [],
    tagOrder: [],
    loading: false,
    error: null,
  });
  useUiStore.setState({
    searchQuery: "",
    activeFolderId: null,
    activeTagIds: [],
    activeDbTypes: [],
    activeEnvironment: null,
  });
});

describe("useFilteredConnections", () => {
  it("returns all connections at root with no filters", () => {
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(3);
  });

  it("returns folder-descendant connections when browsing a folder", () => {
    useUiStore.setState({ activeFolderId: "f1" });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(2);
    expect(result.current.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("returns ALL connections matching search regardless of active folder", () => {
    // c1 "Root DB" is at root (folder_id: null) — filtered out by
    // current folder-scope code when activeFolderId is set.
    useUiStore.setState({ searchQuery: "Root", activeFolderId: "f1" });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("c1");
  });

  it("returns ALL connections matching tag filter regardless of folder", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "c1", name: "Root DB", folder_id: null, tag_ids: ["t1"] }),
        makeConn({ id: "c2", name: "Nested DB", folder_id: "f1", tag_ids: [] }),
        makeConn({ id: "c3", name: "Deep DB", folder_id: "f2", tag_ids: [] }),
      ],
      tags: [{ id: "t1", name: "prod", color: "#f00", created_at: "" }],
    });
    useUiStore.setState({ activeTagIds: ["t1"], activeFolderId: "f1" });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("c1");
  });

  it("returns ALL connections matching environment regardless of folder", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "c1", name: "Prod", db_type: "postgresql", folder_id: null, environment: "production" }),
        makeConn({ id: "c2", name: "Dev", db_type: "sqlite", folder_id: "f1", environment: "development" }),
      ],
      folders: [{ id: "f1", name: "F1", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }],
    });
    useUiStore.setState({ activeEnvironment: "development", activeFolderId: null });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("c2");
  });

  it("environment filter counts as active filter (bypasses folder scope)", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "c1", name: "Prod", db_type: "postgresql", folder_id: null, environment: "production" }),
        makeConn({ id: "c2", name: "Prod2", db_type: "postgresql", folder_id: "f1", environment: "production" }),
      ],
      folders: [{ id: "f1", name: "F1", parent_id: null, tag_ids: [], created_at: "", updated_at: "" }],
    });
    useUiStore.setState({ activeEnvironment: "production", activeFolderId: "f1" });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(2);
  });

  it("returns ALL connections matching DB type filter regardless of folder", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "c1", name: "PG", db_type: "postgresql", folder_id: null }),
        makeConn({ id: "c2", name: "SQLite", db_type: "sqlite", folder_id: "f1" }),
        makeConn({ id: "c3", name: "Deep DB", folder_id: "f2" }),
      ],
    });
    useUiStore.setState({ activeDbTypes: ["sqlite"], activeFolderId: "f1" });
    const { result } = renderHook(() => useFilteredConnections());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("c2");
  });
});