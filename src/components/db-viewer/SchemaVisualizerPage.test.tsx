import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemaVisualizerPage } from "./SchemaVisualizerPage";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TooltipProvider } from "../ui/Tooltip";

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
});