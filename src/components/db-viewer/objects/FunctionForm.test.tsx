import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FunctionForm } from "./FunctionForm";
import type { DdlParams } from "../../../lib/objectCrud";

vi.mock("../../editor/SqlEditorField", () => ({
  SqlEditorField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="sql-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe("FunctionForm", () => {
  it("function: renders args grid + return type; emits body", async () => {
    const onChange = vi.fn();
    const params: DdlParams = {
      schema: "public",
      name: "add",
      is_procedure: false,
      action: {
        op: "create_or_replace",
        args: [{ mode: "in", name: "a", type: "int" }],
        return_type: "int",
        language: "plpgsql",
        body: "",
        volatility: null,
        strict: false,
      },
    };
    render(<FunctionForm kind="function" params={params} onChange={onChange} />);
    fireEvent.change(await screen.findByTestId("sql-editor"), {
      target: { value: "BEGIN RETURN a; END" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ body: "BEGIN RETURN a; END" }),
      }),
    );
  });

  it("renders a schema dropdown when schemas are provided", () => {
    const onChange = vi.fn();
    const params: DdlParams = {
      schema: "public",
      name: "add",
      is_procedure: false,
      action: {
        op: "create_or_replace",
        args: [],
        return_type: "int",
        language: "plpgsql",
        body: "",
        volatility: null,
        strict: false,
      },
    };
    render(
      <FunctionForm
        kind="function"
        params={params}
        schemas={["public", "utils"]}
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText("Schema");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "utils" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "utils" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ schema: "utils" }),
    );
  });

  it("procedure: hides return type", () => {
    const params: DdlParams = {
      schema: "public",
      name: "p",
      is_procedure: true,
      action: {
        op: "create_or_replace",
        args: [],
        return_type: null,
        language: "plpgsql",
        body: "",
        volatility: null,
        strict: false,
      },
    };
    render(
      <FunctionForm kind="procedure" params={params} onChange={() => {}} />,
    );
    expect(screen.queryByPlaceholderText("Return type")).not.toBeInTheDocument();
  });

  it("drop op: renders arg_types list", () => {
    const onChange = vi.fn();
    const params: DdlParams = {
      schema: "public",
      name: "add",
      is_procedure: false,
      action: { op: "drop", arg_types: ["int"] },
    };
    render(<FunctionForm kind="function" params={params} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("Arg types (comma-separated)"), {
      target: { value: "int, int" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ arg_types: ["int", "int"] }),
      }),
    );
  });
});