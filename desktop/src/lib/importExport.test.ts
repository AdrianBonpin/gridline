import { describe, it, expect, vi } from "vitest";
import { handleImport, handleExport, describeImportResult, importErrorMessage } from "./importExport";
import * as commands from "./commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("handleImport", () => {
  it("returns null when user cancels (no file selected)", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as any).mockResolvedValue(null);
    const result = await handleImport();
    expect(result).toBeNull();
  });
  it("imports and reloads when a file is selected", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    (open as any).mockResolvedValue("/path/to/connections.json");
    (readTextFile as any).mockResolvedValue(
      '[{"name":"A","db_type":"postgresql","host":"h","port":5432}]',
    );
    const spy = vi
      .spyOn(commands, "importConnections")
      .mockResolvedValue({ imported: 1, skipped: 0, skippedRecords: [], warnings: [] });
    const result = await handleImport();
    expect(spy).toHaveBeenCalled();
    expect(result?.imported).toBe(1);
  });
});

describe("handleExport", () => {
  it("returns null when user cancels", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    (save as any).mockResolvedValue(null);
    const result = await handleExport();
    expect(result).toBeNull();
  });
  it("exports to selected path", async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    (save as any).mockResolvedValue("/path/out.json");
    (writeTextFile as any).mockResolvedValue(undefined);
    (writeTextFile as any).mockClear();
    const exported = '{"version":1,"connections":[]}';
    vi.spyOn(commands, "exportConnections").mockResolvedValue(exported);
    const result = await handleExport();
    expect(result).toBe("/path/out.json");
    // The bytes the backend produced are what reach the file: nothing re-wraps
    // or trims the versioned envelope on the way out.
    expect(writeTextFile).toHaveBeenCalledWith("/path/out.json", exported);
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
