/**
 * One normalisation of a *declared* SQL column type, shared by every consumer
 * that classifies a column by the type the server reports.
 *
 * The introspected spellings differ per engine and per column — `NUMERIC(12, 4)`,
 * `bigint unsigned`, `character varying(64)`, `int4` — while the decisions they
 * feed (is this numeric? is this a calendar date? is this an integer?) only care
 * about the base type. Two copies of this normalisation had already drifted
 * (one stripped `varying`, the other did not), so it lives here once.
 *
 * This is a *classification* helper, not a type parser: modifiers are dropped,
 * not interpreted. The Rust-side `mysql_cell_kind` stays separate — it maps a
 * driver's declared type onto a value decoder, which is a different concern.
 */
export function baseDeclaredType(dataType: string | null | undefined): string {
  return (dataType ?? "")
    .toLowerCase()
    .split("(")[0]
    .replace(/\b(unsigned|zerofill|varying)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
