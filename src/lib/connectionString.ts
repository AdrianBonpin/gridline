import type { DbType } from "./types";

export interface ParsedConnectionString {
  db_type: DbType;
  host: string;
  port: number | null;
  username: string | null;
  password: string | null;
  database: string | null;
}

const DB_PROTOCOLS: Record<string, DbType> = {
  "postgresql:": "postgresql",
  "postgres:": "postgresql",
  "mysql:": "mysql",
  "sqlite:": "sqlite",
  "file:": "sqlite",
  "redis:": "redis",
  "rediss:": "redis",
};

const DEFAULT_PORTS: Record<DbType, number | null> = {
  postgresql: 5432,
  mysql: 3306,
  sqlite: null,
  redis: 6379,
};

export function parseConnectionString(input: string): ParsedConnectionString | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const db_type = DB_PROTOCOLS[url.protocol];
  if (!db_type) return null;

  const port = url.port ? Number(url.port) : (DEFAULT_PORTS[db_type] ?? null);
  const username = url.username || null;
  const password = url.password || null;
  const pathname = url.pathname;

  let host: string;
  let database: string | null;
  if (db_type === "sqlite") {
    // SQLite: the file path lives in the URL pathname. Map it to `host`
    // (the field the backend opens) and leave `database` null. `url.pathname`
    // always starts with "/"; the fallback covers `sqlite://path` (no
    // pathname) where the URL's hostname holds the relative path.
    host = pathname || url.hostname || "";
    database = null;
  } else {
    host = url.hostname || "localhost";
    database = pathname.replace(/^\//, "") || null;
  }

  return {
    db_type,
    host,
    port,
    username,
    password,
    database,
  };
}

export function looksLikeConnectionString(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return !!DB_PROTOCOLS[url.protocol];
  } catch {
    return false;
  }
}

/** Detect a managed-PostgreSQL provider from a connection host, purely for
 *  UI highlighting. Returns `"supabase"` / `"neon"` / `null`. db_type is
 *  unaffected (both presets persist as `postgresql`). */
export function detectProviderFromHost(host: string): "supabase" | "neon" | null {
  const h = host.toLowerCase();
  if (h.endsWith(".supabase.co")) return "supabase";
  if (h.endsWith(".neon.tech")) return "neon";
  return null;
}
