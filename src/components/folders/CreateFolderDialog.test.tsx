import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateFolderDialog } from "./CreateFolderDialog";

const folders = [
  { id: "f1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  { id: "f2", name: "Personal", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
];

describe("CreateFolderDialog", () => {
  it("calls onCreate with name, parent, and tags", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={folders} tags={[]} onCreate={fn} onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/folder name/i), "New Folder");
    await user.click(screen.getByText(/create/i));
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ name: "New Folder", parent_id: null, tag_ids: [] }));
  });

  it("auto-sets parent to current folder", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={folders} tags={[]} currentFolderId="f1" onCreate={fn} onClose={() => {}} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/folder name/i), "Sub Folder");
    await user.click(screen.getByText(/create/i));
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ name: "Sub Folder", parent_id: "f1", tag_ids: [] }));
  });

  it("does not call onCreate when name empty", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={folders} tags={[]} onCreate={fn} onClose={() => {}} />);
    await user.click(screen.getByText(/create/i));
    expect(fn).not.toHaveBeenCalled();
  });
});