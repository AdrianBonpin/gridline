import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";
import { SchemaVisualizerPage } from "./SchemaVisualizerPage";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TooltipProvider } from "../ui/Tooltip";
import { toPng } from "html-to-image";

// Mock html-to-image so exports don't hit real DOM capture in jsdom
vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
  toJpeg: vi.fn().mockResolvedValue("data:image/jpeg;base64,AAAA"),
  toSvg: vi.fn().mockResolvedValue("data:image/svg+xml;base64,AAAA"),
}));

// Mock the Tauri invoke call
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    tables: [],
    relationships: [],
  }),
}));

// Mock the SchemaVisualizerNode to avoid React Flow complexity in tests
vi.mock("./SchemaVisualizerNode", () => ({
  SchemaVisualizerNode: () => <div data-testid="mock-node">Node</div>,
}));

describe("SchemaVisualizerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
    useDbViewerStore.setState({
      schemas: ["public", "auth"],
      currentSchema: "public",
    });
  });

  it("renders the legend panel", () => {
    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/one-to-one/i)).toBeInTheDocument();
    expect(screen.getByText(/one-to-many/i)).toBeInTheDocument();
    expect(screen.getByText(/many-to-many/i)).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/loading schema/i)).toBeInTheDocument();
  });

  it("renders Reset Layout button", () => {
    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/reset layout/i)).toBeInTheDocument();
  });

  it("shows error message when introspection fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockRejectedValueOnce(new Error("Connection lost"));

    render(
      <TooltipProvider>
        <SchemaVisualizerPage connectionId="conn-1" onSchemaChange={() => {}} />
      </TooltipProvider>,
    );

    const errorMsg = await screen.findByText(/failed to load schema/i);
    expect(errorMsg).toBeInTheDocument();
  });

  it("renders the Export menu with a scope selector and format options", () => {
    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByText(/export/i));
    expect(screen.getByLabelText("Export scope")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByText("JPEG")).toBeInTheDocument();
    expect(screen.getByText("SVG")).toBeInTheDocument();
  });

  it("exports the viewport as PNG when Viewport scope is selected", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockReset();
    (invoke as any).mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [
            {
              name: "id",
              data_type: "integer",
              is_pk: true,
              is_fk: false,
              is_unique: true,
              is_nullable: false,
              fk_ref: null,
            },
          ],
        },
      ],
      relationships: [],
    });

    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("1 table");

    fireEvent.click(screen.getByText(/export/i));
    // pick Viewport scope, then PNG
    fireEvent.click(screen.getByLabelText("Export scope"));
    fireEvent.click(screen.getByText("Viewport"));
    fireEvent.click(screen.getByText("PNG"));

    expect(toPng).toHaveBeenCalledTimes(1);
    const [, options] = (toPng as Mock).mock.calls[0];
    // Viewport export keeps the current view — no transform override
    expect(options.style).toBeUndefined();
    expect(options.width).toBeGreaterThan(0);
  });

  it("exports the entire schema as PNG with a computed transform", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockReset();
    (invoke as any).mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [
            {
              name: "id",
              data_type: "integer",
              is_pk: true,
              is_fk: false,
              is_unique: true,
              is_nullable: false,
              fk_ref: null,
            },
          ],
        },
      ],
      relationships: [],
    });

    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("1 table");

    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG")); // scope defaults to Entire Schema

    expect(toPng).toHaveBeenCalledTimes(1);
    const [, options] = (toPng as Mock).mock.calls[0];
    expect(options.style.transform).toContain("scale(");
  });

  it("shows an export error when the schema has no nodes", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockReset();
    (invoke as any).mockResolvedValue({ tables: [], relationships: [] });

    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );

    // default mock resolves an empty graph
    await screen.findByText(/no tables found/i);

    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    expect(await screen.findByText(/export failed/i)).toBeInTheDocument();
  });
});