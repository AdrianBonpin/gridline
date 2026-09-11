import { useEffect, useState, useMemo } from "react";
import { ChevronRight, ChevronDown, FunctionSquare, GitBranch, ListOrdered, Tag, Puzzle, Layers, Search } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import * as cmd from "../../lib/commands";
import type { FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, HypertableInfo } from "../../lib/types";
import { HypertableDetail } from "./HypertableDetail";

type ObjectType = "functions" | "triggers" | "sequences" | "enums" | "extensions" | "hypertables";

interface ObjectTreeProps {
  type: ObjectType;
  connectionId: string;
}

export const TYPE_LABELS: Record<ObjectType, string> = {
  functions: "functions",
  triggers: "triggers",
  sequences: "sequences",
  enums: "enums",
  extensions: "extensions",
  hypertables: "hypertables",
};

const ICONS: Record<ObjectType, React.ReactNode> = {
  functions: <FunctionSquare size={14} className="text-text-muted shrink-0" />,
  triggers: <GitBranch size={14} className="text-text-muted shrink-0" />,
  sequences: <ListOrdered size={14} className="text-text-muted shrink-0" />,
  enums: <Tag size={14} className="text-text-muted shrink-0" />,
  extensions: <Puzzle size={14} className="text-text-muted shrink-0" />,
  hypertables: <Layers size={14} className="text-text-muted shrink-0" />,
};

/** Object types visible in the dropdown. Hypertables only show when the
 *  connection confirmed TimescaleDB availability (available === true). */
export function visibleObjectTypes(hypertablesAvailable: boolean | null): ObjectType[] {
  const all = Object.keys(TYPE_LABELS) as ObjectType[];
  return hypertablesAvailable === true
    ? all
    : all.filter((t) => t !== "hypertables");
}

