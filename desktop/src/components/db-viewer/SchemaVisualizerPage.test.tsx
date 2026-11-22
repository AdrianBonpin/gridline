import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { SchemaVisualizerPage } from "./SchemaVisualizerPage";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { TooltipProvider } from "../ui/Tooltip";
import { toPng } from "html-to-image";
import { isTauri } from "@tauri-apps/api/core";
import * as commands from "../../lib/commands";

// Mock html-to-image so exports don't hit real DOM capture in jsdom
vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
  toJpeg: vi.fn().mockResolvedValue("data:image/jpeg;base64,AAAA"),
  toSvg: vi.fn().mockResolvedValue("data:image/svg+xml;base64,AAAA"),
}));

// The export destination is authorized by a Rust File Grant: the component asks
// the backend for the picker (`selectFileForGrant`) and publishes the bytes
// through the grant id (`saveGrantedBytes`). No path crosses the boundary.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    tables: [],
    relationships: [],
  }),
  isTauri: vi.fn(() => true),
}));

// Mock the SchemaVisualizerNode to avoid React Flow complexity in tests
vi.mock("./SchemaVisualizerNode", () => ({
  SchemaVisualizerNode: () => <div data-testid="mock-node">Node</div>,
}));

describe("SchemaVisualizerPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
    useNotificationStore.setState({ notifications: [] });
    useDbViewerStore.setState({
      schemas: ["public", "auth"],
      currentSchema: "public",
    });
    // Every export publishes through a File Grant. A test that cares overrides
    // these with its own selection/refusal; leaving them unset would make the
    // real commands run against the mocked `invoke`.
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue({
      id: "grant-image",
      path: "/Users/me/Pictures/public-export.png",
      displayName: "public-export.png",
      intent: "write",
      expiresInSeconds: 300,
    });
    vi.spyOn(commands, "saveGrantedBytes").mockResolvedValue(
      "/Users/me/Pictures/public-export.png",
    );
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

  const graphWithOneTable = () => ({
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

  const writeGrant = (path = "/Users/me/Pictures/public-export.png") => ({
    id: "grant-image",
    path,
    displayName: path.split("/").pop() ?? path,
    intent: "write" as const,
    expiresInSeconds: 300,
  });

  async function renderWithTable() {
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockReset();
    (invoke as any).mockResolvedValue(graphWithOneTable());

    render(
      <TooltipProvider>
        <SchemaVisualizerPage
          connectionId="conn-1"
          onSchemaChange={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByText("1 table");
  }

  it("publishes the rendered bytes through a write File Grant and reports the granted path", async () => {
    const selected = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(writeGrant());
    const save = vi
      .spyOn(commands, "saveGrantedBytes")
      .mockResolvedValue("/Users/me/Pictures/public-export.png");

    await renderWithTable();
    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The grant id and the bytes are the whole write request: the destination
    // is the grant's, so the renderer never names a path.
    expect(save).toHaveBeenCalledWith("grant-image", expect.any(Uint8Array));

    const [request] = selected.mock.calls[0];
    expect(request.intent).toBe("write");
    expect(request).not.toHaveProperty("path");
    expect(request.filters).toEqual([{ name: "PNG", extensions: ["png"] }]);

    const notification = useNotificationStore
      .getState()
      .notifications.find((n) => n.message.includes("exported to"));
    expect(notification).toBeTruthy();
    expect(notification!.message).toContain(
      "/Users/me/Pictures/public-export.png",
    );
  });

  it("defaults the filename to the db name plus a locale timestamp", async () => {
    const selected = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(null);
    const save = vi.spyOn(commands, "saveGrantedBytes");

    await renderWithTable();
    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(selected).toHaveBeenCalled());
    const { defaultName } = selected.mock.calls[0][0] as { defaultName?: string };
    // schema is "public" here; timestamp is locale-formatted then sanitized
    expect(defaultName).toMatch(/^public-.*\.png$/);
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing when the file picker is cancelled", async () => {
    const selected = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(null);
    const save = vi.spyOn(commands, "saveGrantedBytes");

    await renderWithTable();
    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(selected).toHaveBeenCalled());
    // A cancelled picker authorizes nothing: no write, no success message.
    expect(save).not.toHaveBeenCalled();
    expect(
      useNotificationStore
        .getState()
        .notifications.some((n) => n.message.includes("exported to")),
    ).toBe(false);
  });

  it("shows a rejected grant as a visible error instead of writing elsewhere", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(
      writeGrant("/Users/me/Pictures/public-export.png"),
    );
    const save = vi
      .spyOn(commands, "saveGrantedBytes")
      .mockRejectedValue(
        "file-grant-expired: The file selection expired five minutes after it was made. Choose the file again.",
      );

    await renderWithTable();
    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(save).toHaveBeenCalled());
    // Expired/wrong-intent/consumed selections surface as the backend's code +
    // message; there is no silent fallback to a renderer-chosen path.
    expect(await screen.findByText(/file-grant-expired/)).toBeInTheDocument();
    expect(
      useNotificationStore
        .getState()
        .notifications.some((n) => n.message.includes("exported to")),
    ).toBe(false);
  });

  it("falls back to the webview download outside Tauri, without asking for a grant", async () => {
    (isTauri as Mock).mockReturnValueOnce(false);
    const selected = vi.spyOn(commands, "selectFileForGrant");
    const save = vi.spyOn(commands, "saveGrantedBytes");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await renderWithTable();
    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByText("PNG"));

    // Plain browser dev keeps its download behaviour: no IPC file call at all.
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(selected).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
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

  it("exports a transparent PNG when a transparent background is selected", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(null);
    await renderWithTable();

    fireEvent.click(screen.getByText(/export/i));
    fireEvent.click(screen.getByLabelText("Export background"));
    fireEvent.click(screen.getByText("Transparent"));
    fireEvent.click(screen.getByText("PNG"));

    await waitFor(() => expect(toPng).toHaveBeenCalled());
    const [, options] = (toPng as Mock).mock.calls[0];
    expect(options.backgroundColor).toBeUndefined();
  });
});
