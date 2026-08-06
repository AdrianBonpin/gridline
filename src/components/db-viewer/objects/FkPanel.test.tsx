import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FkPanel } from "./FkPanel";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import * as objectCrud from "../../../lib/objectCrud";

const graph = {
  tables: [
    {
      name: "orders",
      schema: "public",
      table_type: "BASE TABLE",
      columns: [
        { name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null },
        { name: "user_id", data_type: "int", is_pk: false, is_fk: true, is_unique: false, is_nullable: true, fk_ref: ["public", "users", "id"] },
      ],
    },
    {
      name: "users",
      schema: "public",
      table_type: "BASE TABLE",
      columns: [
        { name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null },
        { name: "email", data_type: "text", is_pk: false, is_fk: false, is_unique: false, is_nullable: true, fk_ref: null },
      ],
    },
    {
      name: "orgs",
      schema: "auth",
      table_type: "BASE TABLE",
      columns: [
        { name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: true, is_nullable: false, fk_ref: null },
        { name: "name", data_type: "text", is_pk: false, is_fk: false, is_unique: false, is_nullable: true, fk_ref: null },
      ],
    },
  ],
  relationships: [],
};

beforeEach(() => {
  useDbViewerStore.getState().reset();
  vi.spyOn(cmd, "getSchemaGraph").mockReset().mockResolvedValue(graph as any);
  vi.spyOn(objectCrud, "buildObjectDdl").mockReset().mockResolvedValue(["ALTER TABLE ... ADD CONSTRAINT ..."]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPanel(props: Partial<React.ComponentProps<typeof FkPanel>> = {}) {
  const onClose = vi.fn();
  const onStaged = vi.fn();
  const utils = render(
    <FkPanel
      connectionId="c1"
      schema="public"
      table="orders"
      column="user_id"
      onClose={onClose}
      onStaged={onStaged}
      {...props}
    />,
  );
  return { ...utils, onClose, onStaged };
}

describe("FkPanel", () => {
  it("renders cascading dropdowns with schemas, tables, and PK-first columns", async () => {
    renderPanel();
    expect(await screen.findByText("Foreign key")).toBeInTheDocument();

    // Local column select preselected
    const local = screen.getByLabelText("Column") as HTMLSelectElement;
    expect(local.value).toBe("user_id");

    // Schema select contains public and auth
    const schema = screen.getByLabelText("Schema") as HTMLSelectElement;
    await waitFor(() => {
      expect([...schema.options].map((o) => o.value)).toContain("public");
      expect([...schema.options].map((o) => o.value)).toContain("auth");
    });

    // Table select contains public tables by default
    const table = screen.getByLabelText("Table") as HTMLSelectElement;
    await waitFor(() => {
      expect([...table.options].map((o) => o.value)).toContain("users");
      expect([...table.options].map((o) => o.value)).not.toContain("orgs");
    });

    // Referenced column select lists PKs first and marks them
    const refCol = screen.getByLabelText("Column (referenced)") as HTMLSelectElement;
    await waitFor(() => {
      const opts = [...refCol.options].map((o) => o.textContent);
      expect(opts[0]).toMatch(/id/);
    });
  });

  it("updates table and column lists when schema changes", async () => {
    renderPanel();
    const schema = await screen.findByLabelText("Schema");
    fireEvent.change(schema, { target: { value: "auth" } });

    const table = screen.getByLabelText("Table") as HTMLSelectElement;
    await waitFor(() => {
      expect([...table.options].map((o) => o.value)).toContain("orgs");
      expect([...table.options].map((o) => o.value)).not.toContain("users");
    });
  });

  it("renders relationship controls: ON DELETE, ON UPDATE, DEFERRABLE, INITIALLY DEFERRED", async () => {
    renderPanel();
    await screen.findByText("Foreign key");
    expect(screen.getByLabelText("On delete")).toBeInTheDocument();
    expect(screen.getByLabelText("On update")).toBeInTheDocument();
    expect(screen.getByLabelText("DEFERRABLE")).toBeInTheDocument();
    expect(screen.getByLabelText("INITIALLY DEFERRED")).toBeDisabled();
  });

  it("enables INITIALLY DEFERRED only when DEFERRABLE is checked", async () => {
    renderPanel();
    await screen.findByText("Foreign key");
    const deferrable = screen.getByLabelText("DEFERRABLE");
    const initiallyDeferred = screen.getByLabelText("INITIALLY DEFERRED");
    expect(initiallyDeferred).toBeDisabled();
    fireEvent.click(deferrable);
    expect(initiallyDeferred).not.toBeDisabled();
  });

  it("stages a foreign key DDL change and closes the panel", async () => {
    renderPanel();
    await screen.findByText("Foreign key");

    fireEvent.change(screen.getByLabelText("On delete"), { target: { value: "CASCADE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add FK" }));

    await waitFor(() => {
      expect(objectCrud.buildObjectDdl).toHaveBeenCalledWith(
        "c1",
        "constraint",
        expect.objectContaining({
          schema: "public",
          table: "orders",
          name: "",
          action: expect.objectContaining({
            op: "foreign_key",
            columns: ["user_id"],
            on_delete: "CASCADE",
            on_update: "NO ACTION",
            deferrable: false,
            initially_deferred: false,
          }),
        }),
      );
    });

    const q = useDbViewerStore.getState().changesQueue;
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe("ddl");
    expect(q[0].sql).toBe("ALTER TABLE ... ADD CONSTRAINT ...");
  });
});