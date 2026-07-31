import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagFilterDropdown } from "./TagFilterDropdown";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import type { Tag } from "../../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const makeTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: "t1", name: "production", color: "#ef4444", created_at: "", ...overrides,
});

beforeEach(() => {
  useConnectionStore.setState({
    connections: [], folders: [], tags: [
      makeTag({ id: "t1", name: "production", color: "#ef4444" }),
      makeTag({ id: "t2", name: "staging", color: "#f59e0b" }),
    ],
    tagOrder: [], loading: false, error: null,
  });
  useUiStore.setState({ activeTagIds: [], activeView: "home" });
});

describe("TagFilterDropdown", () => {
  it("renders a button with Tag icon", () => {
    render(<TagFilterDropdown />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("opens dropdown on button click", () => {
    render(<TagFilterDropdown />);
    fireEvent.click(screen.getByText("Tags"));
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
  });

  it("shows checkboxes for each tag", () => {
    render(<TagFilterDropdown />);
    fireEvent.click(screen.getByText("Tags"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("toggles tag filter when checkbox is clicked", () => {
    render(<TagFilterDropdown />);
    fireEvent.click(screen.getByText("Tags"));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(useUiStore.getState().activeTagIds).toContain("t1");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(useUiStore.getState().activeTagIds).not.toContain("t1");
  });

  it("shows 'Manage tags' link that navigates to settings", () => {
    render(<TagFilterDropdown />);
    fireEvent.click(screen.getByText("Tags"));
    fireEvent.click(screen.getByText("Manage tags"));
    expect(useUiStore.getState().activeView).toBe("settings");
  });

  it("shows empty state when no tags exist", () => {
    useConnectionStore.setState({ tags: [] });
    render(<TagFilterDropdown />);
    fireEvent.click(screen.getByText("Tags"));
    expect(screen.getByText("No tags yet")).toBeInTheDocument();
    expect(screen.getByText("Create in Settings")).toBeInTheDocument();
  });
});