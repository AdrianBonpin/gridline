import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportDialog } from "./ImportDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn().mockResolvedValue("/tmp/f.csv") }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn().mockResolvedValue("a,b\n1,2\n3,4") }));

describe("ImportDialog", () => {
  it("parses CSV and stages a bulk_insert change", async () => {
    const addChange = vi.fn();
    render(<ImportDialog open schema="public" table="t" columns={["a", "b"]} onStage={addChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /stage import/i }));
    await waitFor(() => {
      expect(addChange).toHaveBeenCalledWith(expect.objectContaining({
        type: "bulk_insert", schema: "public", table: "t",
        columns: ["a", "b"],
      }));
      expect(addChange.mock.calls[0][0].rows.length).toBe(2);
    });
  });
});