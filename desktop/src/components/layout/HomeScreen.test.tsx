import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { SEARCH_DEBOUNCE_MS } from "../search/SearchBar";
import type { Connection, Folder } from "../../lib/types";

const CONNECTION_STRING = "postgresql://user:pass@localhost:5432/mydb";

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
  createConnection: vi.fn(),
  updateConnection: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  importConnections: vi.fn(),
  // Connection transfer files are authorized by Rust File Grants: the renderer
  // asks for a grant and hands the id back, so these two are the whole file
  // boundary (no path, no fs plugin).
  selectFileForGrant: vi.fn(),
  readConnectionsFile: vi.fn(),
  exportConnectionsToFile: vi.fn(),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: [], folders: [], tags: [], recent: [], loading: false, error: null });
    useUiStore.setState({ searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home", selectedItemIds: [], prefilledConnectionString: null });
    useSettingsStore.setState({ settings: null, loading: false, error: null });
    useNotificationStore.setState({ notifications: [] });
  });

  // A test that installs a fake clock must never leak it into the next one.
  afterEach(() => {
    vi.useRealTimers();
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

  it("opens new connection screen when a connection string is typed in search", () => {
    // The search box debounces its store update, so the clock is advanced by
    // hand: leaving that debounce to real wall-clock time made this test fail
    // whenever the timer happened to land mid-typing under load.
    vi.useFakeTimers();
    render(<HomeScreen />);
    const input = screen.getByPlaceholderText(/search connections/i) as HTMLInputElement;

    // Each change carries one more character than the value already in the
    // box, exactly as a keystroke does.
    const typeText = (text: string) => {
      for (const char of text) {
        fireEvent.change(input, { target: { value: input.value + char } });
      }
    };

    // `postgresql://user:pass@` has no host yet, so it is not a connection
    // string: it arms the search debounce. The next character makes it one.
    typeText("postgresql://user:pass@");
    typeText("l");
    // Let the debounce elapse while the user pauses mid-address. A pending
    // debounce must not commit its now-stale prefix — that prefix used to come
    // back through the store mirror and truncate both the box and the prefill.
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    });
    typeText("ocalhost:5432/mydb");

    expect(input).toHaveValue(CONNECTION_STRING);
    expect(useUiStore.getState().activeView).toBe("new-connection");
    expect(useUiStore.getState().prefilledConnectionString).toBe(CONNECTION_STRING);
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

  it("opens EditConnectionModal from the connection card kebab menu", async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    render(<HomeScreen />);

    await user.click(screen.getByLabelText("Connection actions"));
    await user.click(screen.getByText("Manage"));
    await user.click(screen.getByText("Edit…"));

    expect(await screen.findByText("Edit Connection")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Local DB")).toBeInTheDocument();
  });

  it("shows the confirmation dialog before deleting a connection from the kebab menu by default", async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    render(<HomeScreen />);

    await user.click(screen.getByLabelText("Connection actions"));
    await user.click(screen.getByText("Manage"));
    await user.click(screen.getByText("Delete…"));

    expect(
      await screen.findByText(/are you sure you want to delete \"Local DB\"/i),
    ).toBeInTheDocument();
    const { deleteConnection } = await import("../../lib/commands");
    expect(deleteConnection).not.toHaveBeenCalled();
  });

  it("states that Connection-owned Data is removed when deleting a connection", async () => {
    const user = userEvent.setup();
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    render(<HomeScreen />);

    await user.click(screen.getByLabelText("Connection actions"));
    await user.click(screen.getByText("Manage"));
    await user.click(screen.getByText("Delete…"));

    const message = await screen.findByText(/Connection-owned Data/i);
    expect(message).toHaveTextContent(/query history/i);
    expect(message).toHaveTextContent(/recent-connection records/i);
    expect(message).toHaveTextContent(/saved queries for this connection/i);
    expect(message).toHaveTextContent(/global saved queries/i);
  });

  it("deletes a connection from the kebab menu without confirmation when confirm_before_delete is false", async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...baseSettings(),
        confirm_before_delete: false,
      },
    });
    useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
    render(<HomeScreen />);

    await user.click(screen.getByLabelText("Connection actions"));
    await user.click(screen.getByText("Manage"));
    await user.click(screen.getByText("Delete…"));

    const { deleteConnection } = await import("../../lib/commands");
    await waitFor(() =>
      expect(deleteConnection).toHaveBeenCalledWith("conn-1"),
    );
    expect(
      screen.queryByText(/are you sure you want to delete/i),
    ).not.toBeInTheDocument();
  });

  it("reports imported, skipped, and dropped-link counts after an import", async () => {
    const user = userEvent.setup();
    const commands = await import("../../lib/commands");
    (commands.selectFileForGrant as any).mockResolvedValue({
      id: "grant-import",
      path: "/tmp/connections.json",
      displayName: "connections.json",
      intent: "read",
      expiresInSeconds: 300,
    });
    (commands.readConnectionsFile as any).mockResolvedValue("[]");
    (commands.importConnections as any).mockResolvedValue({
      imported: 1,
      skipped: 1,
      skippedRecords: [{ index: 1, reason: "missing or empty name" }],
      warnings: [
        {
          index: 0,
          name: "Prod",
          message: 'tag "tag-remote" does not exist here; connection imported without that tag',
        },
      ],
    });
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /import \/ export/i }));
    await user.click(screen.getByText("Import Connections"));

    await waitFor(() => {
      const messages = useNotificationStore.getState().notifications.map((n) => n.message);
      expect(messages).toContain(
        "Imported 1 connection, 1 record skipped, 1 link dropped.",
      );
      expect(messages).toContain(
        'Prod: tag "tag-remote" does not exist here; connection imported without that tag',
      );
    });
  });

  it("reports a rejected import instead of failing silently", async () => {
    const user = userEvent.setup();
    const commands = await import("../../lib/commands");
    (commands.selectFileForGrant as any).mockResolvedValue({
      id: "grant-broken",
      path: "/tmp/broken.json",
      displayName: "broken.json",
      intent: "read",
      expiresInSeconds: 300,
    });
    (commands.readConnectionsFile as any).mockResolvedValue("{ not json");
    (commands.importConnections as any).mockRejectedValue(
      "invalid connection file: expected value at line 1 column 1",
    );
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /import \/ export/i }));
    await user.click(screen.getByText("Import Connections"));

    await waitFor(() => {
      const errorNotifications = useNotificationStore
        .getState()
        .notifications.filter((n) => n.type === "error");
      expect(errorNotifications.map((n) => n.message)).toContain(
        "Import failed: invalid connection file: expected value at line 1 column 1",
      );
    });
    expect(commands.importConnections).toHaveBeenCalledWith("{ not json");
  });

  it("exports through a write-intent File Grant and reports the granted path", async () => {
    const user = userEvent.setup();
    const commands = await import("../../lib/commands");
    (commands.selectFileForGrant as any).mockClear();
    (commands.selectFileForGrant as any).mockResolvedValue({
      id: "grant-export",
      path: "/tmp/connections-export.json",
      displayName: "connections-export.json",
      intent: "write",
      expiresInSeconds: 300,
    });
    (commands.exportConnectionsToFile as any).mockResolvedValue(
      "/tmp/connections-export.json",
    );
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /import \/ export/i }));
    await user.click(screen.getByText("Export Connections"));

    await waitFor(() =>
      expect(commands.exportConnectionsToFile).toHaveBeenCalledWith("grant-export"),
    );
    // A write intent, and no path in the request: the destination lives in the
    // grant, so a renderer-supplied path can never direct this write.
    const request = (commands.selectFileForGrant as any).mock.calls[0][0];
    expect(request.intent).toBe("write");
    expect(request).not.toHaveProperty("path");
  });

  /**
   * Everyday home-screen mutations (ticket 39).
   *
   * A failed delete or duplicate used to end in `console.error` with the item
   * still on screen and the selection cleared, so a locked store or a keychain
   * failure was indistinguishable from success. Every failure is now reported
   * in the UI, and the items that failed stay selected for a retry.
   */
  describe("mutation failures are visible and retain the failed selection", () => {
    const errorMessages = () =>
      useNotificationStore
        .getState()
        .notifications.filter((n) => n.type === "error")
        .map((n) => n.message);

    it("reports a per-item bulk delete failure and keeps the failed item selected", async () => {
      const user = userEvent.setup();
      // A failure is never only a console line: the user sees it.
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const commands = await import("../../lib/commands");
      (commands.deleteConnection as any).mockImplementation((id: string) =>
        id === "conn-2"
          ? Promise.reject(new Error("store is locked"))
          : Promise.resolve(undefined),
      );
      useSettingsStore.setState({
        settings: { ...baseSettings(), confirm_before_delete: false },
      });
      useConnectionStore.setState({
        connections: [makeConnection("conn-1", "Alpha"), makeConnection("conn-2", "Beta")],
      });
      useUiStore.setState({ selectedItemIds: ["conn-1", "conn-2"] });
      render(<HomeScreen />);

      await user.click(screen.getByRole("button", { name: /2 selected/i }));
      await user.click(screen.getByRole("button", { name: /delete \(2\)/i }));

      await waitFor(() => {
        expect(errorMessages().join(" | ")).toMatch(/Beta/);
        expect(errorMessages().join(" | ")).toMatch(/store is locked/);
      });
      // The item that failed stays selected so it can be retried; the one that
      // was actually deleted does not linger in the selection.
      expect(useUiStore.getState().selectedItemIds).toEqual(["conn-2"]);
      expect(useConnectionStore.getState().connections.map((c) => c.id)).toEqual([
        "conn-2",
      ]);
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("reports every failed item, not a capped sample", async () => {
      const user = userEvent.setup();
      const commands = await import("../../lib/commands");
      (commands.deleteConnection as any).mockRejectedValue(
        new Error("store is locked"),
      );
      useSettingsStore.setState({
        settings: { ...baseSettings(), confirm_before_delete: false },
      });
      const conns = [
        makeConnection("conn-1", "Alpha"),
        makeConnection("conn-2", "Beta"),
        makeConnection("conn-3", "Gamma"),
        makeConnection("conn-4", "Delta"),
        makeConnection("conn-5", "Epsilon"),
      ];
      useConnectionStore.setState({ connections: conns });
      useUiStore.setState({ selectedItemIds: conns.map((c) => c.id) });
      render(<HomeScreen />);

      await user.click(screen.getByRole("button", { name: /5 selected/i }));
      await user.click(screen.getByRole("button", { name: /delete \(5\)/i }));

      await waitFor(() => {
        const joined = errorMessages().join(" | ");
        for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) {
          expect(joined).toContain(`Failed to delete "${name}"`);
        }
      });
      expect(useUiStore.getState().selectedItemIds).toEqual([
        "conn-1",
        "conn-2",
        "conn-3",
        "conn-4",
        "conn-5",
      ]);
    });

    it("reports a failed duplicate connection", async () => {
      const user = userEvent.setup();
      const commands = await import("../../lib/commands");
      (commands.createConnection as any).mockRejectedValue(
        new Error("keychain unavailable"),
      );
      useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
      render(<HomeScreen />);

      await user.click(screen.getByLabelText("Connection actions"));
      await user.click(screen.getByText("Manage"));
      await user.click(screen.getByText("Duplicate"));

      await waitFor(() => {
        expect(errorMessages().join(" | ")).toMatch(/duplicate/i);
        expect(errorMessages().join(" | ")).toMatch(/keychain unavailable/);
      });
    });

    it("reports a failed connection delete from the card menu", async () => {
      const user = userEvent.setup();
      const commands = await import("../../lib/commands");
      (commands.deleteConnection as any).mockRejectedValue(
        new Error("store is locked"),
      );
      useSettingsStore.setState({
        settings: { ...baseSettings(), confirm_before_delete: false },
      });
      useConnectionStore.setState({ connections: [makeConnection("conn-1")] });
      render(<HomeScreen />);

      await user.click(screen.getByLabelText("Connection actions"));
      await user.click(screen.getByText("Manage"));
      await user.click(screen.getByText("Delete…"));

      await waitFor(() => {
        expect(errorMessages().join(" | ")).toMatch(/store is locked/);
      });
      // The connection is still there: a failed delete never removes it.
      expect(useConnectionStore.getState().connections.map((c) => c.id)).toEqual([
        "conn-1",
      ]);
    });

    it("reports a failed folder delete", async () => {
      const user = userEvent.setup();
      const commands = await import("../../lib/commands");
      (commands.deleteFolder as any).mockRejectedValue(
        new Error("folder is locked"),
      );
      useSettingsStore.setState({
        settings: { ...baseSettings(), confirm_before_delete: false },
      });
      useConnectionStore.setState({ folders: [makeFolder("folder-1")] });
      useUiStore.setState({ activeFolderId: "folder-1" });
      render(<HomeScreen />);

      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      await waitFor(() => {
        expect(errorMessages().join(" | ")).toMatch(/folder is locked/);
      });
      expect(useConnectionStore.getState().folders.map((f) => f.id)).toEqual([
        "folder-1",
      ]);
    });

    it("reports a failed move-to-folder and keeps the selection", async () => {
      const user = userEvent.setup();
      const commands = await import("../../lib/commands");
      (commands.updateConnection as any).mockRejectedValue(
        new Error("move failed"),
      );
      useConnectionStore.setState({
        connections: [makeConnection("conn-1")],
        folders: [makeFolder("folder-1")],
      });
      useUiStore.setState({ selectedItemIds: ["conn-1"], activeFolderId: null });
      render(<HomeScreen />);

      await user.click(screen.getByRole("button", { name: /1 selected/i }));
      await user.click(screen.getByRole("button", { name: /move to folder/i }));
      const folderOptions = await screen.findAllByRole("button", { name: /projects/i });
      await user.click(folderOptions[folderOptions.length - 1]!);
      await user.click(screen.getByRole("button", { name: /^move$/i }));

      await waitFor(() => {
        expect(errorMessages().join(" | ")).toMatch(/move failed/);
      });
      expect(useUiStore.getState().selectedItemIds).toEqual(["conn-1"]);
    });
  });
});

function makeConnection(id: string, name = "Local DB"): Connection {
  return {
    id,
    name,
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