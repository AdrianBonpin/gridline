import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ObjectContextMenu } from "./ObjectContextMenu";
import * as objectCrud from "../../../lib/objectCrud";
import { useDbViewerStore } from "../../../stores/dbViewerStore";

vi.mock("../../../lib/objectCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/objectCrud")>();
  return {
    ...actual,
    buildObjectDdl: vi.fn(),
    getAvailableExtensions: vi.fn(),
  };
});

describe("ObjectContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
  });

  it("Edit on a sequence opens the dialog and stages on confirm", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      'ALTER SEQUENCE "public"."s"\n  INCREMENT BY 2',
    ]);
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");
    render(
      <ObjectContextMenu
        connectionId="c1"
        objectType="sequence"
        item={{ schema: "public", name: "s" }}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByText("Edit…"));
    expect(
      await screen.findByText(/ALTER SEQUENCE "public"."s"/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stage/i }));
    await waitFor(() =>
      expect(addChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ddl" }),
      ),
    );
  });

  it("Drop fetches dependencies then stages the drop", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      'DROP SEQUENCE "public"."s"',
    ]);
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");
    render(
      <ObjectContextMenu
        connectionId="c1"
        objectType="sequence"
        item={{ schema: "public", name: "s" }}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    fireEvent.click(screen.getByText("Drop…"));
    // DependencyDialog with no deps → Proceed is enabled
    expect(
      await screen.findByRole("button", { name: /proceed/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /proceed/i }));
    await waitFor(() =>
      expect(addChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ddl",
          sql: 'DROP SEQUENCE "public"."s"',
        }),
      ),
    );
  });
});