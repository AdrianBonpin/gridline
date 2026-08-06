import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TriggerForm } from "./TriggerForm";
import * as cmd from "../../../lib/commands";
import type { DdlParams } from "../../../lib/objectCrud";

vi.mock("../../../lib/commands", () => ({ getFunctions: vi.fn() }));

const baseParams: DdlParams = {
  schema: "public",
  name: "tr",
  action: {
    op: "create",
    table: "orders",
    timing: "BEFORE",
    events: ["INSERT"],
    orientation: "ROW",
    function_schema: "public",
    function_name: "",
    function_args: [],
    when: null,
  },
};

describe("TriggerForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only trigger-returning functions", async () => {
    (cmd.getFunctions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "audit_fn",
        schema: "public",
        return_type: "trigger",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "plpgsql",
        source: null,
        kind: "f",
      },
      {
        name: "not_a_trigger",
        schema: "public",
        return_type: "void",
        argument_types: [],
        argument_names: [],
        argument_modes: [],
        language: "plpgsql",
        source: null,
        kind: "f",
      },
    ]);

    render(
      <TriggerForm
        connectionId="c1"
        params={baseParams}
        onChange={() => {}}
      />,
    );

    expect(await screen.findByText("audit_fn")).toBeInTheDocument();
    expect(screen.queryByText("not_a_trigger")).not.toBeInTheDocument();
  });

  it("emits timing + events", async () => {
    (cmd.getFunctions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const onChange = vi.fn();
    render(
      <TriggerForm connectionId="c1" params={baseParams} onChange={onChange} />,
    );

    await waitFor(() => expect(cmd.getFunctions).toHaveBeenCalledWith("c1", "public"));

    fireEvent.change(screen.getByDisplayValue("BEFORE"), {
      target: { value: "AFTER" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ timing: "AFTER" }),
      }),
    );

    fireEvent.click(screen.getByText("UPDATE"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ events: ["INSERT", "UPDATE"] }),
      }),
    );
  });
});