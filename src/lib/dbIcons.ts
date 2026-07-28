import type { DbType } from "./types";

export const DB_ICONS: Record<DbType, string> = {
  postgresql: "🐘",
  mysql: "🐬",
  redis: "⚡",
  sqlite: "🗄️",
};

export const DB_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  sqlite: "SQLite",
};