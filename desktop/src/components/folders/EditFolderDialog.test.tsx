import { describe, it, expect, vi } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { EditFolderDialog } from "./EditFolderDialog";

const folder = {
  id: "f1",
  name: "Work",
  parent_id: null,
  tag_ids: ["t1"],
  created_at: "",
  updated_at: "",
};

const tags = [{ id: "t1", name: "red", color: "#ff0000", created_at: "", updated_at: "" }];

describe("EditFolderDialog", () => {
  it("calls onSave with updated name and tags", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<EditFolderDialog open folder={folder} tags={tags} onSave={fn} onClose={() => {}} />);
    await user.clear(screen.getByPlaceholderText(/folder name/i));
    await user.type(screen.getByPlaceholderText(/folder name/i), "Work Updated");
    await user.click(screen.getByText(/save/i));
    expect(fn).toHaveBeenCalledWith("f1", expect.objectContaining({ name: "Work Updated", tag_ids: ["t1"] }));
  });

  it("does not call onSave when name is empty", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<EditFolderDialog open folder={folder} tags={tags} onSave={fn} onClose={() => {}} />);
    await user.clear(screen.getByPlaceholderText(/folder name/i));
    await user.click(screen.getByText(/save/i));
    expect(fn).not.toHaveBeenCalled();
  });

  it("removes content from DOM after exit animation", async () => {
    const { rerender } = render(
      <EditFolderDialog open folder={folder} tags={tags} onSave={vi.fn()} onClose={() => {}} />,
    );
    expect(screen.getByText("Edit Folder")).toBeInTheDocument();
    rerender(<EditFolderDialog open={false} folder={folder} tags={tags} onSave={vi.fn()} onClose={() => {}} />);
    await waitForElementToBeRemoved(() => screen.queryByText("Edit Folder"));
    expect(screen.queryByText("Edit Folder")).not.toBeInTheDocument();
  });

  it("renders nothing when folder is null", () => {
    render(<EditFolderDialog open folder={null} tags={tags} onSave={vi.fn()} onClose={() => {}} />);
    expect(screen.queryByText("Edit Folder")).not.toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EditFolderDialog open folder={folder} tags={tags} onSave={vi.fn()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});