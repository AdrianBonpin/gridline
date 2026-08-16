import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { importConnections, exportConnections } from "./commands";
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