import {
  exportConnectionsToFile,
  importConnections,
  readConnectionsFile,
  selectFileForGrant,
} from "./commands";
import { errorText } from "./utils";
import type { ImportResult } from "./types";

/**
 * Connection transfer files are authorized by Rust File Grants, not by paths.
 *
 * The renderer asks the backend to show the native picker (`selectFileForGrant`)
 * and receives a grant id plus display metadata; the grant is intent-scoped
 * (read for import, write for export), valid for five minutes and consumed by
 * the command that touches the file. A path typed or patched into the renderer
 * therefore authorizes nothing: there is no code path here that could name a
 * file for the backend to open or overwrite.
 */

export async function handleImport(): Promise<ImportResult | null> {
  const grant = await selectFileForGrant({
    intent: "read",
    title: "Import connections from",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!grant) return null; // cancelled: nothing was authorized
  const json = await readConnectionsFile(grant.id);
  return importConnections(json);
}

export async function handleExport(): Promise<string | null> {
  const grant = await selectFileForGrant({
    intent: "write",
    title: "Export connections as",
    defaultName: "connections.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!grant) return null; // cancelled: nothing was authorized
  // Returns the path the backend published to, which is what the UI reports.
  return exportConnectionsToFile(grant.id);
}

/**
 * A rejected import has to read like a message, whatever the boundary threw:
 * Tauri rejects a failed command with the backend's plain string (including the
 * `file-grant-*` states), while a JS-level failure arrives as an `Error`.
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
