import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import * as cmd from "../../lib/commands";
import type { ObjectSearchHit, ObjectType } from "../../lib/types";

const TYPE_TO_OBJECTS: Record<string, ObjectType> = {
  FUNCTION: "functions",
  PROCEDURE: "procedures",
  TRIGGER: "triggers",
  SEQUENCE: "sequences",
  ENUM: "enums",
  EXTENSION: "extensions",
  INDEX: "indexes",
  CONSTRAINT: "constraints",
};

interface ObjectSearchPaletteProps {
  connectionId: string;
}

export function ObjectSearchPalette({ connectionId }: ObjectSearchPaletteProps) {
  const open = useDbViewerStore((s) => s.objectSearchOpen);
  const setOpen = useDbViewerStore((s) => s.setObjectSearchOpen);
  const storeSchema = useDbViewerStore((s) => s.currentSchema);
  const currentSchema = storeSchema ?? "public";
  const openTab = useDbViewerStore((s) => s.openTab);
  const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);
  const setSelectedObjectType = useDbViewerStore((s) => s.setSelectedObjectType);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ObjectSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the transient state whenever the palette is closed so it reopens
  // with an empty search and no stale results.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // Debounced search against the current schema.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!query.trim()) {
      setHits([]);
      setLoading(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await cmd.searchObjects(
          connectionId,
          currentSchema,
          query,
        );
        setHits(results);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [query, connectionId, currentSchema]);

  // Esc closes the palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  if (!open) return null;

  const grouped = hits.reduce<Record<string, ObjectSearchHit[]>>((acc, hit) => {
    const list = acc[hit.object_type] ?? [];
    list.push(hit);
    acc[hit.object_type] = list;
    return acc;
  }, {});

  const handleSelect = (hit: ObjectSearchHit) => {
    if (
      hit.object_type === "TABLE" ||
      hit.object_type === "VIEW" ||
      hit.object_type === "MATERIALIZED VIEW"
    ) {
      openTab(hit.schema, hit.name);
    } else {
      setCurrentSchema(hit.schema);
      setSelectedObjectType(
        TYPE_TO_OBJECTS[hit.object_type] ?? "functions",
      );
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Search objects"
    >
      <div
        className="w-[520px] max-h-[60vh] overflow-auto rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={14} className="text-text-muted" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search objects in current schema…"
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
          />
          {loading && (
            <span className="text-xs text-text-muted">loading</span>
          )}
        </div>

        {Object.entries(grouped).map(([type, list]) => (
          <div key={type}>
            <div className="px-3 py-1 text-[10px] uppercase text-text-subtle">
              {type}
            </div>
            {list.map((hit) => (
              <button
                key={`${hit.object_type}:${hit.schema}:${hit.name}`}
                type="button"
                onClick={() => handleSelect(hit)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text hover:bg-surface-raised"
              >
                <span className="truncate">{hit.name}</span>
                <span className="text-[10px] text-text-subtle">
                  {hit.schema}
                </span>
              </button>
            ))}
          </div>
        ))}

        {!loading && query.trim() && hits.length === 0 && (
          <div className="px-3 py-4 text-sm text-text-muted">No matches</div>
        )}
      </div>
    </div>
  );
}