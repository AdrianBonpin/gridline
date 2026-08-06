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