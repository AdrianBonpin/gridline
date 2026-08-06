import { invoke } from "@tauri-apps/api/core";

// NOTE on argument key naming: Tauri v2 converts Rust snake_case command
// parameter names to camelCase on the IPC boundary (connection_id ->
// connectionId). Single-word params (kind, params) are unchanged.

/// The object kinds supported by the Rust build_ddl dispatcher.
export type ObjectKind =
  | "sequence"
  | "enum"
  | "view"
  | "extension"
  | "index"
  | "constraint"
  | "function"
  | "procedure"
  | "trigger";

/// Opaque payload for a build: `{ schema, name, action: { op, ... } }`.
/// The concrete shape is validated server-side by each kind's params struct.
export type DdlParams = Record<string, unknown>;

/// An installable extension from pg_available_extensions.
export interface AvailableExtension {
  name: string;
  version: string;
  comment: string | null;
}

/** Build one or more SQL statements for an object CRUD operation. */
export async function buildObjectDdl(
  connectionId: string,
  kind: ObjectKind,
  params: DdlParams,
): Promise<string[]> {
  return invoke<string[]>("build_object_ddl", { connectionId, kind, params });
}

/** List extensions available for install on the current server. */
export async function getAvailableExtensions(
  connectionId: string,
): Promise<AvailableExtension[]> {
  return invoke<AvailableExtension[]>("get_available_extensions", {
    connectionId,
  });
}