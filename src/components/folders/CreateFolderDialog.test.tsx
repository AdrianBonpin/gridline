import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateFolderDialog } from "./CreateFolderDialog";

describe("CreateFolderDialog", () => {
  it("calls onCreate with name and parent", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={[]} onCreate={fn} onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/folder name/i), "New Folder");
    await user.click(screen.getByText(/create/i));
    expect(fn).toHaveBeenCalledWith({ name: "New Folder", parent_id: null });
  });

  it("does not call onCreate when name empty", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<CreateFolderDialog open parentOptions={[]} onCreate={fn} onClose={() => {}} />);
    await user.click(screen.getByText(/create/i));
    expect(fn).not.toHaveBeenCalled();
  });
});