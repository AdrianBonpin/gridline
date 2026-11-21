import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportDialog } from "./ImportDialog";
import { readImportFile, selectFileForGrant } from "../../lib/commands";

vi.mock("../../lib/commands", () => ({
  selectFileForGrant: vi.fn(),
  readImportFile: vi.fn(),
}));

/** The grant the backend would issue for a native read selection. */
function readGrant(id = "grant-import", path = "/tmp/f.csv") {
  return {
    id,
    path,
    displayName: path.split("/").pop() ?? path,
    intent: "read" as const,
    expiresInSeconds: 300,
  };
}

describe("ImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectFileForGrant).mockResolvedValue(readGrant());
    vi.mocked(readImportFile).mockResolvedValue({
      text: "a,b\n1,2\n3,4",
      displayName: "f.csv",
      bytes: 11,
    });
  });

  it("reads the granted file and stages a bulk_insert change", async () => {
    const addChange = vi.fn();
    render(<ImportDialog open schema="public" table="t" columns={["a", "b"]} onStage={addChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));

    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "read" }),
    ));
    // The source is read through the grant id, never a renderer-supplied path.
    await waitFor(() => expect(readImportFile).toHaveBeenCalledWith("grant-import"));
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

  it("rejects files over the row cap", async () => {
    vi.mocked(readImportFile).mockResolvedValue({
      text: "a\n" + "1\n".repeat(100_001),
      displayName: "big.csv",
      bytes: 200_002,
    });
    const onStage = vi.fn();
    render(<ImportDialog open schema="public" table="t" columns={["a"]} onStage={onStage} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
    await waitFor(() => expect(screen.getByText(/limit/i)).toBeInTheDocument());
    expect(onStage).not.toHaveBeenCalled();
  });

  it("shows a grant rejection and stages nothing", async () => {
    vi.mocked(readImportFile).mockRejectedValue(
      new Error("file-grant-consumed: That file selection was already used by another job."),
    );
    const onStage = vi.fn();
    render(<ImportDialog open schema="public" table="t" columns={["a"]} onStage={onStage} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose file/i }));

    await waitFor(() =>
      expect(screen.getByText(/already used by another job/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(screen.getByRole("button", { name: /stage import/i })).toHaveProperty("disabled", true);
    expect(onStage).not.toHaveBeenCalled();
  });
});
