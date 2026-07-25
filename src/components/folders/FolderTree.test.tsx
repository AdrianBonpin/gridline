import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderTree } from "./FolderTree";
import type { Folder } from "../../lib/types";

const folders: Folder[] = [
  { id: "f1", name: "Work", parent_id: null, created_at: "", updated_at: "" },
  { id: "f2", name: "ClientA", parent_id: "f1", created_at: "", updated_at: "" },
];

describe("FolderTree", () => {
  it("renders all folders", () => {
    render(<FolderTree folders={folders} activeFolderId={null} onSelect={() => {}} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("ClientA")).toBeInTheDocument();
  });

  it("renders All Connections option that clears filter", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<FolderTree folders={folders} activeFolderId="f1" onSelect={fn} />);
    await user.click(screen.getByText(/all connections/i));
    expect(fn).toHaveBeenCalledWith(null);
  });

  it("selecting a folder calls onSelect with id", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<FolderTree folders={folders} activeFolderId={null} onSelect={fn} />);
    await user.click(screen.getByText("Work"));
    expect(fn).toHaveBeenCalledWith("f1");
  });
});