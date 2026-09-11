import { AlertCircle, Info } from "lucide-react";
import type { MultiQueryResult, QueryResult } from "../../lib/types";

export function ResultSetPanels({
  multi,
  renderGrid,
}: {
  multi: MultiQueryResult;
  renderGrid: (set: QueryResult, index: number) => React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {multi.result_sets.map((set, i) => (
        <section key={i} className="border-b border-border flex flex-col min-h-0">
          <header className="px-3 py-1.5 text-xs text-text-muted bg-surface-raised border-b border-border flex items-center gap-2 shrink-0">
            <span className="font-medium text-text">Result {i + 1}</span>
            <span>— {set.total_rows} row{set.total_rows === 1 ? "" : "s"}</span>
          </header>
          <div className="min-h-0" style={{ height: Math.min(Math.max(set.rows.length * 28 + 32, 160), 480) }}>
            {renderGrid(set, i)}
          </div>
        </section>
      ))}
      {multi.notices.map((n, i) => (
        <div
          key={i}
          role={n.kind === "error" ? "alert" : "status"}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border ${
            n.kind === "error" ? "text-red-400" : "text-text-muted"
          }`}
        >
          {n.kind === "error" ? <AlertCircle size={13} /> : <Info size={13} />}
          <span className="font-medium">Statement {n.statement_index + 1}</span>
          <span className="truncate">{n.text}</span>
          {n.affected !== null && n.affected !== undefined && (
            <span>({n.affected} rows affected)</span>
          )}
        </div>
      ))}
    </div>
  );
}
