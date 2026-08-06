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

/// A browsable object row — the per-kind detail fields the CRUD helpers read.
/// All fields beyond `schema`/`name` are optional per object kind.
export interface CrudItem {
  schema: string;
  name: string;
  table?: string;
  table_name?: string;
  table_type?: string;
  materialized?: boolean;
  labels?: string[];
  definition?: string;
  argument_types?: string[];
}

/**
 * Initial dialog params for a create/edit operation.
 * Create starts empty (schema prefilled); edit prefills from the item.
 */
export function initialCrudParams(
  kind: ObjectKind,
  item: CrudItem,
  mode: "create" | "edit",
): DdlParams {
  const schema = item.schema;
  switch (kind) {
    case "sequence":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: {
          op: "create",
          increment: "1",
          min_value: "1",
          max_value: "9223372036854775807",
          start: "1",
          cycle: false,
        },
      };
    case "enum":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: {
          op: "create",
          labels: mode === "edit" ? (item.labels ?? []) : [],
        },
      };
    case "extension":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: { op: "create", version: null },
      };
    case "view":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        materialized: false,
        action: {
          op: "create",
          definition: mode === "edit" ? (item.definition ?? "") : "",
        },
      };
    case "index":
      return {
        schema,
        table: item.table ?? "",
        name: "",
        action: { op: "create", unique: false, method: "", columns: [], predicate: null },
      };
    case "constraint":
      return {
        schema,
        table: item.table ?? "",
        name: "",
        action: { op: "check", expression: "" },
      };
    case "function":
    case "procedure":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        is_procedure: kind === "procedure",
        action: {
          op: "create_or_replace",
          args: [],
          return_type: null,
          language: "plpgsql",
          body: "",
          volatility: null,
          strict: false,
        },
      };
    case "trigger":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: {
          op: "create",
          table: item.table_name ?? "",
          timing: "BEFORE",
          events: ["INSERT"],
          orientation: "ROW",
          function_schema: schema,
          function_name: "",
          function_args: [],
          when: null,
        },
      };
  }
}

/**
 * Minimal params that drop the object, carrying any per-kind context
 * (owning table, argument types, materialized flag, …).
 */
export function dropCrudParams(kind: ObjectKind, item: CrudItem): DdlParams {
  const base = { schema: item.schema, name: item.name };
  if (kind === "trigger") {
    return {
      ...base,
      action: { op: "drop", table: item.table ?? item.table_name ?? "" },
    };
  }
  if (kind === "index" || kind === "constraint") {
    return {
      ...base,
      schema: item.schema,
      table: item.table ?? "",
      name: item.name,
      action: { op: "drop" },
    };
  }
  if (kind === "view") {
    return {
      ...base,
      materialized: item.table_type === "m" || item.materialized === true,
      action: { op: "drop" },
    };
  }
  if (kind === "function" || kind === "procedure") {
    return {
      ...base,
      is_procedure: kind === "procedure",
      action: { op: "drop", arg_types: item.argument_types ?? [] },
    };
  }
  return { ...base, action: { op: "drop" } };
}

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