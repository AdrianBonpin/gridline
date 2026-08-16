import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ExtensionForm } from "./ExtensionForm";
import * as objectCrud from "../../../lib/objectCrud";

vi.mock("../../../lib/objectCrud", () => ({
  getAvailableExtensions: vi.fn(),
  buildObjectDdl: vi.fn(),
}));

describe("ExtensionForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("create: lists available extensions and emits name on pick", async () => {
    vi.mocked(objectCrud.getAvailableExtensions).mockResolvedValue([
      { name: "pgcrypto", version: "1.3", comment: null },
    ]);
    const onChange = vi.fn();
    render(
      <ExtensionForm
        connectionId="c1"
        params={{
          schema: "public",
          name: "",
          action: { op: "create", version: null },
        }}
        onChange={onChange}
      />,
    );
    expect(await screen.findByText("pgcrypto")).toBeInTheDocument();
    fireEvent.click(screen.getByText("pgcrypto"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "pgcrypto",
        action: expect.objectContaining({ version: "1.3" }),
      }),
    );
  });

  it("set_schema op emits new_schema", () => {
    const onChange = vi.fn();
    render(
      <ExtensionForm
        connectionId="c1"
        params={{
          schema: "public",
          name: "pgcrypto",
          action: { op: "set_schema", new_schema: "" },
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("New schema"), {
      target: { value: "utils" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ new_schema: "utils" }),
      }),
    );
  });
});