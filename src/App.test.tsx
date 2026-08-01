import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { Settings } from "./lib/types";
import { useConnectionStore } from "./stores/connectionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";

vi.mock("./lib/commands", () => ({
  getConnections: vi.fn().mockResolvedValue([]),
  getFolders: vi.fn().mockResolvedValue([]),
  getTags: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({
    confirm_before_delete: true,
    default_folder_id: null,
    theme: "dark",
    font_size: "medium",
    default_ports: { postgresql: 5432, mysql: 3306, redis: 6379, sqlite: null },
    tag_order: null,
    table_refresh_rate: 30,
    table_page_size: 50,
    shortcuts: {},
  } satisfies Settings),
  testConnection: vi.fn().mockResolvedValue({ ok: true }),
}));

beforeEach(() => {
  useConnectionStore.setState({
    connections: [],
    folders: [],
    tags: [],
    loading: false,
    error: null,
  });
  useSettingsStore.setState({ settings: null, loading: false, error: null });
  useUiStore.setState({ activeView: "home" });
  useUiStore.setState({ activeFolderId: null });
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders home view on mount", async () => {
    render(<App />);
    expect(await screen.findByPlaceholderText(/search connections/i)).toBeInTheDocument();
  });

  it("shows empty state when no connections", async () => {
    render(<App />);
    expect(await screen.findByText(/no connections/i)).toBeInTheDocument();
  });

  it("loads data on mount", async () => {
    render(<App />);
    await screen.findByPlaceholderText(/search connections/i);
    expect(useConnectionStore.getState().loading).toBe(false);
  });

  it("renders settings page when activeView is settings", async () => {
    useUiStore.setState({ activeView: "settings" });
    render(<App />);
    expect(screen.getByRole("heading", { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("renders new connection form when activeView is new-connection", async () => {
    useUiStore.setState({ activeView: "new-connection" });
    render(<App />);
    expect(await screen.findByText("Save Connection")).toBeInTheDocument();
  });

  it("shows error banner when connectionStore has error", async () => {
    const { getConnections } = await import("./lib/commands");
    vi.mocked(getConnections).mockRejectedValueOnce(new Error("Storage error"));
    useConnectionStore.setState({ connections: [], loading: false, error: null });
    render(<App />);
    expect(await screen.findByText(/storage error/i)).toBeInTheDocument();
  });

  it("sets the active folder from default_folder_id on startup", async () => {
    const { getFolders, getSettings } = await import("./lib/commands");
    vi.mocked(getFolders).mockResolvedValueOnce([
      {
        id: "folder-1",
        name: "Projects",
        parent_id: null,
        tag_ids: [],
        created_at: "",
        updated_at: "",
      },
    ]);
    // Resolve settings only after folders have loaded so the default-folder
    // effect doesn't race HomeScreen's "reset missing folder" effect.
    let resolveSettings!: (value: Settings) => void;
    vi.mocked(getSettings).mockImplementationOnce(
      () =>
        new Promise<Settings>((resolve) => {
          resolveSettings = resolve;
        }),
    );
    useUiStore.setState({ activeFolderId: null });
    render(<App />);
    await screen.findByPlaceholderText(/search connections/i);
    resolveSettings({
      confirm_before_delete: true,
      default_folder_id: "folder-1",
      theme: "dark",
      font_size: "medium",
      default_ports: { postgresql: 5432, mysql: 3306, redis: 6379, sqlite: null },
      tag_order: null,
      table_refresh_rate: 30,
      table_page_size: 50,
      shortcuts: {},
    });
    await waitFor(() => {
      expect(useUiStore.getState().activeFolderId).toBe("folder-1");
    });
  });
});