import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/commands", () => ({
  getConnections: vi.fn().mockResolvedValue([]),
  getFolders: vi.fn().mockResolvedValue([]),
  getTags: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: [], folders: [], tags: [], loading: false, error: null });
    useUiStore.setState({ searchQuery: "", activeFolderId: null, activeTagIds: [], activeDbTypes: [], activeView: "home" });
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
});