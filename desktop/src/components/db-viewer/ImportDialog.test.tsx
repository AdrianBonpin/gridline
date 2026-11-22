import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportDialog } from "./ImportDialog";
import { readImportFile, selectFileForGrant } from "../../lib/commands";
import type { ImportTargetColumn } from "../../lib/importConvert";

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

interface Source {
  text: string;
  bytes?: number;
}

function grantSource({ text, bytes }: Source) {
  vi.mocked(readImportFile).mockResolvedValue({
    text,
    displayName: "f.csv",
    bytes: bytes ?? text.length,
  });
}

const cols = (...pairs: Array<[string, string]>): ImportTargetColumn[] =>
  pairs.map(([name, dataType]) => ({ name, dataType }));

function renderDialog(
  columns: ImportTargetColumn[],
  onStage = vi.fn(),
  onClose = () => {},
) {
  render(
    <ImportDialog open schema="public" table="t" columns={columns} onStage={onStage} onClose={onClose} />,
  );
  return onStage;
}

async function chooseFile() {
  fireEvent.click(screen.getByRole("button", { name: /choose file/i }));
  await waitFor(() => expect(selectFileForGrant).toHaveBeenCalledWith(
    expect.objectContaining({ intent: "read" }),
  ));
}

describe("ImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectFileForGrant).mockResolvedValue(readGrant());
    grantSource({ text: "a,b\n1,2\n3,4" });
  });

  it("reads the granted file and stages a bulk_insert change", async () => {
    const addChange = renderDialog(cols(["a", "text"], ["b", "text"]));
    await chooseFile();

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
    grantSource({ text: "a\n" + "1\n".repeat(100_001) });
    const onStage = renderDialog(cols(["a", "text"]));
    await chooseFile();
    await waitFor(() => expect(screen.getByText(/limit/i)).toBeInTheDocument());
    expect(onStage).not.toHaveBeenCalled();
  });

  // ── Positional source columns ────────────────────────────────────────────
  // Two source columns can share a header. Keying the mapping by header would
  // copy one column's values into both targets.
  it("keeps duplicate source headers apart by position", async () => {
    grantSource({ text: "id,id\n001,002" });
    const onStage = renderDialog(cols(["left_id", "text"], ["right_id", "text"]));
    await chooseFile();
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /stage import/i }));
    await waitFor(() => expect(onStage).toHaveBeenCalled());
    expect(onStage.mock.calls[0][0].columns).toEqual(["left_id", "right_id"]);
    expect(onStage.mock.calls[0][0].rows).toEqual([["001", "002"]]);
  });

  it("rejects mapping the same target column twice", async () => {
    grantSource({ text: "a,b\n1,2" });
    const onStage = renderDialog(cols(["a", "text"], ["b", "text"]));
    await chooseFile();
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());

    // Map the second source column onto the first target as well.
    fireEvent.change(screen.getByLabelText(/map b/i), { target: { value: "a" } });

    await waitFor(() => expect(screen.getByText(/more than once|twice/i)).toBeInTheDocument());
    const stage = screen.getByRole("button", { name: /stage import/i });
    expect(stage).toHaveProperty("disabled", true);
    fireEvent.click(stage);
    expect(onStage).not.toHaveBeenCalled();
  });

  // ── Type-driven conversion ──────────────────────────────────────────────
  it("converts by declared type, not by appearance", async () => {
    grantSource({ text: "zip,big,n\n007,9007199254740993,2" });
    const onStage = renderDialog(
      cols(["zip", "character varying"], ["big", "bigint"], ["n", "integer"]),
    );
    await chooseFile();
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /stage import/i }));
    await waitFor(() => expect(onStage).toHaveBeenCalled());
    expect(onStage.mock.calls[0][0].rows).toEqual([["007", "9007199254740993", "2"]]);
  });

  it("reports the row and column of an invalid value and stages nothing", async () => {
    grantSource({ text: "name,age\nada,36\ngrace,not-a-number" });
    const onStage = renderDialog(cols(["name", "text"], ["age", "integer"]));
    await chooseFile();
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /stage import/i }));

    const report = await waitFor(() => screen.getByText(/not a valid integer/i));
    expect(report.textContent).toMatch(/row 2/i);
    expect(report.textContent).toMatch(/column "age"/i);
    expect(onStage).not.toHaveBeenCalled();
  });

  // ── Pre-staging validation of malformed input ────────────────────────────
  it("reports an unbalanced quote before anything is staged", async () => {
    grantSource({ text: 'a,b\n"1,2' });
    const onStage = renderDialog(cols(["a", "text"], ["b", "text"]));
    await chooseFile();

    await waitFor(() => expect(screen.getByText(/unterminated quoted field/i)).toBeInTheDocument());
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("reports an inconsistent row width before anything is staged", async () => {
    grantSource({ text: "a,b\n1,2\n3" });
    const onStage = renderDialog(cols(["a", "text"], ["b", "text"]));
    await chooseFile();

    await waitFor(() => expect(screen.getByText(/row 2/i)).toBeInTheDocument());
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("checks the byte limit before parsing the source", async () => {
    // The text is also malformed CSV: if the size check ran after parsing, the
    // quote error would win. The byte report has to come first.
    grantSource({ text: 'a,b\n"1,2', bytes: 100 * 1024 * 1024 + 1 });
    const onStage = renderDialog(cols(["a", "text"], ["b", "text"]));
    await chooseFile();

    await waitFor(() => expect(screen.getByText(/limit/i)).toBeInTheDocument());
    expect(screen.queryByText(/unterminated quote/i)).toBeNull();
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("shows a grant rejection and stages nothing", async () => {
    vi.mocked(readImportFile).mockRejectedValue(
      new Error("file-grant-consumed: That file selection was already used by another job."),
    );
    const onStage = renderDialog(cols(["a", "text"]));
    await chooseFile();

    await waitFor(() =>
      expect(screen.getByText(/already used by another job/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(screen.getByRole("button", { name: /stage import/i })).toHaveProperty("disabled", true);
    expect(onStage).not.toHaveBeenCalled();
  });
});
