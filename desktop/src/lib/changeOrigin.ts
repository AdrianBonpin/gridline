import type { Connection } from "./types";

/**
 * Change Origin — the exact saved connection, selected database, and
 * connection-target configuration a staged change belongs to (GLOSSARY.md).
 *
 * A staged change is never committed against a different origin: the Changes
 * Queue for one origin is invisible to every other origin, and Commit All
 * validates the origin instead of trusting the currently active connection
 * identifier alone. See `docs/superpowers/specs/2026-11-21-github-audit-hardening.md`.
 */

/**
 * The parts of a saved connection that determine *where writes land*.
 *
 * Deliberately excludes presentation/organization metadata (name, folder,
 * tags, environment, favorite, keychain reference) — renaming or refiling a
 * connection must not invalidate pending work — and excludes secrets, which
 * are never part of any identity.
 */
export type ConnectionTargetFields = Pick<
  Connection,
  | "db_type"
  | "host"
  | "port"
  | "username"
  | "database"
  | "ssh_host"
  | "ssh_port"
  | "ssh_user"
  | "ssh_auth_method"
  | "ssh_private_key_path"
  | "ssl_mode"
  | "ssl_ca_path"
  | "ssl_cert_path"
  | "ssl_key_path"
>;

/** Fields compared for target identity, in a fixed order (stable fingerprint). */
const TARGET_FIELDS: (keyof ConnectionTargetFields)[] = [
  "db_type",
  "host",
  "port",
  "username",
  "database",
  "ssh_host",
  "ssh_port",
  "ssh_user",
  "ssh_auth_method",
  "ssh_private_key_path",
  "ssl_mode",
  "ssl_ca_path",
  "ssl_cert_path",
  "ssl_key_path",
];

/** A connection-target configuration: opaque fingerprint + readable label. */
export interface ConnectionTarget {
  /** Stable, comparable value. Equal fingerprint = same target configuration. */
  fingerprint: string;
  /** Human-readable description, for visible refusal messages. */
  label: string;
}

/** The immutable Change Origin carried by every staged change. */
export interface ChangeOrigin {
  /** Saved connection id the change was staged from. */
  connectionId: string;
  /** Database selected at staging time ("" when the engine has no selection). */
  database: string;
  /** `ConnectionTarget.fingerprint` of the saved connection at staging time. */
  target: string;
  /** `ConnectionTarget.label` of that configuration, for messages. */
  targetLabel: string;
}

/** Anything that carries a Change Origin — queue items, and (later) tabs. */
export interface Originated {
  origin: ChangeOrigin | null;
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
}

/**
 * Fingerprint + label a saved connection's target configuration.
 *
 * The fingerprint changes whenever the connection would connect somewhere
 * else (host, port, user, database, SSH endpoint or TLS material), which is
 * what makes a retargeted connection refuse work staged against the old one.
 */
export function connectionTarget(connection: ConnectionTargetFields): ConnectionTarget {
  const fingerprint = TARGET_FIELDS.map(
    (field) => `${field}=${normalize(connection[field])}`,
  ).join("|");

  const userPart = connection.username ? `${connection.username}@` : "";
  const portPart = connection.port ? `:${normalize(connection.port)}` : "";
  const dbPart = connection.database ? `/${connection.database}` : "";
  let label = `${connection.db_type} ${userPart}${normalize(connection.host)}${portPart}${dbPart}`;
  if (connection.ssh_host) {
    const sshUserPart = connection.ssh_user ? `${connection.ssh_user}@` : "";
    const sshPortPart = connection.ssh_port ? `:${normalize(connection.ssh_port)}` : "";
    label += ` via ssh ${sshUserPart}${normalize(connection.ssh_host)}${sshPortPart}`;
  }
  if (connection.ssl_mode) {
    label += ` (tls ${connection.ssl_mode})`;
  }
  return { fingerprint, label };
}

/** Build the Change Origin for a saved connection + the database it is viewing. */
export function changeOriginFor(
  connection: { id: string } & ConnectionTargetFields,
  database: string | null | undefined,
): ChangeOrigin {
  const target = connectionTarget(connection);
  return {
    connectionId: connection.id,
    database: database ?? "",
    target: target.fingerprint,
    targetLabel: target.label,
  };
}

/**
 * Full origin identity: same saved connection, same selected database, and the
 * connection target unchanged since staging. Only this may be committed.
 */
export function isSameChangeOrigin(
  a: ChangeOrigin | null | undefined,
  b: ChangeOrigin | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.connectionId === b.connectionId &&
    a.database === b.database &&
    a.target === b.target
  );
}

/**
 * Grouping identity: same saved connection and selected database, regardless of
 * a retarget. Work staged before the saved connection was retargeted stays
 * visible under this target so the refusal can be specific instead of the work
 * silently disappearing.
 */
export function isSameChangeTarget(
  a: ChangeOrigin | null | undefined,
  b: ChangeOrigin | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.connectionId === b.connectionId && a.database === b.database;
}

/**
 * Only the active origin's work is exposed. A missing active origin exposes
 * nothing: un-owned work is never offered for commit.
 */
export function itemsForChangeTarget<T extends Originated>(
  items: readonly T[],
  active: ChangeOrigin | null,
): T[] {
  if (!active) return [];
  return items.filter((item) => isSameChangeTarget(item.origin, active));
}

/** Short description of an origin for messages, e.g. `postgresql dev@h:5432/db (database analytics)`. */
export function describeChangeOrigin(origin: ChangeOrigin): string {
  return `${origin.targetLabel} (database ${origin.database || "default"})`;
}

/**
 * Explain a retargeted connection refusal in terms of both configurations, so
 * the user knows exactly why the staged work cannot be applied.
 */
export function describeRetargeting(staged: ChangeOrigin, active: ChangeOrigin): string {
  return (
    `This pending work was staged against ${describeChangeOrigin(staged)}, ` +
    `but the saved connection now targets ${describeChangeOrigin(active)}. ` +
    `Revert or clear those changes, or reconnect and stage them again.`
  );
}
