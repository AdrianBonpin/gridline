import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { importConnections, exportConnections } from "./commands";
import { errorText } from "./utils";
import type { ImportResult } from "./types";

export async function handleImport(): Promise<ImportResult | null> {
  const filePath = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return null;
  const json = await readTextFile(filePath);
  return importConnections(json);
}

export async function handleExport(): Promise<string | null> {
  const filePath = await save({
    defaultPath: "connections.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!filePath) return null;
  const json = await exportConnections();
  await writeTextFile(filePath, json);
  return filePath;
}

/**
 * A rejected import has to read like a message, whatever the boundary threw:
 * Tauri rejects a failed command with the backend's plain string, while the
 * file plugins reject with an `Error`.
 */
export function importErrorMessage(error: unknown): string {
  return errorText(error);
}

export interface ImportSummary {
  message: string;
  type: "success" | "error" | "info";
  /** One line per dropped link, naming the record it belonged to. */
  warnings: string[];
}

/**
 * Turn an import report into something the user can act on: how much landed,
 * what was skipped, and which links were dropped from which record.
 */
export function describeImportResult(result: ImportResult): ImportSummary {
  const imported = result.imported ?? 0;
  const skipped = result.skipped ?? 0;
  const warnings = (result.warnings ?? []).map((w) => `${w.name}: ${w.message}`);

  const parts: string[] = [
    imported === 1 ? "Imported 1 connection" : `Imported ${imported} connections`,
  ];
  if (imported === 0) parts[0] = "No connections imported";
  if (skipped > 0) parts.push(skipped === 1 ? "1 record skipped" : `${skipped} records skipped`);
  if (warnings.length > 0) {
    parts.push(warnings.length === 1 ? "1 link dropped" : `${warnings.length} links dropped`);
  }

  const type: ImportSummary["type"] =
    skipped > 0 ? "error" : imported === 0 || warnings.length > 0 ? "info" : "success";

  return { message: `${parts.join(", ")}.`, type, warnings };
}
