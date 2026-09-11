import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue("/tmp/export.csv"),
}));
vi.mock("../../lib/commands", () => ({
  exportQueryToFile: vi.fn().mockResolvedValue({ rows_written: 3 }),
  cancelQuery: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { StreamExportDialog } from "./StreamExportDialog";
import { save } from "@tauri-apps/plugin-dialog";
import { exportQueryToFile, cancelQuery } from "../../lib/commands";

describe("StreamExportDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("picks a path, invokes the export, and reports the row count", async () => {
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
    expect(save).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportQueryToFile).toHaveBeenCalledWith("c1", "SELECT 1", "csv", "/tmp/export.csv"));
    await waitFor(() => expect(screen.getByText(/3 rows written/i)).toBeTruthy());
  });

  it("cancels via the existing query-cancel wrapper", async () => {
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith("c1"));
  });

  it("surfaces export errors", async () => {
    (exportQueryToFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeTruthy());
  });
});
