import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultSetPanels } from "./ResultSetPanels";
import type { MultiQueryResult } from "../../lib/types";

const multi: MultiQueryResult = {
  result_sets: [
    { columns: [{ name: "a", data_type: "int", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }], rows: [[1], [2]], total_rows: 2, page: 1, page_size: 50 },
    { columns: [{ name: "b", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false }], rows: [], total_rows: 0, page: 1, page_size: 50 },
  ],
  notices: [
    { statement_index: 1, kind: "dml", text: "UPDATE 3", affected: 3 },
    { statement_index: 3, kind: "error", text: "relation \"nope\" does not exist", affected: null },
  ],
  execution_time_ms: 12,
};

describe("ResultSetPanels", () => {
  it("renders one panel header per result set with row counts", () => {
    render(<ResultSetPanels multi={multi} renderGrid={vi.fn()} />);
    expect(screen.getByText(/Result 1/)).toBeTruthy();
    expect(screen.getByText(/Result 2/)).toBeTruthy();
    expect(screen.getByText(/2 rows/)).toBeTruthy();
  });

  it("renders notice cards for DML and errors", () => {
    render(<ResultSetPanels multi={multi} renderGrid={vi.fn()} />);
    expect(screen.getByText(/UPDATE 3/)).toBeTruthy();
    expect(screen.getByText(/3 rows affected/)).toBeTruthy();
    expect(screen.getByText(/relation "nope" does not exist/)).toBeTruthy();
  });

  it("delegates each set to the grid renderer with its index", () => {
    const renderGrid = vi.fn(() => <div />);
    render(<ResultSetPanels multi={multi} renderGrid={renderGrid} />);
    expect(renderGrid).toHaveBeenCalledTimes(2);
  });
});
