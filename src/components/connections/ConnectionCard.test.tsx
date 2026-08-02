import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { ConnectionCard } from "./ConnectionCard";
import type { Connection, Tag } from "../../lib/types";
import { useUiStore } from "../../stores/uiStore";

const tags: Tag[] = [
  { id: "t1", name: "production", color: "#ef4444", created_at: "" },
  { id: "t2", name: "primary", color: "#3b82f6", created_at: "" },
];
const conn: Connection = {
  id: "c1", name: "Prod DB", db_type: "postgresql", host: "prod.example.com",
  port: 5432, username: null, folder_id: null, keychain_ref: null,
  tag_ids: ["t1", "t2"], favorite: false, created_at: "", updated_at: "",
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <DndContext>{children}</DndContext>;
}

describe("ConnectionCard", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedItemIds: [] });
  });

  it("renders name and host", () => {
    render(<ConnectionCard connection={conn} tags={tags} />, { wrapper: Wrapper });
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("prod.example.com:5432")).toBeInTheDocument();
  });
  it("renders db type label", () => {
    render(<ConnectionCard connection={conn} tags={tags} />, { wrapper: Wrapper });
    expect(screen.getByText(/postgresql/i)).toBeInTheDocument();
  });
  it("renders tag badges", () => {
    render(<ConnectionCard connection={conn} tags={tags} />, { wrapper: Wrapper });
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("primary")).toBeInTheDocument();
  });
  it("renders drag handle", () => {
    render(<ConnectionCard connection={conn} tags={tags} />, { wrapper: Wrapper });
    expect(screen.getByLabelText("Drag to move connection")).toBeInTheDocument();
  });
  it("omits port for sqlite", () => {
    const sqlite = { ...conn, db_type: "sqlite" as const, host: "/data/x.db", port: null };
    render(<ConnectionCard connection={sqlite} tags={tags} />, { wrapper: Wrapper });
    expect(screen.getByText("/data/x.db")).toBeInTheDocument();
    expect(screen.queryByText(/:5432/)).not.toBeInTheDocument();
  });
  it("fires onTagToggle when a tag badge is clicked", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ConnectionCard connection={conn} tags={tags} onTagToggle={fn} />, { wrapper: Wrapper });
    await user.click(screen.getByText("production"));
    expect(fn).toHaveBeenCalledWith("t1");
  });
  it("opens DbViewer on single click when nothing is selected", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<ConnectionCard connection={conn} tags={tags} onOpenDbViewer={fn} />, { wrapper: Wrapper });
    await user.click(screen.getByText("Prod DB"));
    expect(fn).toHaveBeenCalledWith(conn.id);
  });

  it("toggles selection on single click when something is already selected", async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selectedItemIds: ["other-id"] });
    const fn = vi.fn();
    render(<ConnectionCard connection={conn} tags={tags} onOpenDbViewer={fn} />, { wrapper: Wrapper });
    await user.click(screen.getByText("Prod DB"));
    // Should NOT open — should toggle selection instead
    expect(fn).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedItemIds).toContain(conn.id);
  });
});