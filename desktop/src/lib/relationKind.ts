import type { TableInfo } from "./types";

/**
 * The kind of relation a table-tree row represents.
 *
 * A view and a materialized view are browsable relations, but neither is a
 * table: their rows are derived, `ALTER TABLE`/`DROP TABLE` do not address
 * them, and a non-materialized view rejects indexing and maintenance. Offering
 * an action that the server will refuse is the bug this models away.
 */
export type RelationKind = "table" | "view" | "materialized_view";

/** Normalize a `TableInfo.table_type` (or a raw catalog string) to a kind. */
export function relationKindOf(
  tableType: TableInfo["table_type"] | string | null | undefined,
): RelationKind {
  const t = (tableType ?? "").trim().toUpperCase().replace(/_/g, " ");
  if (t === "VIEW") return "view";
  if (t === "MATERIALIZED VIEW") return "materialized_view";
  return "table";
}

/**
 * Table-overflow actions, grouped by what they address: the relation's rows /
 * shape (`table`) or only its contents read-only (`any`).
 */
export type TableActionId =
  | "open"
  | "copy-schema"
  | "export"
  | "import"
  | "create_index"
  | "create_constraint"
  | "edit_table"
  | "maintenance"
  | "empty"
  | "drop";

/**
 * Whether `action` is valid for `kind`.
 *
 * - Reads (`open`, `copy-schema`, `export`) apply to every kind.
 * - `create_index` and maintenance address the physical relation, which
 *   materialized views are but plain views are not.
 * - Row writes (`import`, `empty`) and shape/identity changes
 *   (`edit_table`, `create_constraint`) address a table only.
 * - `drop` here stages a `drop_table`, so it addresses a table only. Views are
 *   dropped by their own object kind elsewhere.
 */
export function relationSupportsAction(
  action: TableActionId,
  kind: RelationKind,
): boolean {
  switch (action) {
    case "open":
    case "copy-schema":
    case "export":
      return true;
    case "create_index":
    case "maintenance":
      return kind !== "view";
    case "import":
    case "create_constraint":
    case "edit_table":
    case "empty":
    case "drop":
      return kind === "table";
  }
}
