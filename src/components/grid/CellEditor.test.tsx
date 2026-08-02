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
  it("renders a combobox with enum values and commits on change", () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        initialValue="active"
        dataType="text"
        enumValues={["active", "inactive", "pending"]}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["active", "inactive", "pending"]));
    fireEvent.change(select, { target: { value: "pending" } });
    expect(onCommit).toHaveBeenCalledWith("pending");
  });
  it("commits null via Set NULL in enum mode", () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        initialValue="active"
        dataType="text"
        enumValues={["active", "inactive", "pending"]}
        onCommit={onCommit}
        onCancel={vi.fn()}
        nullable
      />
    );
    fireEvent.click(screen.getByLabelText(/set null/i));
    expect(onCommit).toHaveBeenCalledWith(null);
  });
  it("filters FK options by query and commits the clicked value", () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        initialValue="1"
        dataType="integer"
        fkOptions={[
          { value: "1", label: "1 — Alice" },
          { value: "2", label: "2 — Bob" },
        ]}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    const search = screen.getByLabelText(/search foreign key/i);
    fireEvent.change(search, { target: { value: "bo" } });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("2 — Bob");
    fireEvent.click(buttons[0]);
    expect(onCommit).toHaveBeenCalledWith("2");
  });
  it("shows all FK options when the query is empty", () => {
    render(
      <CellEditor
        initialValue="1"
        dataType="integer"
        fkOptions={[
          { value: "1", label: "1 — Alice" },
          { value: "2", label: "2 — Bob" },
        ]}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("renders text columns as a single-line scrolling textarea", () => {
    render(<CellEditor initialValue="long text" dataType="text" onCommit={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.className).toContain("h-6");
  });

  it("renders the FK placeholder and a No matches empty state", () => {
    const onCommit = vi.fn();
    render(<CellEditor initialValue="" dataType="integer"
      fkOptions={[{ value: "1", label: "1 — Alice" }]} fkPlaceholder="Search users…"
      onCommit={onCommit} onCancel={vi.fn()} />);
    const search = screen.getByLabelText(/search foreign key/i);
    expect(search).toHaveAttribute("placeholder", "Search users…");
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("renders the FK option list as a fixed-position overlay so it is never clipped", () => {
    const onCommit = vi.fn();
    render(<CellEditor initialValue="" dataType="integer"
      fkOptions={[{ value: "1", label: "1 — Alice" }, { value: "2", label: "2 — Bob" }]}
      onCommit={onCommit} onCancel={vi.fn()} />);
    const list = screen.getByTestId("fk-options");
    expect(list.style.position).toBe("fixed");
    expect(list).toHaveTextContent("1 — Alice");
    expect(list).toHaveTextContent("2 — Bob");
  });
});