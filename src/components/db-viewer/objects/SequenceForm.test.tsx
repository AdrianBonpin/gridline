import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { SequenceForm } from "./SequenceForm";
import type { DdlParams } from "../../../lib/objectCrud";

function StatefulSequenceForm({ initialParams }: { initialParams: DdlParams }) {
  const [params, setParams] = useState(initialParams);
  return <SequenceForm params={params} onChange={setParams} />;
}

describe("SequenceForm", () => {
  it("renders create fields and emits params on change", () => {
    const onChange = vi.fn();
    render(
      <SequenceForm
        params={{
          schema: "public",
          name: "s",
          action: {
            op: "create",
            increment: "1",
            min_value: "1",
            max_value: "9",
            start: "1",
            cycle: false,
          },
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByPlaceholderText("Sequence name")).toHaveValue("s");
    fireEvent.change(screen.getByPlaceholderText("Sequence name"), {
      target: { value: "s2" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "s2" }),
    );
  });

  it("renders a schema dropdown when schemas are provided", () => {
    const onChange = vi.fn();
    render(
      <SequenceForm
        params={{ schema: "public", name: "s", action: { op: "create" } }}
        schemas={["public", "utils"]}
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText("Schema");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "public" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "utils" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "utils" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ schema: "utils" }),
    );
  });

  it("the editing outline wraps only the value area, not the label cell", () => {
    const onChange = vi.fn();
    render(
      <SequenceForm
        params={{ schema: "public", name: "s", action: { op: "create" } }}
        onChange={onChange}
      />,
    );

    // The children wrapper (direct parent of the input) carries the amber
    // focus-within editing outline, exactly like a grid editing cell.
    const input = screen.getByPlaceholderText("Sequence name");
    const valueArea = input.parentElement;
    expect(valueArea).not.toBeNull();
    expect(valueArea!.className).toContain("focus-within:outline");
    expect(valueArea!.className).toContain("focus-within:outline-amber-400/20");
    expect(valueArea!.className).toContain("focus-within:outline-offset-[-2px]");

    // The label cell must stay clean: no ancestor of the label may carry
    // the editing outline (regression: the old row-level outline lit up the
    // whole row, label cell included).
    const label = screen.getByText("Name");
    expect(label.closest('[class*="focus-within:outline"]')).toBeNull();
  });

  it("switching to restart shows only the with-field", () => {
    render(
      <StatefulSequenceForm
        initialParams={{
          schema: "public",
          name: "s",
          action: {
            op: "create",
            increment: "1",
            min_value: "1",
            max_value: "9",
            start: "1",
            cycle: false,
          },
        }}
      />,
    );

    const opSelect = screen.getByLabelText("Operation");
    fireEvent.change(opSelect, { target: { value: "restart" } });
    expect(screen.getByPlaceholderText("Restart with")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Increment")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Start")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("CYCLE")).not.toBeInTheDocument();
  });
});