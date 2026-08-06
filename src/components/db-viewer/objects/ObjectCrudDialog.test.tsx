import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectCrudDialog } from "./ObjectCrudDialog";
import * as objectCrud from "../../../lib/objectCrud";
import { useDbViewerStore } from "../../../stores/dbViewerStore";

vi.mock("../../../lib/objectCrud", () => ({
  buildObjectDdl: vi.fn(),
}));

describe("ObjectCrudDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
  });

  it("shows the generated SQL preview and stages one change per statement", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      'DROP SEQUENCE "public"."s"',
    ]);
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");
    render(
      <ObjectCrudDialog
        open={true}
        connectionId="c1"
        kind="sequence"
        title="Drop sequence s"
        params={{ schema: "public", name: "s", action: { op: "drop" } }}
        description="Drop sequence s"
        onClose={() => {}}
      >
        <div data-testid="form-body" />
      </ObjectCrudDialog>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/DROP SEQUENCE "public"."s"/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /stage/i }));
    await waitFor(() =>
      expect(addChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ddl",
          sql: 'DROP SEQUENCE "public"."s"',
          description: "Drop sequence s",
        }),
      ),
    );
  });

  it("stages multiple statements with (n/total) descriptions", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockResolvedValue([
      'DROP MATERIALIZED VIEW "public"."m"',
      'CREATE MATERIALIZED VIEW "public"."m" AS\nSELECT 1',
    ]);
    const addChange = vi.spyOn(useDbViewerStore.getState(), "addChange");
    render(
      <ObjectCrudDialog
        open={true}
        connectionId="c1"
        kind="view"
        title="Edit matview m"
        params={{
          schema: "public",
          name: "m",
          materialized: true,
          action: { op: "replace", definition: "SELECT 1" },
        }}
        description="Edit matview m"
        onClose={() => {}}
      >
        <div data-testid="form-body" />
      </ObjectCrudDialog>,
    );
    await waitFor(() =>
      fireEvent.click(screen.getByRole("button", { name: /stage/i })),
    );
    await waitFor(() => {
      expect(addChange).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ description: "Edit matview m (1/2)" }),
      );
      expect(addChange).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ description: "Edit matview m (2/2)" }),
      );
    });
  });

  it("shows a builder error and disables Stage", async () => {
    vi.mocked(objectCrud.buildObjectDdl).mockRejectedValueOnce(
      "Expression must not be empty",
    );
    render(
      <ObjectCrudDialog
        open={true}
        connectionId="c1"
        kind="constraint"
        title="Add check"
        params={{
          schema: "public",
          table: "t",
          name: "c",
          action: { op: "check", expression: "" },
        }}
        description="Add check"
        onClose={() => {}}
      >
        <div data-testid="form-body" />
      </ObjectCrudDialog>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Expression must not be empty/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /stage/i })).toBeDisabled();
  });
});