import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellEditor } from "./CellEditor";

describe("CellEditor", () => {
  it("renders the initial value and commits on Enter", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<CellEditor initialValue="Alice" dataType="text" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Alice");
    fireEvent.change(input, { target: { value: "Alicia" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Alicia");
  });
  it("commits null when the setNull flag is toggled", () => {
    const onCommit = vi.fn();
    render(<CellEditor initialValue="Alice" dataType="text" onCommit={onCommit} onCancel={vi.fn()} nullable />);
    const nullCheckbox = screen.getByLabelText(/set null/i);
    fireEvent.click(nullCheckbox);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(null);
  });
  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<CellEditor initialValue="Alice" dataType="text" onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
  it("uses textarea for large/JSON columns", () => {
    render(<CellEditor initialValue="{}" dataType="jsonb" onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });
});