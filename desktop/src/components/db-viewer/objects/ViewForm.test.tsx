import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ViewForm } from "./ViewForm";

vi.mock("../../editor/SqlEditorField", () => ({
  SqlEditorField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="sql-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe("ViewForm", () => {
  it("create: emits the definition", async () => {
    const onChange = vi.fn();
    render(
      <ViewForm
        params={{ schema: "public", name: "v", materialized: false, action: { op: "create", definition: "SELECT 1" } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(await screen.findByTestId("sql-editor"), { target: { value: "SELECT 2" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ definition: "SELECT 2" }) }),
    );
  });

  it("matview replace shows a note about drop+create", () => {
    render(
      <ViewForm
        params={{ schema: "public", name: "mv", materialized: true, action: { op: "replace", definition: "SELECT 1" } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/drop and recreate/i)).toBeInTheDocument();
  });
});