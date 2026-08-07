import type { DbType } from "./types";

export interface DbCapabilities {
  /** Table browser + data grid. */
  explorer: boolean;
  /** SQL editor + history/saved. */
  queries: boolean;
  /** Functions/triggers/sequences/enums/extensions. */
  objects: boolean;
  /** ER schema diagram. */
  visualizer: boolean;
  /** Backup / restore / sync. */
  tools: boolean;
  /** Inline cell edits + changes queue. */
  editing: boolean;
  /** CSV/JSON import. */
  import: boolean;
  /** Copy table schema (DDL). */
  ddl: boolean;
  /** Create / edit / drop PostgreSQL objects via the changes queue. */
  objectCrud: boolean;
  /** Table maintenance (VACUUM/ANALYZE/REINDEX) + rebuild-table. */
  maintenance: boolean;
  /** Role browsing/management. */
  roles: boolean;
  /** Rebuild-table (rewrite in place) support. */
  tableManagement: boolean;
}

const ALL_FALSE: DbCapabilities = {
  explorer: false, queries: false, objects: false, visualizer: false,
  tools: false, editing: false, import: false, ddl: false, objectCrud: false,
  maintenance: false, roles: false, tableManagement: false,
};

export const DB_CAPABILITIES: Record<DbType, DbCapabilities> = {
  postgresql: { ...ALL_FALSE, explorer: true, queries: true, objects: true, visualizer: true, tools: true, editing: true, import: true, ddl: true, objectCrud: true, maintenance: true, roles: true, tableManagement: true },
  mysql:      { ...ALL_FALSE, explorer: true, queries: true, editing: true, import: true, ddl: true, tools: true },
  sqlite:     { ...ALL_FALSE, explorer: true, queries: true, visualizer: true, editing: true, import: true, ddl: true, tools: true, tableManagement: true },
  redis:      { ...ALL_FALSE },
};

/** Safe accessor — unknown types get the all-false capability set. */
export function getCapabilities(dbType: string): DbCapabilities {
  return (DB_CAPABILITIES as Record<string, DbCapabilities>)[dbType] ?? ALL_FALSE;
}