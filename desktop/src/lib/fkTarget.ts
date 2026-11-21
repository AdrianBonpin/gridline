import type { ColumnInfo } from "./types";

/**
 * The relation a foreign key points at: referenced schema, table and column.
 *
 * The schema travels with the reference because a foreign key may point into
 * another schema. Dropping it (or falling back to the browsing schema) is how a
 * same-named local table used to answer for the referenced one.
 */
export interface FkTarget {
    schema: string;
    table: string;
    column: string;
}

type FkColumn = Pick<ColumnInfo, "is_fk" | "fk_ref">;

/**
 * Resolve the referenced relation of a foreign-key column.
 *
 * `fk_ref` is `[referenced schema, referenced table, referenced column]`. An
 * incomplete reference resolves to `null` rather than a partial target, so no
 * caller can end up addressing a guessed relation.
 */
export function fkTarget(
    col: FkColumn | null | undefined,
): FkTarget | null {
    if (!col?.is_fk || !col.fk_ref) return null;
    const [schema, table, column] = col.fk_ref;
    if (!schema || !table || !column) return null;
    return { schema, table, column };
}

/** `schema.table` — the relation label used in headings and placeholders. */
export function fkRelation(target: FkTarget | null): string {
    return target ? `${target.schema}.${target.table}` : "";
}

/** `schema.table.column` — the full reference shown in cell titles/tooltips. */
export function fkLabel(target: FkTarget | null): string {
    return target ? `${target.schema}.${target.table}.${target.column}` : "";
}
