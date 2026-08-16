import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchableTagPicker } from "./SearchableTagPicker";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("SearchableTagPicker", () => {
  it("shows 'No tags yet' when tags array is empty", () => {
    render(<SearchableTagPicker tags={[]} selectedTagIds={[]} onToggle={() => {}} />);
    expect(screen.getByText("No tags yet.")).toBeInTheDocument();
  });

  it("shows 'Create first tag' button when empty", () => {
    render(<SearchableTagPicker tags={[]} selectedTagIds={[]} onToggle={() => {}} />);
    expect(screen.getByText("Create first tag")).toBeInTheDocument();
  });

  it("shows inline creation form when 'Create first tag' is clicked", () => {
    render(<SearchableTagPicker tags={[]} selectedTagIds={[]} onToggle={() => {}} />);
    fireEvent.click(screen.getByText("Create first tag"));
    expect(screen.getByPlaceholderText("Tag name")).toBeInTheDocument();
  });
});