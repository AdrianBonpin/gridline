import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualDataGrid } from "./VirtualDataGrid";
import type { ColumnInfo } from "../../lib/types";

const mockColumns: ColumnInfo[] = [
  { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: false, is_generated: false },
  { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

const mockRows: unknown[][] = [
  [1, "Alice"],
  [2, "Bob"],
];

/**
 * Override `useVirtualizer` so virtual items are always rendered
 * regardless of container dimensions in jsdom.
 */
const { mockGetVirtualItems, mockGetTotalSize, mockMeasureElement } = vi.hoisted(() => ({
  mockGetVirtualItems: vi.fn(),
  mockGetTotalSize: vi.fn(),
  mockMeasureElement: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: mockGetVirtualItems,
    getTotalSize: mockGetTotalSize,
    measureElement: mockMeasureElement,
  }),
}));

describe("VirtualDataGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses a cell on click and opens the editor on Enter for an editable cell", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);
    const nameCell = screen.getAllByText("Alice")[0];
    fireEvent.click(nameCell);
    fireEvent.keyDown(nameCell, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Ctrl+C copies the focused cell value to the clipboard", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);
    const cell = screen.getAllByText("Alice")[0];
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "c", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith("Alice");
  });

  it("does not open an editor for a PK cell", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);
    const idCell = screen.getByText("1");
    fireEvent.click(idCell);
    fireEvent.keyDown(idCell, { key: "Enter" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders all rows when row count is small", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({
        key: i,
        index: i,
        start: i * 36,
        size: 36,
      })),
    );

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders column headers with type badges", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({
        key: i,
        index: i,
        start: i * 36,
        size: 36,
      })),
    );

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("int")).toBeInTheDocument();
  });

  it("renders NULL values in italic", () => {
    const rows: unknown[][] = [[null, "HasNull"]];
    mockGetTotalSize.mockReturnValue(rows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      rows.map((_, i) => ({
        key: i,
        index: i,
        start: i * 36,
        size: 36,
      })),
    );

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={rows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("NULL").className).toContain("italic");
  });

  it("renders empty state when no rows", () => {
    mockGetTotalSize.mockReturnValue(0);
    mockGetVirtualItems.mockReturnValue([]);

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={[]}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  it("calls onToggleRow when checkbox clicked", () => {
    let toggled = -1;
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));

    render(<VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={(i) => { toggled = i; }} onToggleAll={() => {}}
      dbType="postgresql" tabType="table" />);

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // first row checkbox
    expect(toggled).toBe(0);
  });

  it("renders FK cells with clickable underline styling", () => {
    const fkCols: ColumnInfo[] = [
      { name: "user_id", data_type: "integer", is_nullable: false, is_pk: false, is_fk: true, fk_ref: ["users", "id"], default_value: null, editable: true, is_generated: false },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" table="orders" rows={[[42]]} columns={fkCols}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}}
      dbType="postgresql" tabType="table" />);

    const fkCell = screen.getByText("42");
    expect(fkCell.className).toContain("cursor-pointer");
    expect(fkCell.className).toContain("underline");
  });

  it("renders JSON cells with preview label", () => {
    const jsonCols: ColumnInfo[] = [
      { name: "metadata", data_type: "jsonb", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={[[JSON.stringify({ key: "val", count: 3 })]]} columns={jsonCols}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}}
      dbType="postgresql" tabType="table" />);

    expect(screen.getByText(/2 keys/)).toBeInTheDocument();
  });

  it("keeps header width to content and borders the last column", () => {
    mockGetTotalSize.mockReturnValue(0);
    mockGetVirtualItems.mockReturnValue([]);

    const { container } = render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={[]}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    // Header must span exactly the total column width (40 checkbox + 2 × 200),
    // not stretch across the empty area to the right of the last column.
    const header = container.querySelector(".sticky > div");
    expect(header).not.toBeNull();
    expect((header as HTMLElement).style.width).toBe("440px");
    expect((header as HTMLElement).style.minWidth).toBe("");

    // The last column header keeps a right border, matching body cells.
    const headerCells = container.querySelectorAll(".sticky > div:first-child > div");
    const lastCol = headerCells[headerCells.length - 1];
    expect(lastCol.className).toContain("border-r");
    expect(lastCol.className).not.toContain("border-r-0");
  });

  it("hides the select-all checkbox and header when no columns are present", () => {
    mockGetTotalSize.mockReturnValue(0);
    mockGetVirtualItems.mockReturnValue([]);

    const { container } = render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={[]}
        columns={[]}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    // No table open → no select-all checkbox, no header bar, no empty-state message.
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
    expect(container.querySelector(".sticky")).toBeNull();
    expect(screen.queryByText(/no rows/i)).not.toBeInTheDocument();
  });

  it("has resize handles on column headers", () => {
    mockGetTotalSize.mockReturnValue(0);
    mockGetVirtualItems.mockReturnValue([]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={[]} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}}
      dbType="postgresql" tabType="table" />);

    const handles = document.querySelectorAll('[class*="cursor-col-resize"]');
    expect(handles.length).toBe(2); // one per visible column
  });

  it("renders 10000 rows without crashing (virtualization)", () => {
    const bigRows: unknown[][] = Array.from({ length: 10000 }, (_, i) => [i, `Name${i}`]);
    mockGetTotalSize.mockReturnValue(10000 * 36);
    mockGetVirtualItems.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({ key: i, index: i, start: i * 36, size: 36 }))
    );
    render(
      <VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={bigRows} columns={mockColumns}
        hiddenColumns={new Set()} selectedRows={new Set()}
        onToggleRow={() => {}} onToggleAll={() => {}}
        dbType="postgresql" tabType="table" />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeLessThan(50); // virtualized: only visible rows + select all
  });

  it("shows select-all as checked when all rows selected", () => {
    const allSelected = new Set([0, 1]);
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 }))
    );
    render(
      <VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={mockRows} columns={mockColumns}
        hiddenColumns={new Set()} selectedRows={allSelected}
        onToggleRow={() => {}} onToggleAll={() => {}}
        dbType="postgresql" tabType="table" />,
    );
    const selectAll = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(selectAll.checked).toBe(true);
  });

  it("hides columns in hiddenColumns set", () => {
    const hidden = new Set(["name"]);
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 }))
    );
    render(
      <VirtualDataGrid connectionId="conn-1" schema="public" table="users" rows={mockRows} columns={mockColumns}
        hiddenColumns={hidden} selectedRows={new Set()}
        onToggleRow={() => {}} onToggleAll={() => {}}
        dbType="postgresql" tabType="table" />,
    );
    expect(screen.queryByText("name")).not.toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
  });

  it("renders a pending-edit dot on the pending cell", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })),
    );

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
        pendingCell={{ row: 0, col: 1 }}
      />,
    );

    expect(screen.getByTestId("pending-edit-dot")).toBeInTheDocument();
  });

  it("does not render a pending-edit dot without pendingCell", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(
      mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })),
    );

    render(
      <VirtualDataGrid
        connectionId="conn-1"
        schema="public"
        table="users"
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
        dbType="postgresql"
        tabType="table"
      />,
    );

    expect(screen.queryByTestId("pending-edit-dot")).toBeNull();
  });

  // ── GRID-A: context menu + editing behavior ─────────────────────────

  it("opens the context menu on right-click and View Row calls onOpenRowDetail", () => {
    let opened = -1;
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" onOpenRowDetail={(i) => { opened = i; }} />);

    fireEvent.contextMenu(screen.getByText("Alice"));
    expect(screen.getByText("View Row")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View Row"));
    expect(opened).toBe(0);
  });

  it("context menu Select Row calls onToggleRow with the row index", () => {
    let toggled = -1;
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={(i) => { toggled = i; }} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);

    fireEvent.contextMenu(screen.getByText("Bob"));
    fireEvent.click(screen.getByText("Select Row"));
    expect(toggled).toBe(1);
  });

  it("closes the context menu when clicking the backdrop", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);

    fireEvent.contextMenu(screen.getByText("Alice"));
    expect(screen.getByText("Copy")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ctx-backdrop"));
    expect(screen.queryByText("Copy")).toBeNull();
  });

  it("cancels in-cell editing with Escape even when the editor input is unfocused", () => {
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));
    render(<VirtualDataGrid connectionId="c1" schema="public" table="users" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()} onToggleRow={vi.fn()} onToggleAll={vi.fn()}
      dbType="postgresql" tabType="table" />);

    const cell = screen.getAllByText("Alice")[0];
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Editor input is not the event target — the document-level listener must cancel.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the FK preview popover from the context menu", () => {
    const fkCols: ColumnInfo[] = [
      { name: "user_id", data_type: "integer", is_nullable: false, is_pk: false, is_fk: true, fk_ref: ["users", "id"], default_value: null, editable: true, is_generated: false },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" table="orders" rows={[[42]]} columns={fkCols}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}}
      dbType="postgresql" tabType="table" />);

    fireEvent.contextMenu(screen.getByText("42"));
    fireEvent.click(screen.getByText("Open FK reference"));

    // Popover header renders the referenced table synchronously.
    expect(screen.getByText("public.users")).toBeInTheDocument();
  });

  // ── GRID-C: enum + FK options fed into CellEditor ────────────────

  it("renders an enum <select> with the column's labels when editing", () => {
    const enumCols: ColumnInfo[] = [
      { name: "status", data_type: "user_role", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(
      <VirtualDataGrid
        connectionId="c1"
        schema="public"
        table="users"
        rows={[["active"]]}
        columns={enumCols}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={vi.fn()}
        onToggleAll={vi.fn()}
        dbType="postgresql"
        tabType="table"
        enumValues={{ status: ["active", "inactive"] }}
      />,
    );

    const cell = screen.getByText("active");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "active" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "inactive" })).toBeInTheDocument();
  });

  it("renders a searchable FK dropdown with the referenced rows when editing", () => {
    const fkCols: ColumnInfo[] = [
      { name: "user_id", data_type: "integer", is_nullable: false, is_pk: false, is_fk: true, fk_ref: ["users", "id"], default_value: null, editable: true, is_generated: false },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(
      <VirtualDataGrid
        connectionId="c1"
        schema="public"
        table="orders"
        rows={[[42]]}
        columns={fkCols}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={vi.fn()}
        onToggleAll={vi.fn()}
        dbType="postgresql"
        tabType="table"
        fkOptions={{
          user_id: [
            { value: "1", label: "1 — Alice" },
            { value: "2", label: "2 — Bob" },
          ],
        }}
      />,
    );

    const cell = screen.getByText("42");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });

    expect(screen.getByLabelText(/search foreign key/i)).toBeInTheDocument();
    expect(screen.getByText("1 — Alice")).toBeInTheDocument();
    expect(screen.getByText("2 — Bob")).toBeInTheDocument();
  });
});