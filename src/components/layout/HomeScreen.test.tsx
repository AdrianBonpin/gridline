import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Connection, Folder } from "../../lib/types";

vi.mock("../../lib/commands", () => ({
  getConnections: vi.fn().mockResolvedValue([]),
  getFolders: vi.fn().mockResolvedValue([]),
  getTags: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({}),
  getRecentConnections: vi.fn().mockResolvedValue([{ connection_id: "recent-1", opened_at: "" }]),
  recordRecentConnection: vi.fn().mockResolvedValue(undefined),
  deleteConnection: vi.fn().mockResolvedValue(undefined),
  deleteConnectionPassword: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: [], folders: [], tags: [], recent: [], loading: false, error: null });
    useUiStore.setState({ searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home", selectedItemIds: [] });
    useSettingsStore.setState({ settings: null, loading: false, error: null });
    // SearchBar stores its debounce timer on window.__sb; clear any timer leaked
    // by a previous test (e.g. typing a URL) so it can't fire mid-test.
    window.clearTimeout((window as unknown as { __sb?: number }).__sb);
  });

  it("renders SearchBar and ActionRow", () => {
    render(<HomeScreen />);
    expect(screen.getByPlaceholderText(/search connections/i)).toBeInTheDocument();
    expect(screen.getByText("New Connection")).toBeInTheDocument();
  });

  it("renders empty state when no connections", () => {
    useConnectionStore.setState({ connections: [] });
    render(<HomeScreen />);
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });

  it("opens new connection screen when a connection string is typed in search", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);
    const input = screen.getByPlaceholderText(/search connections/i);
    await user.type(input, "postgresql://user:pass@localhost:5432/mydb");
    expect(useUiStore.getState().activeView).toBe("new-connection");
    expect(useUiStore.getState().prefilledConnectionString).toBe("postgresql://user:pass@localhost:5432/mydb");
    expect(useUiStore.getState().searchQuery).toBe("");
  });

  it("shows the confirmation dialog before bulk delete by default", async () => {
    const user = userEvent.setup();
    const conn = makeConnection("conn-1");
    useConnectionStore.setState({ connections: [conn] });
    useUiStore.setState({ selectedItemIds: ["conn-1"] });
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /1 selected/i }));
    await user.click(screen.getByRole("button", { name: /delete \(1\)/i }));

    const { deleteConnection } = await import("../../lib/commands");
    expect(
      await screen.findByText(/are you sure you want to delete 1 item/i),
    ).toBeInTheDocument();
    expect(deleteConnection).not.toHaveBeenCalled();
  });

  it("skips the confirmation and deletes selected connections when confirm_before_delete is false", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      settings: {
        ...baseSettings(),
        confirm_before_delete: false,
      },
    });
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    useUiStore.setState({ selectedItemIds: ["conn-1"] });
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /1 selected/i }));
    await user.click(screen.getByRole("button", { name: /delete \(1\)/i }));

    const { deleteConnection } = await import("../../lib/commands");
    expect(deleteConnection).toHaveBeenCalledWith("conn-1");
    expect(screen.queryByText(/are you sure you want to delete/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("animated-backdrop")).not.toBeInTheDocument();
  });

  it("shows the confirmation dialog before deleting a folder by default", async () => {
    const user = userEvent.setup();
    useConnectionStore.setState({ folders: [makeFolder("folder-1")] });
    useUiStore.setState({ activeFolderId: "folder-1" });
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(
      await screen.findByText(/are you sure you want to delete \"projects\"/i),
    ).toBeInTheDocument();
  });

  it("skips the confirmation and deletes the folder when confirm_before_delete is false", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      settings: {
        ...baseSettings(),
        confirm_before_delete: false,
      },
    });
    useConnectionStore.setState({ folders: [makeFolder("folder-1")] });
    useUiStore.setState({ activeFolderId: "folder-1" });
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const { deleteFolder } = await import("../../lib/commands");
    expect(deleteFolder).toHaveBeenCalledWith("folder-1");
    expect(screen.queryByText(/are you sure you want to delete/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("animated-backdrop")).not.toBeInTheDocument();
  });

  it("records a recent connection when opening a connection", async () => {
    const user = userEvent.setup();
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    render(<HomeScreen />);
    await user.click(screen.getByText("Local DB"));
    const { recordRecentConnection } = await import("../../lib/commands");
    await waitFor(() =>
      expect(recordRecentConnection).toHaveBeenCalledWith("conn-1"),
    );
  });

  it("renders the recent connections strip at the root when recents exist", async () => {
    useConnectionStore.setState({ connections: [makeConnection("recent-1")] });
    useUiStore.setState({ activeFolderId: null, searchQuery: "" });
    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByText("Recent")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /local db/i })).toBeInTheDocument();
    });
  });
});

function makeConnection(id: string): Connection {
  return {
    id,
    name: "Local DB",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    username: null,
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    favorite: false,
    created_at: "",
    updated_at: "",
  };
}

function makeFolder(id: string): Folder {
  return {
    id,
    name: "Projects",
    parent_id: null,
    tag_ids: [],
    created_at: "",
    updated_at: "",
  };
}

function baseSettings() {
  return {
    confirm_before_delete: true,
    default_folder_id: null,
    theme: "dark" as const,
    font_size: "medium" as const,
    default_ports: { postgresql: 5432, mysql: 3306, redis: 6379, sqlite: null },
    tag_order: null,
    table_refresh_rate: 30,
    table_page_size: 50,
    shortcuts: {},
    accent_color: "#2563EB",
    editor_font_size: 13,
    editor_font_family: "Space Mono",
    editor_word_wrap: "off" as const,
    editor_minimap: false,
    editor_tab_size: 4,
  };
}