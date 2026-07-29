import { siPostgresql, siMysql, siSqlite, siRedis } from "simple-icons";
import type { DbType } from "./types";

// Brand colors from simple-icons
const DB_COLORS: Record<DbType, string> = {
  postgresql: `#${siPostgresql.hex}`,
  mysql: `#${siMysql.hex}`,
  redis: `#${siRedis.hex}`,
  sqlite: `#${siSqlite.hex}`,
};

// SVG path data for each DB icon
const DB_PATHS: Record<DbType, string> = {
  postgresql: siPostgresql.path,
  mysql: siMysql.path,
  redis: siRedis.path,
  sqlite: siSqlite.path,
};

export const DB_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
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
  redis: "⚡",
  sqlite: "🗄️",
};