import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConstraintForm } from "./ConstraintForm";
import * as cmd from "../../../lib/commands";

vi.mock("../../../lib/commands", () => ({ getSchemaGraph: vi.fn() }));

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
  afterEach(() => {
    vi.mocked(cmd.getSchemaGraph).mockReset();
  });

  it("check: emits the expression", () => {
    vi.mocked(cmd.getSchemaGraph).mockResolvedValue(graph as any);
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
    vi.mocked(cmd.getSchemaGraph).mockResolvedValue(graph as any);
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
    const refTable = await screen.findByPlaceholderText("Referenced table");
    fireEvent.change(refTable, { target: { value: "users" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          ref_schema: "public",
          ref_table: "users",
        }),
      }),
    );
  });
});