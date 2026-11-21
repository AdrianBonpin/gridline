import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../lib/commands", () => ({
  selectFileForGrant: vi.fn(),
  exportQueryToFile: vi.fn().mockResolvedValue({ rows_written: 3 }),
  cancelQuery: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { StreamExportDialog } from "./StreamExportDialog";
import { selectFileForGrant, exportQueryToFile, cancelQuery } from "../../lib/commands";

/** The grant the backend would issue for a native save selection. */
function writeGrant(id = "grant-export", path = "/tmp/export.csv") {
  return {
    id,
    path,
    displayName: path.split("/").pop() ?? path,
    intent: "write" as const,
    expiresInSeconds: 300,
  };
}

describe("StreamExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectFileForGrant).mockResolvedValue(writeGrant());
  });

  it("asks Rust for the destination and exports with the grant it issued", async () => {
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
    await waitFor(() =>
      expect(selectFileForGrant).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "write" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("export-path").textContent).toBe("/tmp/export.csv"),
    );

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() =>
      expect(exportQueryToFile).toHaveBeenCalledWith("c1", "SELECT 1", "csv", "grant-export"),
    );
    await waitFor(() => expect(screen.getByText(/3 rows written/i)).toBeTruthy());
  });

  it("chooses a destination when Export is pressed without one", async () => {
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalled());
    await waitFor(() =>
      expect(exportQueryToFile).toHaveBeenCalledWith("c1", "SELECT 1", "csv", "grant-export"),
    );
  });

  it("does not export when the selection is cancelled", async () => {
    vi.mocked(selectFileForGrant).mockResolvedValue(null);
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalled());
    expect(exportQueryToFile).not.toHaveBeenCalled();
  });

  it("shows the expired-grant state instead of falling back to a path", async () => {
    vi.mocked(exportQueryToFile).mockRejectedValueOnce(
      new Error("file-grant-expired: The file selection expired five minutes after it was made."),
    );
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(screen.getByTestId("export-file-grant-expired")).toBeTruthy());
    // The recovery action is a fresh selection, not reuse of the shown path.
    expect(screen.getByRole("button", { name: /^choose file$/i })).toBeTruthy();
  });

  it("cancels via the existing query-cancel wrapper", async () => {
    vi.mocked(exportQueryToFile).mockImplementationOnce(() => new Promise(() => {}));
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith("c1"));
  });

  it("surfaces export errors", async () => {
    vi.mocked(exportQueryToFile).mockRejectedValueOnce(new Error("boom"));
    render(<StreamExportDialog connectionId="c1" sql="SELECT 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeTruthy());
  });
});
