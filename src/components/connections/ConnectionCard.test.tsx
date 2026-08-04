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
    vi.clearAllMocks();
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
  it("mounts the connection actions kebab menu with action callbacks", () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConnectionCard
        connection={conn}
        tags={tags}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByLabelText("Connection actions")).toBeInTheDocument();
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("prod.example.com:5432")).toBeInTheDocument();
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

  it("no longer renders a favorite star (replaced by kebab menu)", () => {
    render(<ConnectionCard connection={conn} tags={tags} />, { wrapper: Wrapper });
    expect(screen.queryByLabelText(/favorite|unfavorite/i)).not.toBeInTheDocument();
  });

  it("no longer renders a status indicator and still shows name/host/tags", () => {
    render(<ConnectionCard connection={{ ...conn, favorite: true }} tags={tags} />, { wrapper: Wrapper });
    expect(screen.queryByLabelText(/check connection/i)).not.toBeInTheDocument();
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("prod.example.com:5432")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  const manyTags: Tag[] = Array.from({ length: 4 }, (_, i) => ({
    id: `t${i + 1}`, name: `tag${i + 1}`, color: "#3b82f6", created_at: "",
  }));
  const connWith4Tags = { ...conn, tag_ids: manyTags.map((t) => t.id) };

  it("renders a scrollable tag row when there are 4+ tags", () => {
    const { container } = render(
      <ConnectionCard connection={connWith4Tags} tags={manyTags} />,
      { wrapper: Wrapper },
    );
    const row = container.querySelector('[data-testid="tag-row"]');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("overflow-x-auto");
  });

  it("does not scroll the tag row when there are 3 or fewer tags", () => {
    const { container } = render(
      <ConnectionCard connection={conn} tags={tags} />,
      { wrapper: Wrapper },
    );
    const row = container.querySelector('[data-testid="tag-row"]');
    expect(row?.className).not.toContain("overflow-x-auto");
  });
});
