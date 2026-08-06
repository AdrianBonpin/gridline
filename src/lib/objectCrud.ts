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
  | "trigger"
  | "table"
  | "role";

/// Opaque payload for a build: `{ schema, name, action: { op, ... } }`.
/// The concrete shape is validated server-side by each kind's params struct.
export type DdlParams = Record<string, unknown>;

/// A browsable object row — the per-kind detail fields the CRUD helpers read.
/// All fields beyond `schema`/`name` are optional per object kind.
/// (The extra fields mirror the real per-kind shapes in `src/lib/types.ts`
/// and are consumed by `initialCrudParams` on edit.)
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
  // function / procedure (FunctionInfo)
  return_type?: string | null;
  argument_names?: string[];
  argument_modes?: string[];
  language?: string;
  source?: string | null;
  kind?: string;
  // sequence (SequenceInfo)
  start_value?: string;
  min_value?: string;
  max_value?: string;
  increment?: string;
  cycle?: boolean;
  // trigger (TriggerInfo)
  event_manipulation?: string;
  action_timing?: string;
  action_orientation?: string;
  enabled?: string;
  // extension (ExtensionInfo)
  version?: string | null;
  // index (IndexInfo)
  is_unique?: boolean;
  method?: string;
  columns?: string[];
  // constraint (ConstraintInfo)
  contype?: "CHECK" | "UNIQUE" | "EXCLUSION";
  // table (columnMeta carries the snapshot for edit diffs)
  columnMeta?: { name: string; type: string; nullable: boolean; is_pk: boolean; default: string | null }[];
  // role (RoleInfo shape used for prefill)
  superuser?: boolean;
  inherit?: boolean;
  create_db?: boolean;
  create_role?: boolean;
  can_login?: boolean;
  replication?: boolean;
  bypass_rls?: boolean;
  connection_limit?: number;
  valid_until?: string | null;
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
          increment: mode === "edit" ? (item.increment ?? "1") : "1",
          min_value: mode === "edit" ? (item.min_value ?? "1") : "1",
          max_value:
            mode === "edit"
              ? (item.max_value ?? "9223372036854775807")
              : "9223372036854775807",
          start: mode === "edit" ? (item.start_value ?? "1") : "1",
          cycle: mode === "edit" ? (item.cycle ?? false) : false,
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
        action: {
          op: "create",
          version: mode === "edit" ? (item.version ?? null) : null,
        },
      };
    case "view":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        materialized:
          mode === "edit"
            ? item.table_type === "MATERIALIZED VIEW" || item.materialized === true
            : false,
        action: {
          op: "create",
          definition: mode === "edit" ? (item.definition ?? "") : "",
        },
      };
    case "index":
      return {
        schema,
        table: item.table ?? "",
        name: mode === "edit" ? item.name : "",
        action: {
          op: "create",
          unique: mode === "edit" ? (item.is_unique ?? false) : false,
          method: mode === "edit" ? (item.method ?? "") : "",
          columns: mode === "edit" ? (item.columns ?? []) : [],
          predicate: null,
        },
      };
    case "constraint":
      return {
        schema,
        table: item.table ?? "",
        name: mode === "edit" ? item.name : "",
        action:
          mode === "edit"
            ? item.contype === "UNIQUE"
              ? { op: "unique", columns: item.columns ?? [] }
              : { op: "check", expression: item.definition ?? "" }
            : { op: "check", expression: "" },
      };
    case "function":
    case "procedure":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        is_procedure: kind === "procedure",
        action: {
          op: "create_or_replace",
          args:
            mode === "edit"
              ? (item.argument_names ?? []).map((n, i) => ({
                  mode: item.argument_modes?.[i] ?? "in",
                  name: n,
                  type: item.argument_types?.[i] ?? "",
                }))
              : [],
          return_type: mode === "edit" ? (item.return_type ?? null) : null,
          language: mode === "edit" ? (item.language ?? "plpgsql") : "plpgsql",
          body: mode === "edit" ? (item.source ?? "") : "",
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
          timing:
            mode === "edit" ? (item.action_timing ?? "BEFORE") : "BEFORE",
          events:
            mode === "edit"
              ? (item.event_manipulation ?? "INSERT")
                  .split(/[,|]|\s+OR\s+/i)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : ["INSERT"],
          orientation:
            mode === "edit"
              ? (item.action_orientation ?? "ROW").toUpperCase()
              : "ROW",
          function_schema: schema,
          function_name: "",
          function_args: [],
          when: null,
        },
      };
    case "table":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: {
          op: mode === "edit" ? "edit" : "create",
          columns: mode === "edit"
            ? (item.columnMeta ?? []).map((c) => ({
                name: c.name, type: c.type, nullable: c.nullable,
                default: c.default ?? null, is_pk: c.is_pk,
              }))
            : [],
          old_columns: mode === "edit" ? (item.columnMeta ?? []) : undefined,
        },
      };
    case "role":
      return {
        schema,
        name: mode === "edit" ? item.name : "",
        action: {
          op: "create",
          login: mode === "edit" ? (item.can_login ?? false) : false,
          superuser: mode === "edit" ? (item.superuser ?? false) : false,
          createdb: mode === "edit" ? (item.create_db ?? false) : false,
          createrole: mode === "edit" ? (item.create_role ?? false) : false,
          inherit: mode === "edit" ? (item.inherit ?? true) : true,
          replication: mode === "edit" ? (item.replication ?? false) : false,
          bypassrls: mode === "edit" ? (item.bypass_rls ?? false) : false,
          connection_limit: mode === "edit" ? (item.connection_limit ?? -1) : -1,
          valid_until: mode === "edit" ? (item.valid_until ?? "") : "",
          password: "",
          members: [],
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
  if (kind === "table" || kind === "role") {
    return { ...base, action: { op: "drop" } };
  }
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