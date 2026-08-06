import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObjectDetail } from "./ObjectDetail";

describe("ObjectDetail", () => {
  it("renders an enum's labels as list items", () => {
    render(
      <ObjectDetail
        connectionId="c1"
        type="enums"
        item={{ name: "role", schema: "public", labels: ["admin", "user"] }}
      />,
    );
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("user")).toBeInTheDocument();
  });

  it("renders a function's return type and language", () => {
    render(
      <ObjectDetail
        connectionId="c1"
        type="functions"
        item={{
          name: "add",
          schema: "public",
          return_type: "int",
          argument_types: ["integer", "text"],
          argument_names: ["a", "b"],
          argument_modes: ["IN", "IN"],
          language: "plpgsql",
          source: "BEGIN RETURN a+b; END",
          kind: "f",
        }}
      />,
    );
    expect(screen.getByText("int")).toBeInTheDocument();
    expect(screen.getAllByText(/plpgsql/i).length).toBeGreaterThanOrEqual(1);
  });
});