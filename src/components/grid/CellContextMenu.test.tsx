import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellContextMenu } from "./CellContextMenu";

describe("CellContextMenu", () => {
  const base = {
    anchorRect: { top: 0, left: 0, width: 10, height: 10 } as DOMRect,
    onClose: vi.fn(),
    onCopy: vi.fn(), onCopyJson: vi.fn(), onEdit: vi.fn(), onSetNull: vi.fn(), onOpenFk: vi.fn(),
  };
  it("renders Copy, Edit, Set NULL for an editable scalar cell", () => {
    render(<CellContextMenu {...base} editable isJson={false} isFk={false} nullable />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Set NULL")).toBeInTheDocument();
  });
  it("renders Copy JSON for a json cell and hides Edit when not editable", () => {
    render(<CellContextMenu {...base} editable={false} isJson isFk={false} nullable={false} />);
    expect(screen.getByText("Copy JSON")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).toBeNull();
  });
  it("renders Open FK reference for an FK cell", () => {
    render(<CellContextMenu {...base} editable={false} isJson={false} isFk nullable={false} />);
    expect(screen.getByText("Open FK reference")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open FK reference"));
    expect(base.onOpenFk).toHaveBeenCalled();
  });
});