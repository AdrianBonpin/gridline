import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Copy, AlertTriangle, GitCompare } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { compareSchemas, getSchemas, getDatabases } from "../../lib/commands";
import { useConnectionStore } from "../../stores/connectionStore";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { DiffItem, DiffReport } from "../../lib/types";

const TYPE_ORDER = ["enum", "sequence", "table", "column", "constraint", "index", "view"];

const KIND_BADGE: Record<string, string> = {
  added: "text-emerald-400 border-emerald-400/40",
  removed: "text-red-400 border-red-400/40",
  changed: "text-amber-400 border-amber-400/40",
};

/** Threshold above which the diff report is rendered through a virtualizer
 * (the snapshot cap can reach ~10k cards). Small diffs render plain, which
 * keeps jsdom tests deterministic and behavior-neutral below the threshold. */
const VIRTUALIZE_THRESHOLD = 200;

function familyOf(dbType: string): string {
  return dbType === "mysql" || dbType === "mariadb" ? "mysql" : dbType;
}

function SchemaDiffItemCard({ item }: { item: DiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 ${KIND_BADGE[item.kind]}`}>{item.kind}</span>
        <span className="text-text">{item.name}</span>
        {item.destructive && (
          <span className="flex items-center gap-1 text-text-muted">
            <AlertTriangle size={12} className="text-red-400" /> Destructive — copy only
          </span>
        )}
      </div>
      {item.detail.map((d, di) => (
        <div key={di} className="mt-1 text-text-muted">
          {d.label}: <span className="line-through">{d.old || "∅"}</span> → {d.new || "∅"}
        </div>
      ))}
      {item.sync_sql.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-text-muted">SQL</summary>
          <pre className="mt-1 rounded bg-surface-raised p-2 overflow-x-auto text-[11px]">{item.sync_sql.join("\n")}</pre>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(item.sync_sql.join("\n"))}
            className="mt-1 text-text-muted hover:text-text cursor-pointer"
          >
            Copy
          </button>
        </details>
      )}
    </div>
  );
}

export function SchemaDiffPage({ connectionId }: { connectionId: string }) {
  const connections = useConnectionStore((s) => s.connections);
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const currentConnection = connections.find((c) => c.id === connectionId);
  const family = familyOf(currentConnection?.db_type ?? "postgresql");

  const [sourceId, setSourceId] = useState<string>("");
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [sourceSchema, setSourceSchema] = useState<string>("");
  const [targetSchema, setTargetSchema] = useState<string>(currentSchema ?? "public");
  const [report, setReport] = useState<DiffReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameFamilySources = useMemo(
    () => connections.filter((c) => c.id !== connectionId && familyOf(c.db_type) === family),
    [connections, connectionId, family],
  );

  const pickSource = async (id: string) => {
    setSourceId(id);
    setSourceSchema("");
    setSourceSchemas([]);
    if (!id) return;
    // Set a synchronous default so "Run diff" works before the async schema
    // fetch resolves (the source must already be connected). The fetch below
    // refines it to the source's actual first schema.
    setSourceSchema(family === "mysql" ? "" : family === "sqlite" ? "main" : "public");
    try {
      // The source must already be connected (opened in the DB viewer) for
      // capture — getSchemas/getDatabases and compare_schemas error clearly
      // if not. We do not auto-connect here.
      const schemas =
        family === "mysql"
          ? await getDatabases(id)
          : family === "sqlite"
            ? ["main"]
            : await getSchemas(id);
      setSourceSchemas(schemas);
      setSourceSchema(schemas[0] ?? "");
    } catch (e) {
      setError(`Source connection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Auto-select the first same-family source on mount so "Run diff" works
  // without manual selection (the source must already be connected).
  useEffect(() => {
    if (sourceId === "" && sameFamilySources.length > 0) {
      void pickSource(sameFamilySources[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameFamilySources, sourceId]);

  const runDiff = async () => {
    if (!sourceId || !sourceSchema || !targetSchema) return;
    setRunning(true);
    setError(null);
    try {
      const r = await compareSchemas(sourceId, sourceSchema, connectionId, targetSchema);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const stageAll = () => {
    if (!report) return;
    useDbViewerStore.getState().addDiffItems(report.items);
  };

  const copyAll = () => {
    if (!report) return;
    const sql = report.items.flatMap((i) => i.sync_sql).join("\n");
    void navigator.clipboard?.writeText(sql);
  };

  const grouped = useMemo(() => {
    if (!report) return [] as [string, DiffItem[]][];
    const byType = new Map<string, DiffItem[]>();
    for (const it of report.items) {
      const list = byType.get(it.object_type) ?? [];
      list.push(it);
      byType.set(it.object_type, list);
    }
    return [...byType.entries()].sort(
      (a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]),
    );
  }, [report]);

  const flattenedItems = report ? report.items : [];
  const shouldVirtualize = flattenedItems.length > VIRTUALIZE_THRESHOLD;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  const stageableCount = report
    ? report.items.filter((i) => !i.destructive && i.sync_sql.length > 0).length
    : 0;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="px-3 pt-3 pb-3 border-b border-border shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <GitCompare size={14} className="text-text-muted" />
          <span className="text-text-muted">Compare a source connection's schema against this connection (same engine family).</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={sourceId}
            onChange={(e) => void pickSource(e.target.value)}
            className="rounded-lg bg-surface-raised border border-border px-2 py-1"
            aria-label="Source connection"
          >
            <option value="">Source connection…</option>
            {sameFamilySources.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={sourceSchema}
            onChange={(e) => setSourceSchema(e.target.value)}
            disabled={!sourceId}
            className="rounded-lg bg-surface-raised border border-border px-2 py-1 disabled:opacity-50"
            aria-label="Source schema"
          >
            {sourceSchemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-text-muted">→</span>
          <select
            value={targetSchema}
            onChange={(e) => setTargetSchema(e.target.value)}
            className="rounded-lg bg-surface-raised border border-border px-2 py-1"
            aria-label="Target schema"
          >
            <option value={targetSchema}>{targetSchema}</option>
          </select>
          <button
            type="button"
            onClick={() => void runDiff()}
            disabled={running || !sourceId || !sourceSchema}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-accent-foreground disabled:opacity-50 cursor-pointer"
          >
            <Play size={13} /> {running ? "Diffing…" : "Run diff"}
          </button>
          {report && stageableCount > 0 && (
            <button
              type="button"
              onClick={stageAll}
              className="rounded-lg bg-surface-raised border border-border px-2.5 py-1 hover:bg-surface cursor-pointer"
            >
              Stage {stageableCount} safe item{stageableCount === 1 ? "" : "s"}
            </button>
          )}
          {report && report.items.length > 0 && (
            <button
              type="button"
              onClick={copyAll}
              className="flex items-center gap-1 rounded-lg bg-surface-raised border border-border px-2.5 py-1 hover:bg-surface cursor-pointer"
            >
              <Copy size={13} /> Copy all SQL
            </button>
          )}
        </div>
        {report?.truncated && (
          <div className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle size={13} /> Snapshot capped at 5,000 objects per side — report is truncated.
          </div>
        )}
        {error && <div className="text-xs text-red-400" role="alert">{error}</div>}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {report && report.items.length === 0 && (
          <div className="text-xs text-text-muted">Schemas are identical — no differences found.</div>
        )}
        {shouldVirtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <SchemaDiffItemCard item={flattenedItems[vi.index]} />
              </div>
            ))}
          </div>
        ) : (
          grouped.map(([type, items]) => (
            <section key={type}>
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1.5">{type}s</h3>
              <div className="space-y-1.5">
                {items.map((it) => (
                  <SchemaDiffItemCard key={`${it.object_type}-${it.name}`} item={it} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
