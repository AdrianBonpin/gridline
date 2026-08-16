import { describe, it, expect, vi } from "vitest";
import { handleImport, handleExport } from "./importExport";
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
      .mockResolvedValue({ imported: 1, skipped: 0, skippedRecords: [] });
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
    vi.spyOn(commands, "exportConnections").mockResolvedValue(
      '{"version":1,"connections":[]}',
    );
    const result = await handleExport();
    expect(result).toBe("/path/out.json");
  });
});