import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import * as commands from "../../lib/commands";

vi.mock("../../lib/commands", () => ({
  getSettings: vi.fn().mockResolvedValue({
    theme: "system",
    font_size: "medium",
    default_folder_id: null,
    confirm_before_delete: true,
    default_ports: { postgresql: 5432, mysql: 3306, sqlite: null, redis: 6379 },
    tag_order: null,
  }),
  updateSetting: vi.fn().mockResolvedValue(undefined),
  getConnections: vi.fn().mockResolvedValue([]),
  getFolders: vi.fn().mockResolvedValue([]),
  getTags: vi.fn().mockResolvedValue([]),
  createConnection: vi.fn().mockResolvedValue({}),
  deleteConnection: vi.fn().mockResolvedValue(undefined),
  addConnectionTags: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn().mockResolvedValue({}),
  updateFolder: vi.fn().mockResolvedValue({}),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  addFolderTags: vi.fn().mockResolvedValue(undefined),
  createTag: vi.fn().mockResolvedValue({}),
  updateTag: vi.fn().mockResolvedValue({}),
  deleteTag: vi.fn().mockResolvedValue(undefined),
  importConnections: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, skippedRecords: [] }),
  exportConnections: vi.fn().mockResolvedValue(""),
}));

const mockFolders = [
  { id: "folder-1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  { id: "folder-2", name: "Personal", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
];

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: null,
      loading: false,
      error: null,
    });
    useConnectionStore.setState({
      connections: [],
      folders: mockFolders,
      tags: [],
      tagOrder: [],
      loading: false,
      error: null,
    });
  });

  it("renders Mac-style title bar with traffic lights, back button, and settings title", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/settings/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/back/i)).toBeInTheDocument();
    expect(document.querySelectorAll("header span").length).toBeGreaterThanOrEqual(3);
  });

  it("renders all five sidebar tabs", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /general/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tags/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /advanced/i })).toBeInTheDocument();
  });

  it("shows the General tab by default", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
  });

  it("switches to the Editor tab and shows placeholder", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /editor/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /editor/i }));
    expect(screen.getByText(/editor settings are coming soon/i)).toBeInTheDocument();
  });

  it("switches to the Tags tab and shows tag management", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /tags/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /tags/i }));
    expect(screen.getByText(/create tag/i)).toBeInTheDocument();
    expect(screen.getByText(/manage tags/i)).toBeInTheDocument();
  });

  it("switches to the Shortcuts tab and shows placeholder", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /shortcuts/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByText(/shortcut customization is coming soon/i)).toBeInTheDocument();
  });

  it("switches to the Advanced tab and shows safety and ports settings", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /advanced/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByRole("switch", { name: /confirm before delete/i })).toBeInTheDocument();
    expect(screen.getByText(/default ports/i)).toBeInTheDocument();
  });

  it("calls updateSetting with the correct key and value when a setting changes", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("radio", { name: /dark/i }));
    await waitFor(() => {
      expect(commands.updateSetting).toHaveBeenCalledWith("theme", "dark");
    });
  });
});