function SourceCode({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  const maxLen = 500;
  const truncated = source.length > maxLen && !expanded;
  const display = truncated ? source.slice(0, maxLen) : source;

  return (
    <div className="mt-1">
      <pre className="text-xs text-text-muted bg-surface-raised rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">
        {display}
        {truncated && <span className="text-text-subtle">...</span>}
      </pre>
      {source.length > maxLen && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="text-xs text-accent hover:underline mt-1"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function ObjectTree({ type, connectionId }: ObjectTreeProps) {
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const functions = useDbViewerStore((s) => s.functions);
  const triggers = useDbViewerStore((s) => s.triggers);
  const sequences = useDbViewerStore((s) => s.sequences);
  const enums = useDbViewerStore((s) => s.enums);
  const extensions = useDbViewerStore((s) => s.extensions);
  const hypertables = useDbViewerStore((s) => s.hypertables);
  const setFunctions = useDbViewerStore((s) => s.setFunctions);
  const setTriggers = useDbViewerStore((s) => s.setTriggers);
  const setSequences = useDbViewerStore((s) => s.setSequences);
  const setEnums = useDbViewerStore((s) => s.setEnums);
  const setExtensions = useDbViewerStore((s) => s.setExtensions);
  const setHypertables = useDbViewerStore((s) => s.setHypertables);

  const [loading, setLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Determine which store accessors to use
  const data = useMemo(() => {
    switch (type) {
      case "functions": return functions;
      case "triggers": return triggers;
      case "sequences": return sequences;
      case "enums": return enums;
      case "extensions": return extensions;
      case "hypertables": return hypertables;
    }
  }, [type, functions, triggers, sequences, enums, extensions, hypertables]);

  const setter = useMemo(() => {
    switch (type) {
      case "functions": return setFunctions;
      case "triggers": return setTriggers;
      case "sequences": return setSequences;
      case "enums": return setEnums;
      case "extensions": return setExtensions;
      case "hypertables": return setHypertables;
    }
  }, [type, setFunctions, setTriggers, setSequences, setEnums, setExtensions, setHypertables]);

  // Fetch on mount if not in store
  useEffect(() => {
    if (data !== null) return;
    let cancelled = false;
    setLoading(true);

    const fetchData = async () => {
      try {
        if (type === "extensions") {
          const result = await cmd.getExtensions(connectionId);
          if (!cancelled) (setExtensions as (v: ExtensionInfo[]) => void)(result);
        } else if (type === "functions") {
          const result = await cmd.getFunctions(connectionId, currentSchema ?? undefined);
          if (!cancelled) (setFunctions as (v: FunctionInfo[]) => void)(result);
        } else if (type === "triggers") {
          const result = await cmd.getTriggers(connectionId, currentSchema ?? undefined);
          if (!cancelled) (setTriggers as (v: TriggerInfo[]) => void)(result);
        } else if (type === "sequences") {
          const result = await cmd.getSequences(connectionId, currentSchema ?? undefined);
          if (!cancelled) (setSequences as (v: SequenceInfo[]) => void)(result);
        } else if (type === "enums") {
          const result = await cmd.getEnums(connectionId, currentSchema ?? undefined);
          if (!cancelled) (setEnums as (v: EnumInfo[]) => void)(result);
        } else if (type === "hypertables") {
          const res = await cmd.getHypertables(connectionId, currentSchema ?? undefined);
          if (!cancelled) (setHypertables as (v: HypertableInfo[]) => void)(res.available ? res.items : []);
        }
      } catch {
        // Silently fail — store remains null, we show the empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [type, connectionId, currentSchema, data, setter, setFunctions, setTriggers, setSequences, setEnums, setExtensions, setHypertables]);

  const q = search.toLowerCase().trim();

  const list = useMemo(() => {
    if (!data) return [];
    if (!q) return data;
    return data.filter((item) => {
      const name = "name" in item ? (item as { name: string }).name : "";
      return name.toLowerCase().includes(q);
    });
  }, [data, q]);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const icon = ICONS[type];
  const pluralLabel = TYPE_LABELS[type];

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder={`Search ${pluralLabel}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs bg-surface-raised border border-border rounded text-text placeholder:text-text-subtle focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2" style={{ overscrollBehavior: "none" }}>
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            <div className="w-4 h-4 border-2 border-text-muted border-t-accent rounded-full animate-spin mr-2" />
            Loading {pluralLabel}...
          </div>
        )}

        {!loading && list.length === 0 && (
          <div className="px-3 py-2 text-sm text-text-muted">
            {data === null ? `No ${pluralLabel} found` : `No ${pluralLabel} found`}
          </div>
        )}

        {!loading && list.map((item) => {
          const name = "name" in item ? (item as { name: string }).name : "";
          const key = name;
          const isExpanded = expandedKeys.has(key);

          return (
            <div key={key}>
              <div
                className="group flex items-center gap-1 px-3 py-1 hover:bg-surface-raised cursor-pointer"
                onClick={() => toggle(key)}
              >
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                  className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text cursor-pointer"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {icon}
                <span className="flex-1 text-left text-sm text-text group-hover:text-accent truncate">
                  {name}
                </span>
              </div>

              {isExpanded && (
                <div className="pl-10 pr-3 py-1 space-y-1">
                  {type === "functions" && (() => {
                    const f = item as FunctionInfo;
                    return (
                      <>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Returns:</span> {f.return_type}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Language:</span> {f.language}
                        </div>
                        {f.argument_names.length > 0 && (
                          <div className="text-xs text-text-muted">
                            <span className="text-text-subtle">Args:</span>{" "}
                            {f.argument_names.map((a, i) => (
                              <span key={i}>
                                {f.argument_modes?.[i] && f.argument_modes[i] !== "IN" && (
                                  <span className="text-amber-400">{f.argument_modes[i]} </span>
                                )}
                                {a} <span className="text-text-subtle">({f.argument_types?.[i] || "unknown"})</span>
                                {i < f.argument_names.length - 1 && ", "}
                              </span>
                            ))}
                          </div>
                        )}
                        {f.source && <SourceCode source={f.source} />}
                      </>
                    );
                  })()}

                  {type === "triggers" && (() => {
                    const t = item as TriggerInfo;
                    return (
                      <>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Table:</span> {t.table_schema}.{t.table_name}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Event:</span> {t.event_manipulation}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Timing:</span> {t.action_timing}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Orientation:</span> {t.action_orientation}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Enabled:</span> {t.enabled}
                        </div>
                        {t.action_statement && <SourceCode source={t.action_statement} />}
                      </>
                    );
                  })()}

                  {type === "sequences" && (() => {
                    const s = item as SequenceInfo;
                    return (
                      <>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Current:</span> {s.current_value}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Increment:</span> {s.increment}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Min:</span> {s.min_value}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Max:</span> {s.max_value}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Start:</span> {s.start_value}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Cycle:</span> {s.cycle ? "Yes" : "No"}
                        </div>
                      </>
                    );
                  })()}

                  {type === "enums" && (() => {
                    const e = item as EnumInfo;
                    return (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {e.labels.map((label) => (
                          <span
                            key={label}
                            className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-surface-raised text-text-muted border border-border"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    );
                  })()}

                  {type === "extensions" && (() => {
                    const e = item as ExtensionInfo;
                    return (
                      <>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Version:</span> {e.version}
                        </div>
                        <div className="text-xs text-text-muted">
                          <span className="text-text-subtle">Schema:</span> {e.schema}
                        </div>
                        {e.comment && (
                          <div className="text-xs text-text-muted">
                            <span className="text-text-subtle">Comment:</span> {e.comment}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {type === "hypertables" && (() => {
                    const h = item as HypertableInfo;
                    return (
                      <HypertableDetail
                        item={h}
                        onOpenTable={(schema, table) => useDbViewerStore.getState().openTab(schema, table)}
                      />
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}