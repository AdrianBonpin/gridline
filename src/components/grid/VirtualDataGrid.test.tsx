import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});