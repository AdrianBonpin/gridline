import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EnumForm } from "./EnumForm";

describe("EnumForm", () => {
  it("create: add/remove labels", () => {
    const onChange = vi.fn();
    render(
      <EnumForm
        params={{ schema: "public", name: "role", action: { op: "create", labels: ["admin"] } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add value/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ labels: ["admin", ""] }),
      }),
    );
  });

  it("add_value op shows value + position + the no-removal note", () => {
    render(
      <EnumForm
        params={{
          schema: "public",
          name: "color",
          action: { op: "add_value", value: "orange", if_not_exists: false, before: null, after: null },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("New value")).toHaveValue("orange");
    expect(screen.getByText(/no ALTER TYPE … DROP VALUE/i)).toBeInTheDocument();
  });

  it("rename_value op shows from + to", () => {
    render(
      <EnumForm
        params={{
          schema: "public",
          name: "color",
          action: { op: "rename_value", from: "purple", to: "mauve" },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("From")).toHaveValue("purple");
    expect(screen.getByPlaceholderText("To")).toHaveValue("mauve");
  });
});