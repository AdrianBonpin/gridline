import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowDetailDrawer } from "./RowDetailDrawer";
import type { ColumnInfo } from "../../lib/types";

const cols: ColumnInfo[] = [
  { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
  { name: "data", data_type: "jsonb", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

describe("RowDetailDrawer", () => {
  it("renders every column value including hidden ones", () => {
    render(<RowDetailDrawer columns={cols} row={[1, { a: 2 }]} onClose={vi.fn()} onCopy={vi.fn()} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    expect(screen.getByText(/"a": 2/)).toBeInTheDocument();
  });
  it("copy button calls onCopy with the raw value", () => {
    const onCopy = vi.fn();
    render(<RowDetailDrawer columns={cols} row={[1, { a: 2 }]} onClose={vi.fn()} onCopy={onCopy} />);
    const copyBtns = screen.getAllByRole("button", { name: /copy/i });
    fireEvent.click(copyBtns[1]); // copy the 'data' value
    expect(onCopy).toHaveBeenCalledWith(JSON.stringify({ a: 2 }, null, 2));
  });
});