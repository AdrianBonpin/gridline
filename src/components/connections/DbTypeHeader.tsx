import { DB_ICONS, DB_LABELS } from "../../lib/dbIcons";
import type { DbType } from "../../lib/types";

interface DbTypeHeaderProps {
  db_type: DbType;
}

export function DbTypeHeader({ db_type }: DbTypeHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-xl">
        {DB_ICONS[db_type] ?? "❓"}
      </div>
      <div className="font-heading text-lg text-text">{DB_LABELS[db_type] ?? db_type}</div>
    </div>
  );
}