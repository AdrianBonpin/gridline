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
}

const ALL_FALSE: DbCapabilities = {
  explorer: false, queries: false, objects: false, visualizer: false,
  tools: false, editing: false, import: false, ddl: false, objectCrud: false,
};

export const DB_CAPABILITIES: Record<DbType, DbCapabilities> = {
  postgresql: { ...ALL_FALSE, explorer: true, queries: true, objects: true, visualizer: true, tools: true, editing: true, import: true, ddl: true, objectCrud: true },
  mysql:      { ...ALL_FALSE, explorer: true, queries: true, editing: true, import: true, ddl: true },
  sqlite:     { ...ALL_FALSE, explorer: true, queries: true, visualizer: true, editing: true, import: true, ddl: true },
  redis:      { ...ALL_FALSE },
};

/** Safe accessor — unknown types get the all-false capability set. */
export function getCapabilities(dbType: string): DbCapabilities {
  return (DB_CAPABILITIES as Record<string, DbCapabilities>)[dbType] ?? ALL_FALSE;
}