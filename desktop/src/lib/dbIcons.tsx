import { siPostgresql, siMysql, siMariadb, siSqlite, siRedis, siSupabase, siNeon, siPlanetscale } from "simple-icons";
import type { DbType } from "./types";

// Brand colors from simple-icons
const DB_COLORS: Record<DbType, string> = {
  postgresql: `#${siPostgresql.hex}`,
  mysql: `#${siMysql.hex}`,
  mariadb: `#${siMariadb.hex}`,
  redis: `#${siRedis.hex}`,
  sqlite: `#${siSqlite.hex}`,
};

// SVG path data for each DB icon
const DB_PATHS: Record<DbType, string> = {
  postgresql: siPostgresql.path,
  mysql: siMysql.path,
  mariadb: siMariadb.path,
  redis: siRedis.path,
  sqlite: siSqlite.path,
};

export const DB_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  redis: "Redis",
  sqlite: "SQLite",
};

interface DbIconProps {
  type: DbType;
  size?: number;
  className?: string;
}

export function DbIcon({ type, size = 20, className }: DbIconProps) {
  const path = DB_PATHS[type];
  const color = DB_COLORS[type];
  if (!path) return <span className="text-lg">❓</span>;

  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={path} />
    </svg>
  );
}

// Keep backward compat for any legacy emoji usage
export const DB_ICONS: Record<DbType, string> = {
  postgresql: "🐘",
  mysql: "🐬",
  mariadb: "🦭",
  redis: "⚡",
  sqlite: "🗄️",
};

// ── Managed-PostgreSQL provider icons (Supabase, NeonDB) ──────────
// These are NOT DbType values; connections persist as db_type="postgresql".
type ProviderIconId = "supabase" | "neon" | "planetscale";

const PROVIDER_ICON_DATA: Record<ProviderIconId, { hex: string; path: string }> = {
  supabase: { hex: `#${siSupabase.hex}`, path: siSupabase.path },
  neon: { hex: `#${siNeon.hex}`, path: siNeon.path },
  planetscale: { hex: `#${siPlanetscale.hex}`, path: siPlanetscale.path },
};

export const PROVIDER_LABELS: Record<ProviderIconId, string> = {
  supabase: "Supabase",
  neon: "NeonDB",
  planetscale: "PlanetScale",
};

interface ProviderIconProps {
  id: ProviderIconId;
  size?: number;
  className?: string;
}

export function ProviderIcon({ id, size = 20, className }: ProviderIconProps) {
  const data = PROVIDER_ICON_DATA[id];
  if (!data) return <span className="text-lg">❓</span>;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={data.hex}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={data.path} />
    </svg>
  );
}