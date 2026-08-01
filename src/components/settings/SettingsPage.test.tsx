import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { TagsSettingsTab, reorderTagIds } from "./TagsSettingsTab";
import { AdvancedSettingsTab } from "./AdvancedSettingsTab";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import * as commands from "../../lib/commands";

vi.mock("motion/react", () => ({
  motion: {
    div: React.forwardRef((props: any, ref: any) => (
      <div ref={ref} {...props} />
    )),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../lib/commands", () => ({
  getSettings: vi.fn().mockResolvedValue({
    theme: "system",
    font_size: "medium",
    default_folder_id: null,
    confirm_before_delete: true,
    default_ports: { postgresql: 5432, mysql: 3306, sqlite: null, redis: 6379 },
    tag_order: null,
    table_refresh_rate: 0,
    table_page_size: 50,
    shortcuts: {},
    accent_color: "#2563EB",
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

const baseSettings = {
  theme: "system" as const,
  font_size: "medium" as const,
  default_folder_id: null,
  confirm_before_delete: true,
  default_ports: { postgresql: 5432, mysql: 3306, sqlite: null as number | null, redis: 6379 },
  tag_order: null,
  table_refresh_rate: 0,
  table_page_size: 50,
  shortcuts: {} as Record<string, string>,
  accent_color: "#2563EB",
};

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: baseSettings,
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

  it("renders settings header with back button and active tab title", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /general/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("renders all five sidebar tabs with proper ARIA roles", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tags/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /shortcuts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /advanced/i })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("shows the General tab by default and marks it selected", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /general/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-general");
  });

  it("switches to the Editor tab and shows placeholder", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /editor/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /editor/i }));
    expect(screen.getByText(/editor settings are coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /editor/i })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the Tags tab and shows accessible tag management", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /tags/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /tags/i }));
    expect(screen.getByText(/manage tags/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tags/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-tags");
  });

  it("switches to the Shortcuts tab and shows keyboard shortcuts", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /shortcuts/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /shortcuts/i }));
    expect(screen.getByText(/command palette/i)).toBeInTheDocument();
  });

  it("switches to the Advanced tab and shows safety and ports settings", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /advanced/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /advanced/i }));
    expect(screen.getByRole("switch", { name: /confirm before delete/i })).toBeInTheDocument();
    expect(screen.getByText(/default ports/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /advanced/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-advanced");
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

describe("GeneralSettingsTab", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: baseSettings,
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

  it("renders appearance, interface, and workspace sections", () => {
    render(<GeneralSettingsTab />);
    expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/font size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default folder/i)).toBeInTheDocument();
  });

  it("renders the accent color picker and persists a selection", async () => {
    const user = userEvent.setup();
    render(<GeneralSettingsTab />);
    const accentGroup = screen.getByRole("radiogroup", { name: /accent color/i });
    expect(accentGroup).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /accent #22c55e/i }));
    await waitFor(() => {
      expect(commands.updateSetting).toHaveBeenCalledWith("accent_color", "#22C55E");
    });
  });
});

describe("TagsSettingsTab", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [],
      folders: [],
      tags: [
        { id: "tag-1", name: "Production", color: "#ef4444", created_at: "" },
        { id: "tag-2", name: "Staging", color: "#3b82f6", created_at: "" },
      ],
      tagOrder: ["tag-1", "tag-2"],
      loading: false,
      error: null,
    });
  });

  it("renders tag creation and management controls with accessible labels", () => {
    render(<TagsSettingsTab />);
    expect(screen.getByLabelText(/new tag name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
    expect(screen.getByText(/production/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete tag production/i })).toBeInTheDocument();
    const moveUpButtons = screen.getAllByRole("button", { name: /move tag up/i });
    expect(moveUpButtons.length).toBeGreaterThanOrEqual(2);
    const moveDownButtons = screen.getAllByRole("button", { name: /move tag down/i });
    expect(moveDownButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("renders a drag handle for each tag", () => {
    render(<TagsSettingsTab />);
    expect(screen.getAllByRole("button", { name: /drag to reorder/i })).toHaveLength(2);
  });

  it("reorderTagIds moves the active id to the over id position", () => {
    expect(reorderTagIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderTagIds(["a", "b", "c"], "b", "a")).toEqual(["b", "a", "c"]);
  });

  it("reorderTagIds leaves the order unchanged for same or unknown ids", () => {
    expect(reorderTagIds(["a", "b", "c"], "a", "a")).toEqual(["a", "b", "c"]);
    expect(reorderTagIds(["a", "b", "c"], "a", "zzz")).toEqual(["a", "b", "c"]);
    expect(reorderTagIds(["a", "b", "c"], "zzz", "c")).toEqual(["a", "b", "c"]);
  });
});

describe("AdvancedSettingsTab", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: baseSettings,
      loading: false,
      error: null,
    });
  });

  it("renders safety toggle and labeled default port inputs", () => {
    render(<AdvancedSettingsTab />);
    expect(screen.getByRole("switch", { name: /confirm before delete/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/default port for postgresql/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default port for mysql/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default port for sqlite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default port for redis/i)).toBeInTheDocument();
  });
});