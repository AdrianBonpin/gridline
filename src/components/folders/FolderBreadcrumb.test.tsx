import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderBreadcrumb } from "./FolderBreadcrumb";
import type { Folder } from "../../lib/types";

const folders: Folder[] = [
  { id: "f1", name: "Work", parent_id: null, created_at: "", updated_at: "" },
  { id: "f2", name: "Client A", parent_id: "f1", created_at: "", updated_at: "" },
];

describe("FolderBreadcrumb", () => {
  it("shows root when no folder active", () => {
    render(<FolderBreadcrumb folders={folders} activeFolderId={null} onNavigate={() => {}} />);
    expect(screen.getByText("All Connections")).toBeInTheDocument();
  });

  it("shows path to active folder", () => {
    render(<FolderBreadcrumb folders={folders} activeFolderId="f2" onNavigate={() => {}} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Client A")).toBeInTheDocument();
  });

  it("navigates when clicking a breadcrumb item", async () => {
    const fn = vi.fn();
    render(<FolderBreadcrumb folders={folders} activeFolderId="f2" onNavigate={fn} />);
    await userEvent.click(screen.getByText("Work"));
    expect(fn).toHaveBeenCalledWith("f1");
  });

  it("navigates to root", async () => {
    const fn = vi.fn();
    render(<FolderBreadcrumb folders={folders} activeFolderId="f2" onNavigate={fn} />);
    await userEvent.click(screen.getByText("All Connections"));
    expect(fn).toHaveBeenCalledWith(null);
  });
});