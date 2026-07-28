import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { SchemaVisualizerNode } from "./SchemaVisualizerNode";
import type { TableNode } from "../../lib/types";

// React Flow custom nodes must be wrapped in ReactFlowProvider
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
);

const sampleTable: TableNode = {
  name: "users",
  schema: "public",
  table_type: "TABLE",
  columns: [
    { name: "id", data_type: "integer", is_pk: true, is_fk: false, is_unique: true, fk_ref: null },
    { name: "name", data_type: "text", is_pk: false, is_fk: false, is_unique: false, fk_ref: null },
    { name: "email", data_type: "text", is_pk: false, is_fk: false, is_unique: true, fk_ref: null },
  ],
};

describe("SchemaVisualizerNode", () => {
  it("renders table name in header", () => {
    render(
      <SchemaVisualizerNode
        id="node-1"
        data={{ table: sampleTable, isExternal: false, onExpandExternal: undefined }}
        selected={false}
      />,
      { wrapper },
    );
    expect(screen.getByText("public.users")).toBeInTheDocument();
  });

  it("renders all columns by default", () => {
    render(
      <SchemaVisualizerNode
        id="node-1"
        data={{ table: sampleTable, isExternal: false, onExpandExternal: undefined }}
        selected={false}
      />,
      { wrapper },
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("collapses non-key columns on chevron click", () => {
    render(
      <SchemaVisualizerNode
        id="node-1"
        data={{ table: sampleTable, isExternal: false, onExpandExternal: undefined }}
        selected={false}
      />,
      { wrapper },
    );
    // Find collapse button
    const collapseBtn = screen.getByRole("button", { name: /collapse/i });
    fireEvent.click(collapseBtn);

    // After collapse, non-key columns should be hidden
    // name is non-key, should not be visible
    expect(screen.queryByText(/^name$/)).not.toBeInTheDocument();
    // id and email (PK/UNIQUE) should still be visible
    expect(screen.getByText(/^id$/)).toBeInTheDocument();
    expect(screen.getByText(/^email$/)).toBeInTheDocument();
  });

  it("renders in dimmed style when isExternal is true", () => {
    const { container } = render(
      <SchemaVisualizerNode
        id="node-ext"
        data={{ table: sampleTable, isExternal: true, onExpandExternal: vi.fn() }}
        selected={false}
      />,
      { wrapper },
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("opacity-50");
  });

  it("calls onExpandExternal when external node is clicked", () => {
    const onExpand = vi.fn();
    render(
      <SchemaVisualizerNode
        id="node-ext"
        data={{ table: sampleTable, isExternal: true, onExpandExternal: onExpand }}
        selected={false}
      />,
      { wrapper },
    );
    const card = screen.getByText("public.users").closest("div");
    fireEvent.click(card!);
    expect(onExpand).toHaveBeenCalledWith("public", "users");
  });
});