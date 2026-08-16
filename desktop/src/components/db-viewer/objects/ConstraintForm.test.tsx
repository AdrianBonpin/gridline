import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConstraintForm } from "./ConstraintForm";
import * as cmd from "../../../lib/commands";

beforeEach(() => {
  vi.spyOn(cmd, "getSchemaGraph").mockReset().mockResolvedValue({ tables: [], relationships: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const graph = {
  tables: [
    {
      name: "orders",
      schema: "public",
      table_type: "BASE TABLE",
      columns: [
        {
          name: "user_id",
          data_type: "int",
          is_pk: false,
          is_fk: true,
          is_unique: false,
          is_nullable: true,
          fk_ref: ["public", "users", "id"],
        },
      ],
    },
    {
      name: "users",
      schema: "public",
      table_type: "BASE TABLE",
      columns: [
        {
          name: "id",
          data_type: "int",
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
};

describe("ConstraintForm", () => {
  it("check: emits the expression", () => {
    (cmd.getSchemaGraph as any).mockResolvedValue(graph as any);
    const onChange = vi.fn();
    render(
      <ConstraintForm
        connectionId="c1"
        params={{
          schema: "public",
          table: "orders",
          name: "ck",
          action: { op: "check", expression: "" },
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("CHECK expression"), {
      target: { value: "amount > 0" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ expression: "amount > 0" }),
      }),
    );
  });

  it("foreign_key: picks referenced table + column", async () => {
    (cmd.getSchemaGraph as any).mockResolvedValue(graph as any);
    const onChange = vi.fn();
    render(
      <ConstraintForm
        connectionId="c1"
        params={{
          schema: "public",
          table: "orders",
          name: "fk",
          action: {
            op: "foreign_key",
            columns: ["user_id"],
            ref_schema: "",
            ref_table: "",
            ref_columns: [],
          },
        }}
        onChange={onChange}
      />,
    );
    const kindSelect = screen.getByLabelText("Kind");
    fireEvent.change(kindSelect, { target: { value: "foreign_key" } });
    await screen.findByText("user_id");
    const refTable = await screen.findByLabelText("Referenced table");
    fireEvent.change(refTable, { target: { value: "public.users" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          ref_schema: "public",
          ref_table: "users",
        }),
      }),
    );
  });

  it("FK form includes ON DELETE/UPDATE + deferrable and cross-schema ref picker", async () => {
    // mock getSchemaGraph to return tables across two schemas
    (cmd.getSchemaGraph as any).mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [
            { name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: false, is_nullable: false, fk_ref: null },
          ],
        },
        {
          name: "orgs",
          schema: "auth",
          table_type: "TABLE",
          columns: [
            { name: "id", data_type: "int", is_pk: true, is_fk: false, is_unique: false, is_nullable: false, fk_ref: null },
          ],
        },
      ],
      relationships: [],
    } as any);
    render(
      <ConstraintForm
        connectionId="c1"
        schemas={["public", "auth"]}
        params={{
          schema: "public",
          table: "orders",
          name: "fk1",
          action: {
            op: "foreign_key",
            columns: ["org_id"],
            ref_schema: "auth",
            ref_table: "orgs",
            ref_columns: ["id"],
            on_delete: "CASCADE",
            on_update: "NO ACTION",
            deferrable: false,
            initially_deferred: false,
          },
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("On delete")).toBeInTheDocument();
    expect(screen.getByLabelText("On update")).toBeInTheDocument();
    // referenced-table picker includes the auth.orgs option
    const ref = screen.getByLabelText("Referenced table") as HTMLSelectElement;
    await waitFor(() => {
      expect([...ref.options].map((o) => o.value)).toContain("auth.orgs");
    });
  });
});