import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBuilder } from "./FilterBuilder";
import type { ColumnInfo } from "../../lib/types";

const cols: ColumnInfo[] = [
  { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
  { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

describe("FilterBuilder", () => {
  it("drops a column chip into the drop zone to create a rule with a type-aware operator", () => {
    const onChange = vi.fn();
    render(<FilterBuilder columns={cols} rules={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("name"));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ column: "name", operator: "contains" }),
    ]);
  });
  it("removing a rule calls onChange without it", () => {
    const onChange = vi.fn();
    const rules = [{ id: "r1", column: "name", operator: "contains" as const, value: "Al" }];
    render(<FilterBuilder columns={cols} rules={rules} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Remove filter name"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});