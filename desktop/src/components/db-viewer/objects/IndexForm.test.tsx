import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { IndexForm } from "./IndexForm";
import * as cmd from "../../../lib/commands";

vi.mock("../../../lib/commands", () => ({ getSchemaGraph: vi.fn() }));

const graph = {
  tables: [
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
          is_unique: false,
          is_nullable: false,
          fk_ref: null,
        },
        {
          name: "email",
          data_type: "text",
          is_pk: false,
          is_fk: false,
          is_unique: false,
          is_nullable: true,
          fk_ref: null,
        },
      ],
    },
  ],
  relationships: [],
};

describe("IndexForm", () => {
  afterEach(() => {
    vi.mocked(cmd.getSchemaGraph).mockReset();
  });

  it("loads table columns and toggles a column into the index", async () => {
    vi.mocked(cmd.getSchemaGraph).mockResolvedValue(graph as any);
    const onChange = vi.fn();
    render(
      <IndexForm
        connectionId="c1"
        params={{
          schema: "public",
          table: "users",
          name: "i",
          action: { op: "create", unique: false, method: "btree", columns: [], predicate: null },
        }}
        onChange={onChange}
      />,
    );
    expect(await screen.findByText("email")).toBeInTheDocument();
    fireEvent.click(screen.getByText("email"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ columns: ["email"] }) }),
    );
  });

  it("toggles unique", () => {
    vi.mocked(cmd.getSchemaGraph).mockResolvedValue({
      tables: [{ name: "users", schema: "public", table_type: "BASE TABLE", columns: [] }],
      relationships: [],
    } as any);
    const onChange = vi.fn();
    render(
      <IndexForm
        connectionId="c1"
        params={{
          schema: "public",
          table: "users",
          name: "i",
          action: { op: "create", unique: false, method: "btree", columns: [], predicate: null },
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Unique"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ unique: true }) }),
    );
  });
});