import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { SchemaVisualizerPage } from "./SchemaVisualizerPage";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { TooltipProvider } from "../ui/Tooltip";
import { toPng } from "html-to-image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

// Mock html-to-image so exports don't hit real DOM capture in jsdom
vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
  toJpeg: vi.fn().mockResolvedValue("data:image/jpeg;base64,AAAA"),
  toSvg: vi.fn().mockResolvedValue("data:image/svg+xml;base64,AAAA"),
}));

// Mock the Tauri save dialog and fs write
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("/tmp/export.png"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
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
    useNotificationStore.setState({ notifications: [] });
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

  it("saves through the dialog and notifies with the file path", async () => {
    (save as Mock).mockResolvedValue("/Users/me/Pictures/public-export.png");
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
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/me/Pictures/public-export.png",
      expect.any(Uint8Array),
    );
    const notification = useNotificationStore
      .getState()
      .notifications.find((n) => n.message.includes("exported to"));
    expect(notification).toBeTruthy();
    expect(notification!.message).toContain(
      "/Users/me/Pictures/public-export.png",
    );
  });

  it("defaults the filename to the db name plus a locale timestamp", async () => {
    (save as Mock).mockResolvedValue(null);
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
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const { defaultPath } = (save as Mock).mock.calls[0][0];
    // schema is "public" here; timestamp is locale-formatted then sanitized
    expect(defaultPath).toMatch(/^public-.*\.png$/);
  });

  it("exports a transparent PNG when a transparent background is selected", async () => {
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
    fireEvent.click(screen.getByLabelText("Export background"));
    fireEvent.click(screen.getByText("Transparent"));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(toPng).toHaveBeenCalled());
    const [, options] = (toPng as Mock).mock.calls[0];
    expect(options.backgroundColor).toBeUndefined();
  });

  it("hides the JPEG option when a transparent background is selected", async () => {
    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByText(/export/i));
    // JPEG is available with an opaque background by default
    expect(screen.getByText("JPEG")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Export background"));
    fireEvent.click(screen.getByText("Transparent"));

    expect(screen.queryByText("JPEG")).not.toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByText("SVG")).toBeInTheDocument();
  });

  it("does not write the file when the save dialog is cancelled", async () => {
    (save as Mock).mockResolvedValue(null);
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
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(writeFile).not.toHaveBeenCalled();
    expect(
      useNotificationStore
        .getState()
        .notifications.some((n) => n.message.includes("exported to")),
    ).toBe(false);
  });
});