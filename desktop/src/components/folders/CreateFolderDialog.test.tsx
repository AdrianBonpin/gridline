import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CreateFolderDialog } from "./CreateFolderDialog";

const folders = [
  { id: "f1", name: "Work", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
  { id: "f2", name: "Personal", parent_id: null, tag_ids: [], created_at: "", updated_at: "" },
];

const sampleTags = [
  { id: "t1", name: "Production", color: "#ef4444", created_at: "", updated_at: "" },
  { id: "t2", name: "Staging", color: "#3b82f6", created_at: "", updated_at: "" },
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

  it("removes content from DOM after exit animation", async () => {
    const { rerender } = render(
      <CreateFolderDialog open parentOptions={folders} tags={[]} onCreate={vi.fn()} onClose={() => {}} />,
    );
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    rerender(
      <CreateFolderDialog open={false} parentOptions={folders} tags={[]} onCreate={vi.fn()} onClose={() => {}} />,
    );
    await waitForElementToBeRemoved(() => screen.queryByText("New Folder"));
    expect(screen.queryByText("New Folder")).not.toBeInTheDocument();
  });

  it("calls onCreate when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateFolderDialog open parentOptions={folders} tags={[]} onCreate={vi.fn()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows tags and includes selected tags in onCreate", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={folders} tags={sampleTags} onCreate={fn} onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();

    await user.click(screen.getByText("Production"));
    await user.type(screen.getByPlaceholderText(/folder name/i), "Tagged Folder");
    await user.click(screen.getByText(/create/i));

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Tagged Folder",
        parent_id: null,
        tag_ids: ["t1"],
      }),
    );
  });
});