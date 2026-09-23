import type { Connection, DbType } from "./types";

export interface ParsedConnectionString {
  db_type: DbType;
  host: string;
  port: number | null;
  username: string | null;
  password: string | null;
  database: string | null;
  /** SSL mode lifted from the URL's `sslmode` / `ssl-mode` query param, or
   *  `null` when absent/unsupported. Keeps managed-PostgreSQL URLs (Neon,
   *  Supabase, …) working — they ship with `?sslmode=require` and the server
   *  rejects a plaintext connection with "connection is insecure". */
  ssl_mode: SslMode | null;
}

/** SSL modes the backend understands (mirrors `DbConfig.ssl_mode`). */
export type SslMode = "disable" | "require" | "verify-ca" | "verify-full";

/** Alternate spellings used by other clients, mapped onto our four modes:
 *  MySQL's `ssl-mode` vocabulary (`REQUIRED`, `VERIFY_IDENTITY`, …) and
 *  plural forms. `allow` / `prefer` are intentionally absent — they permit a
 *  plaintext fallback, which our mode set cannot express, so they return
 *  `null` and the caller keeps its current/default mode. */
const SSL_MODE_ALIASES: Record<string, SslMode> = {
  disable: "disable",
  disabled: "disable",
  require: "require",
  required: "require",
  "verify-ca": "verify-ca",
  "verify-full": "verify-full",
  // MySQL's strongest mode: chain + hostname verification.
  "verify-identity": "verify-full",
};

/**
 * Extract the TLS mode from a connection URL's query string.
 *
 * Accepts libpq's `sslmode` (PostgreSQL) and MySQL's `ssl-mode` spelling,
 * case-insensitively and hyphen/underscore-insensitively (`verify-full`,
 * `verify_full`, `VERIFY-FULL`, …). Unsupported values (`allow`, `prefer`)
 * return `null` so the caller keeps its current/default mode rather than
 * silently downgrading to plaintext.
 */
function parseSslMode(url: URL): SslMode | null {
  let raw: string | null = null;
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (k === "sslmode" || k === "ssl-mode") {
      raw = value;
      break;
    }
  }
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  return SSL_MODE_ALIASES[normalized] ?? null;
}

const DB_PROTOCOLS: Record<string, DbType> = {
  "postgresql:": "postgresql",
  "postgres:": "postgresql",
  "mysql:": "mysql",
  "mariadb:": "mariadb",
  "sqlite:": "sqlite",
  "file:": "sqlite",
  "redis:": "redis",
  "rediss:": "redis",
};

const DEFAULT_PORTS: Record<DbType, number | null> = {
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
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
    ssl_mode: db_type === "postgresql" || db_type === "mysql" || db_type === "mariadb"
      ? parseSslMode(url)
      : null,
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
export function detectProviderFromHost(
  host: string,
): "supabase" | "neon" | "planetscale" | null {
  const h = host.toLowerCase();
  if (h.endsWith(".supabase.co")) return "supabase";
  if (h.endsWith(".neon.tech")) return "neon";
  if (h.endsWith(".psdb.cloud")) return "planetscale";
  return null;
}

/**
 * Suggest a connection label for a freshly pasted connection string, so the
 * connection can be saved without typing a name first.
 *
 * Preference order: the database name, then (for SQLite) the file stem, then
 * the host. Capped at 100 chars to satisfy `validateConnectionInput`, which
 * rejects longer names.
 */
export function suggestConnectionLabel(parsed: ParsedConnectionString): string {
  let label: string;
  if (parsed.db_type === "sqlite") {
    const file = parsed.host.split(/[\\/]/).pop() ?? "";
    label = file.replace(/\.(sqlite3?|db)$/i, "") || file;
  } else {
    label = parsed.database?.replace(/^\/+/, "") || parsed.host;
  }
  return label.trim().slice(0, 100);
}

/**
 * Build a connection URL string from a saved connection, for copying into
 * env vars / other tools. `password` is the decrypted keychain value (or
 * `null` to omit it — e.g. the "no password" copy variant).
 *
 * Formats per DB type:
 *  - postgresql: `postgresql://user:pass@host:port/db?sslmode=...`
 *  - mysql:      `mysql://user:pass@host:port/db`
 *  - sqlite:     `sqlite:///abs/path` (host stores the file path)
 *  - redis:      `redis://user:pass@host:port/db`
 *
 * Username/password/database are percent-encoded; the ssl_mode is appended as
 * a query param for PostgreSQL when set to anything other than `disable`.
 */
export function buildConnectionUrl(conn: Connection, password: string | null): string {
  const enc = (s: string) => encodeURIComponent(s);
  const port = conn.port ? `:${conn.port}` : "";
  const user = conn.username ? enc(conn.username) : "";
  const auth = password
    ? user
      ? `${user}:${enc(password)}@`
      : `:${enc(password)}@`
    : user
      ? `${user}@`
      : "";
  const db = conn.database ? `/${enc(conn.database)}` : "";

  switch (conn.db_type) {
    case "postgresql": {
      const ssl =
        conn.ssl_mode && conn.ssl_mode !== "disable"
          ? `?sslmode=${encodeURIComponent(conn.ssl_mode)}`
          : "";
      return `postgresql://${auth}${conn.host}${port}${db}${ssl}`;
    }
    case "mysql":
      return `mysql://${auth}${conn.host}${port}${db}`;
    case "mariadb":
      return `mariadb://${auth}${conn.host}${port}${db}`;
    case "sqlite":
      // host stores the file path; `sqlite:///abs/path` round-trips through
      // parseConnectionString (pathname → host).
      return `sqlite://${conn.host}`;
    case "redis":
      return `redis://${auth}${conn.host}${port}${db}`;
  }
}
