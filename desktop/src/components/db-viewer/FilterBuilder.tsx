import { useState } from "react";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { defaultFilterOperator } from "../grid/gridEditability";
import type { ColumnInfo } from "../../lib/types";
import type { FilterRule, FilterOperator } from "../../stores/dbViewerStore";

interface Props {
  columns: ColumnInfo[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
}

function Chip({ col, onAdd }: { col: ColumnInfo; onAdd: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `col-${col.name}`,
    data: { column: col },
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onAdd}
      className={`px-2 py-1 text-xs rounded border border-border bg-surface text-text hover:border-accent ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {col.name}
    </button>
  );
}

const OPERATORS: FilterOperator[] = [
  "eq",
  "neq",
  "contains",
  "starts",
  "ends",
  "gt",
  "lt",
  "null",
  "notnull",
];

export function FilterBuilder({ columns, rules, onChange }: Props) {
  const [val, setVal] = useState<Record<string, string>>({});

  const addRule = (col: ColumnInfo) => {
    const op = defaultFilterOperator(col.data_type);
    onChange([
      ...rules,
      {
        id: `f-${Date.now()}-${col.name}`,
        column: col.name,
        operator: op,
        value: "",
      },
    ]);
  };

  const { setNodeRef, isOver } = useDroppable({ id: "filter-dropzone" });

  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const update = (id: string, patch: Partial<FilterRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <DndContext
      onDragEnd={(e) => {
        const id = e.active.id as string;
        const colName = id.replace(/^col-/, "");
        const col = columns.find((c) => c.name === colName);
        if (col && e.over?.id === "filter-dropzone") addRule(col);
      }}
    >
      <div className="flex flex-wrap gap-1 mb-2">
        {columns.map((c) => (
          <Chip key={c.name} col={c} onAdd={() => addRule(c)} />
        ))}
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[40px] border border-dashed rounded p-2 space-y-1 ${
          isOver ? "border-accent bg-surface" : "border-border"
        }`}
      >
        {rules.length === 0 && (
          <span className="text-xs text-text-muted">
            Drop columns here to add filters
          </span>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <span className="text-text font-semibold">{r.column}</span>
            <select
              value={r.operator}
              onChange={(e) =>
                update(r.id, { operator: e.target.value as FilterOperator })
              }
              className="bg-surface border border-border rounded px-1"
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {!["null", "notnull"].includes(r.operator) && (
              <input
                value={val[r.id] ?? r.value}
                onChange={(e) => {
                  setVal({ ...val, [r.id]: e.target.value });
                  update(r.id, { value: e.target.value });
                }}
                className="bg-surface border border-border rounded px-1 flex-1"
                placeholder="value"
              />
            )}
            <button
              aria-label={`Remove filter ${r.column}`}
              onClick={() => remove(r.id)}
              className="text-text-muted hover:text-red-400"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </DndContext>
  );
}