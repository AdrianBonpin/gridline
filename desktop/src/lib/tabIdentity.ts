import {
  describeChangeOrigin,
  isSameChangeTarget,
  type ChangeOrigin,
} from "./changeOrigin";

/**
 * Viewer identity and freshness (spec 2026-11-21, "Persistence, import, and UI").
 *
 * A tab belongs to the connection **and** the database it was opened on, so
 * refreshing or revisiting a tab can never silently query a newly selected
 * database under the old tab's identity. Tab identity includes the tab kind and
 * its Change Origin — a display label is never an identity, so a query, an
 * object, and a table that share a label stay distinct tabs.
 *
 * Metadata caches (autocomplete, expanded tree columns) are scoped by the same
 * origin so one environment's columns can never be offered in another, and the
 * scope key is invalidated after relevant DDL/reconnects.
 */

/** The tab kinds the viewer can open. */
export type ViewerTabKind = "table" | "query" | "object" | "objectForm";

/** The parts of a viewer tab that establish its identity and freshness. */
export interface TabLike {
  tabType: ViewerTabKind;
  /** The origin the tab was opened on (absent on hand-built fixtures). */
  origin?: ChangeOrigin | null;
  schema: string;
  table: string;
  /** Object tabs: the object kind (function, trigger, …). */
  objectType?: unknown;
  /** Query tabs opened from a file. */
  filePath?: string;
}

/** A candidate tab identity, used by the store's dedup on open. */
export interface TabIdentity {
  tabType: ViewerTabKind;
  origin?: ChangeOrigin | null;
  schema?: string;
  table?: string;
  objectType?: unknown;
  filePath?: string;
}

/**
 * Do two tabs belong to the same connection + database?
 *
 * Deliberately ignores the connection's *target* fingerprint: retargeting a
 * saved connection does not split its tabs in two, it makes their freshness a
 * question for {@link tabDataIsCurrent}. Two absent origins (no saved
 * connection) count as the same unknown target.
 */
export function sameTabOrigin(
  a: ChangeOrigin | null,
  b: ChangeOrigin | null,
): boolean {
  if (!a || !b) return a === b;
  return isSameChangeTarget(a, b);
}

/**
 * May this tab's data requests run against the viewer's live target?
 *
 * A tab whose recorded origin database (or connection) differs from the live
 * target must never be queried: the pool is connected somewhere else, so the
 * result would be another environment's rows under this tab's identity. A tab
 * with no recorded origin carries nothing to contradict, so it is allowed.
 */
export function tabDataIsCurrent(
  tabOrigin: ChangeOrigin | null,
  live: ChangeOrigin | null,
): boolean {
  if (!tabOrigin) return true;
  if (!live) return false;
  return sameTabOrigin(tabOrigin, live);
}

/**
 * Is `b` the same tab as `a`? Kind + Change Origin + the object shown.
 *
 * - a table and a query tab labelled `users` are different tabs
 * - the same table name in two databases/connections is two tabs
 * - plain query tabs (no file) are always distinct: the label is a caption, and
 *   two scratchpads named `Query` must be able to coexist
 * - a file-backed query tab is identified by origin + path, so renaming/editing
 *   it focuses the same tab
 */
export function isSameTab(a: TabLike, b: TabIdentity): boolean {
  if (a.tabType !== b.tabType) return false;
  if (!sameTabOrigin(a.origin ?? null, b.origin ?? null)) return false;

  if (a.tabType === "query") {
    if (!a.filePath || !b.filePath) return false;
    return a.filePath === b.filePath;
  }

  if (a.schema !== b.schema || a.table !== b.table) return false;
  if (a.tabType === "object") return a.objectType === b.objectType;
  return true;
}

/** Explain why a tab is not current, naming both targets. */
export function outOfOriginReason(
  tabOrigin: ChangeOrigin | null,
  live: ChangeOrigin | null,
): string {
  const belongsTo = tabOrigin
    ? describeChangeOrigin(tabOrigin)
    : "an unknown database";
  const nowOn = live ? describeChangeOrigin(live) : "an unknown database";
  return (
    `These rows came from ${belongsTo}, but the viewer is now on ${nowOn}, ` +
    `so they are not current. Switch the database back and this tab re-queries it.`
  );
}

/** A table a committed change touched. */
export interface TableRef {
  schema: string;
  table: string;
}

/** The queue item shape this module needs (structurally, to stay store-free). */
export interface ChangeRef {
  type: string;
  schema?: string | null;
  table?: string | null;
}

/**
 * The tables a set of committed changes touched, each once and in commit order.
 *
 * A change with no table (a database-wide DDL, for instance) has no table-level
 * refresh target — the schema tree and metadata caches still get invalidated.
 */
export function tablesAffectedByChanges(
  changes: readonly ChangeRef[],
): TableRef[] {
  const seen = new Set<string>();
  const out: TableRef[] = [];
  for (const change of changes) {
    const schema = change.schema ?? "";
    const table = change.table ?? "";
    if (!table) continue;
    const key = `${schema}\u0000${table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ schema, table });
  }
  return out;
}

/**
 * Every tab of `origin` that shows a table a committed change touched — the
 * tabs that must be refreshed after Commit All.
 */
export function tabsAffectedByChanges<T extends TabLike>(
  tabs: readonly T[],
  changes: readonly ChangeRef[],
  origin: ChangeOrigin | null,
): T[] {
  const affected = tablesAffectedByChanges(changes);
  if (affected.length === 0) return [];
  return tabs.filter(
    (tab) =>
      (tab.tabType === "table" || tab.tabType === "object") &&
      sameTabOrigin(tab.origin ?? null, origin) &&
      affected.some((ref) => ref.schema === tab.schema && ref.table === tab.table),
  );
}

/** The origin a metadata cache entry belongs to: connection + selected database. */
export interface MetadataScope {
  connectionId: string | null;
  database: string | null;
}

/** Stable cache scope for a connection + database pair. */
export function metadataScopeKey(scope: MetadataScope): string {
  return `${scope.connectionId ?? ""}\u0000${scope.database ?? ""}`;
}

/** Cache key for one table's columns inside a metadata scope. */
export function columnCacheKey(
  scope: MetadataScope,
  schema: string,
  table: string,
): string {
  return `${metadataScopeKey(scope)}\u0000${schema}\u0000${table}`;
}
