import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { useConnectionStore } from "./stores/connectionStore";
import { useSettingsStore } from "./stores/settingsStore";

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
  }),
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
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders Gridline branding on home view", async () => {
    render(<App />);
    expect(await screen.findByText("Gridline")).toBeInTheDocument();
  });

  it("shows empty state when no connections", async () => {
    render(<App />);
    expect(await screen.findByText(/no connections/i)).toBeInTheDocument();
  });

  it("loads data on mount", async () => {
    render(<App />);
    await screen.findByText("Gridline");
    expect(useConnectionStore.getState().loading).toBe(false);
  });
});