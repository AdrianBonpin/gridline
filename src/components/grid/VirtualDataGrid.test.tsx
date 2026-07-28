import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualDataGrid } from "./VirtualDataGrid";
import type { ColumnInfo } from "../../lib/types";

const mockColumns: ColumnInfo[] = [
  { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null },
  { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null },
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
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
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
        rows={mockRows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
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
        rows={rows}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
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
        rows={[]}
        columns={mockColumns}
        hiddenColumns={new Set()}
        selectedRows={new Set()}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
      />,
    );

    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  it("calls onToggleRow when checkbox clicked", () => {
    let toggled = -1;
    mockGetTotalSize.mockReturnValue(mockRows.length * 36);
    mockGetVirtualItems.mockReturnValue(mockRows.map((_, i) => ({ key: i, index: i, start: i * 36, size: 36 })));

    render(<VirtualDataGrid connectionId="conn-1" schema="public" rows={mockRows} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={(i) => { toggled = i; }} onToggleAll={() => {}} />);

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // first row checkbox
    expect(toggled).toBe(0);
  });

  it("renders FK cells with clickable underline styling", () => {
    const fkCols: ColumnInfo[] = [
      { name: "user_id", data_type: "integer", is_nullable: false, is_pk: false, is_fk: true, fk_ref: ["users", "id"], default_value: null },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" rows={[[42]]} columns={fkCols}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}} />);

    const fkCell = screen.getByText("42");
    expect(fkCell.className).toContain("cursor-pointer");
    expect(fkCell.className).toContain("underline");
  });

  it("renders JSON cells with preview label", () => {
    const jsonCols: ColumnInfo[] = [
      { name: "metadata", data_type: "jsonb", is_nullable: false, is_pk: false, is_fk: false, fk_ref: null, default_value: null },
    ];
    mockGetTotalSize.mockReturnValue(36);
    mockGetVirtualItems.mockReturnValue([{ key: 0, index: 0, start: 0, size: 36 }]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" rows={[[JSON.stringify({ key: "val", count: 3 })]]} columns={jsonCols}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}} />);

    expect(screen.getByText(/2 keys/)).toBeInTheDocument();
  });

  it("has resize handles on column headers", () => {
    mockGetTotalSize.mockReturnValue(0);
    mockGetVirtualItems.mockReturnValue([]);

    render(<VirtualDataGrid connectionId="conn-1" schema="public" rows={[]} columns={mockColumns}
      hiddenColumns={new Set()} selectedRows={new Set()}
      onToggleRow={() => {}} onToggleAll={() => {}} />);

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
      <VirtualDataGrid connectionId="conn-1" schema="public" rows={bigRows} columns={mockColumns}
        hiddenColumns={new Set()} selectedRows={new Set()}
        onToggleRow={() => {}} onToggleAll={() => {}} />,
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
      <VirtualDataGrid connectionId="conn-1" schema="public" rows={mockRows} columns={mockColumns}
        hiddenColumns={new Set()} selectedRows={allSelected}
        onToggleRow={() => {}} onToggleAll={() => {}} />,
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
      <VirtualDataGrid connectionId="conn-1" schema="public" rows={mockRows} columns={mockColumns}
        hiddenColumns={hidden} selectedRows={new Set()}
        onToggleRow={() => {}} onToggleAll={() => {}} />,
    );
    expect(screen.queryByText("name")).not.toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
  });
});