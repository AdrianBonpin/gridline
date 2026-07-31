import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionGrid } from "./ConnectionGrid";
import { useUiStore } from "../../stores/uiStore";
import type { Connection, Folder, Tag } from "../../lib/types";

const makeConn = (id: string, folder_id: string | null = null): Connection => ({
  id, name: `Conn ${id}`, db_type: "postgresql", host: "h", port: 5432,
  username: null, folder_id, keychain_ref: null, tag_ids: [],
  created_at: "", updated_at: "",
});

const folders: Folder[] = [
  { id: "f1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  { id: "f2", name: "Personal", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  { id: "f3", name: "Client A", parent_id: "f1", tag_ids: [], created_at: "", updated_at: "" },
];

describe("ConnectionGrid", () => {
  beforeEach(() => {
    useUiStore.setState({ activeTagIds: [] });
  });

  it("renders empty state when no connections and no folders", () => {
    render(<ConnectionGrid connections={[]} tags={[]} />);
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });

  it("renders cards for each connection", () => {
    const conns = [makeConn("1"), makeConn("2")];
    render(<ConnectionGrid connections={conns} tags={[]} />);
    expect(screen.getByText("Conn 1")).toBeInTheDocument();
    expect(screen.getByText("Conn 2")).toBeInTheDocument();
  });

  it("renders no-results state when filtered empty", () => {
    render(<ConnectionGrid connections={[]} tags={[]} hasSearch />);
    expect(screen.getByText(/no connections match/i)).toBeInTheDocument();
  });

  it("renders only top-level folders at root", () => {
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.queryByText("Client A")).not.toBeInTheDocument();
  });

  it("renders only children of active folder", () => {
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} activeFolderId="f1" />);
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  });

  it("calls onFolderSelect with folder id on click", async () => {
    const fn = vi.fn();
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} onFolderSelect={fn} />);
    await userEvent.click(screen.getByText("Work"));
    expect(fn).toHaveBeenCalledWith("f1");
  });

  it("breadcrumb navigates to root", async () => {
    const fn = vi.fn();
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} activeFolderId="f1" onFolderSelect={fn} />);
    await userEvent.click(screen.getByText(/all connections/i));
    expect(fn).toHaveBeenCalledWith(null);
  });

  it("shows folder cards", () => {
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("hides folders that match no tags and contain no matching connections", () => {
    useUiStore.setState({ activeTagIds: ["t1"] });
    const taggedFolders: Folder[] = [
      { id: "f1", name: "Tagged Folder", parent_id: null, tag_ids: ["t1"], created_at: "", updated_at: "" },
      { id: "f2", name: "Untagged Folder", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
    ];
    const tags: Tag[] = [{ id: "t1", name: "prod", color: "#f00", created_at: "" }];
    render(<ConnectionGrid connections={[]} tags={tags} folders={taggedFolders} />);
    expect(screen.getByText("Tagged Folder")).toBeInTheDocument();
    expect(screen.queryByText("Untagged Folder")).not.toBeInTheDocument();
  });

  it("shows folder when it contains a matching connection even if untagged", () => {
    useUiStore.setState({ activeTagIds: ["t1"] });
    const foldersWithConn: Folder[] = [
      { id: "f1", name: "Parent", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
    ];
    const conns = [makeConn("c1", "f1")];
    conns[0] = { ...conns[0], tag_ids: ["t1"] };
    const tags: Tag[] = [{ id: "t1", name: "prod", color: "#f00", created_at: "" }];
    render(<ConnectionGrid connections={conns} tags={tags} folders={foldersWithConn} />);
    expect(screen.getByText("Parent")).toBeInTheDocument();
  });

  it("shows all folders when no tag filter is active", () => {
    useUiStore.setState({ activeTagIds: [] });
    render(<ConnectionGrid connections={[]} tags={[]} folders={folders} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });
});