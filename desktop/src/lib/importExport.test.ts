import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleImport, handleExport, describeImportResult, importErrorMessage } from "./importExport";
import * as commands from "./commands";

/**
 * Connection transfer files are authorized by Rust File Grants. These tests pin
 * the renderer's half of that contract: the only inputs are a grant request and
 * a grant id, the request never carries a path, and every rejection (no
 * selection, wrong intent, expired, consumed) propagates as a thrown error the
 * UI shows — never as a silent fallback to a renderer-chosen path.
 *
 * The backend's half — that a bare path, a replayed grant, an expired grant and
 * a wrong-intent grant all authorize nothing — is proven in
 * `src-tauri/src/commands/file_io.test.rs`.
 */

const grant = (intent: "read" | "write", id = "grant-1", path = "/tmp/connections.json") => ({
  id,
  path,
  displayName: path.split("/").pop() ?? path,
  intent,
  expiresInSeconds: 300,
});

describe("handleImport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the user cancels (no file was authorized)", async () => {
    const select = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(null);
    const read = vi.spyOn(commands, "readConnectionsFile");

    expect(await handleImport()).toBeNull();
    // Nothing was read: a cancelled picker authorizes nothing.
    expect(read).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("asks for a read-intent grant and never sends a path", async () => {
    const select = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(grant("read", "grant-import"));
    vi.spyOn(commands, "readConnectionsFile").mockResolvedValue("[]");
    vi.spyOn(commands, "importConnections").mockResolvedValue({
      imported: 0,
      skipped: 0,
      skippedRecords: [],
      warnings: [],
    });

    await handleImport();

    expect(select).toHaveBeenCalledTimes(1);
    const request = select.mock.calls[0][0];
    expect(request.intent).toBe("read");
    expect(request.filters).toEqual([{ name: "JSON", extensions: ["json"] }]);
    // The request is intent + dialog metadata only: there is no field a path
    // could travel in.
    expect(Object.keys(request).sort()).toEqual(["filters", "intent", "title"]);
  });

  it("reads through the grant and imports the file's text", async () => {
    const text = '[{"name":"A","db_type":"postgresql","host":"h","port":5432}]';
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(
      grant("read", "grant-import"),
    );
    const read = vi.spyOn(commands, "readConnectionsFile").mockResolvedValue(text);
    const spy = vi.spyOn(commands, "importConnections").mockResolvedValue({
      imported: 1,
      skipped: 0,
      skippedRecords: [],
      warnings: [],
    });

    const result = await handleImport();

    // The grant id — not a path — is what reaches the backend.
    expect(read).toHaveBeenCalledWith("grant-import");
    expect(spy).toHaveBeenCalledWith(text);
    expect(result?.imported).toBe(1);
  });

  it("surfaces a rejected grant instead of importing nothing quietly", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(
      grant("write", "grant-wrong-intent"),
    );
    vi.spyOn(commands, "readConnectionsFile").mockRejectedValue(
      "file-grant-wrong-intent: That file selection was made for a different operation. Choose the file again.",
    );
    const importSpy = vi.spyOn(commands, "importConnections");

    await expect(handleImport()).rejects.toMatch(/file-grant-wrong-intent/);
    expect(importSpy).not.toHaveBeenCalled();
  });
});

describe("handleExport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the user cancels", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(null);
    const write = vi.spyOn(commands, "exportConnectionsToFile");

    expect(await handleExport()).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("asks for a write-intent grant, then publishes through it", async () => {
    const select = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(grant("write", "grant-export", "/path/out.json"));
    const write = vi
      .spyOn(commands, "exportConnectionsToFile")
      .mockResolvedValue("/path/out.json");

    const result = await handleExport();

    const request = select.mock.calls[0][0];
    expect(request.intent).toBe("write");
    expect(request.defaultName).toBe("connections.json");
    expect(Object.keys(request).sort()).toEqual([
      "defaultName",
      "filters",
      "intent",
      "title",
    ]);
    // The destination is the grant's, so the renderer passes the id only.
    expect(write).toHaveBeenCalledWith("grant-export");
    // The path the backend wrote is what the UI reports.
    expect(result).toBe("/path/out.json");
  });

  it("surfaces a consumed or expired grant instead of writing elsewhere", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(
      grant("write", "grant-stale"),
    );
    vi.spyOn(commands, "exportConnectionsToFile").mockRejectedValue(
      "file-grant-expired: The file selection expired five minutes after it was made. Choose the file again.",
    );

    await expect(handleExport()).rejects.toMatch(/file-grant-expired/);
  });
});

describe("importErrorMessage", () => {
  it("reads the backend's plain string rejection", () => {
    expect(importErrorMessage("invalid connection file: expected value")).toBe(
      "invalid connection file: expected value",
    );
  });

  it("reads an Error and an unknown rejection", () => {
    expect(importErrorMessage(new Error("permission denied"))).toBe("permission denied");
    expect(importErrorMessage(undefined)).toBe("unknown error");
  });

  it("passes a grant rejection through verbatim, code included", () => {
    // The UI shows the backend's message; the code prefix makes the state
    // selectable (`lib/fileGrant.ts`).
    expect(
      importErrorMessage("file-grant-invalid: No file selection authorizes this operation."),
    ).toBe("file-grant-invalid: No file selection authorizes this operation.");
  });
});

describe("describeImportResult", () => {
  it("reports a clean import as success", () => {
    const summary = describeImportResult({
      imported: 2,
      skipped: 0,
      skippedRecords: [],
      warnings: [],
    });
    expect(summary.message).toBe("Imported 2 connections.");
    expect(summary.type).toBe("success");
    expect(summary.warnings).toEqual([]);
  });

  it("names each dropped link per record", () => {
    const summary = describeImportResult({
      imported: 1,
      skipped: 1,
      skippedRecords: [{ index: 1, reason: "missing or empty name" }],
      warnings: [
        {
          index: 0,
          name: "Prod",
          message: 'folder "f1" does not exist here; connection imported without a folder',
        },
        {
          index: 0,
          name: "Prod",
          message: 'tag "t1" does not exist here; connection imported without that tag',
        },
      ],
    });
    expect(summary.message).toBe("Imported 1 connection, 1 record skipped, 2 links dropped.");
    expect(summary.type).toBe("error");
    expect(summary.warnings).toEqual([
      'Prod: folder "f1" does not exist here; connection imported without a folder',
      'Prod: tag "t1" does not exist here; connection imported without that tag',
    ]);
  });

  it("reports an empty file without claiming success", () => {
    const summary = describeImportResult({
      imported: 0,
      skipped: 0,
      skippedRecords: [],
      warnings: [],
    });
    expect(summary.message).toBe("No connections imported.");
    expect(summary.type).toBe("info");
  });
});
