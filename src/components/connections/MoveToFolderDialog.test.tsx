import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import type { Folder } from "../../lib/types";

const makeFolder = (id: string, name: string): Folder => ({
  id,
  name,
  parent_id: null,
  tag_ids: [],
  created_at: "",
  updated_at: "",
});

describe("MoveToFolderDialog", () => {
  it("lists folders + Root and calls onConfirm with the chosen id", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveToFolderDialog
        open
        folders={[makeFolder("f1", "Prod")]}
        selectedCount={3}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Prod"));
    fireEvent.click(screen.getByRole("button", { name: /move/i }));
    expect(onConfirm).toHaveBeenCalledWith("f1");
  });

  it("Root option passes null", () => {
    const onConfirm = vi.fn();
    render(
      <MoveToFolderDialog
        open
        folders={[]}
        selectedCount={1}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/root/i));
    fireEvent.click(screen.getByRole("button", { name: /move/i }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("Cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <MoveToFolderDialog
        open
        folders={[]}
        selectedCount={2}
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});