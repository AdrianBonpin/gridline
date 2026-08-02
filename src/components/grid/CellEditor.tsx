import { useState, useRef, useEffect } from "react";

export interface FkOption {
  value: string; // the referenced column's value (what gets committed)
  label: string; // display text (e.g. "42 — Alice" or the referenced column value)
}

interface CellEditorProps {
  initialValue: string;
  dataType: string;
  nullable?: boolean;
  enumValues?: string[];  // when present → render <select> of these values
  fkOptions?: FkOption[]; // when present → render searchable dropdown
  fkPlaceholder?: string; // placeholder for the FK search input
  onCommit: (value: string | null) => void;
  onCancel: () => void;
}

const inputClass =
  "w-full px-1 py-0.5 text-xs bg-surface border border-border rounded font-mono";

export function CellEditor({
  initialValue,
  dataType,
  nullable,
  enumValues,
  fkOptions,
  fkPlaceholder,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [setNull, setSetNull] = useState(initialValue === "" && nullable);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const enumRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enumValues && enumValues.length > 0) {
      enumRef.current?.focus();
    } else if (fkOptions && fkOptions.length > 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    } else {
      ref.current?.focus();
      ref.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const large = ["json", "jsonb", "text"].some((t) =>
    dataType.toLowerCase().includes(t)
  );
  const Tag = large ? "textarea" : "input";

  const commit = () => onCommit(setNull ? null : value);

  const handleSetNull = (checked: boolean) => {
    setSetNull(checked);
    if (checked) onCommit(null);
  };

  // Priority: enum > FK > default input/textarea
  if (enumValues && enumValues.length > 0) {
    return (
      <div className="flex flex-col gap-1 p-1 bg-canvas border border-accent rounded">
        <select
          ref={enumRef}
          className={inputClass}
          value={initialValue}
          onChange={(e) => onCommit(setNull ? null : e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        >
          <option value="">{nullable ? "NULL" : "—"}</option>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {nullable && (
          <label className="flex items-center gap-1 text-[10px] text-text-muted">
            <input
              type="checkbox"
              checked={setNull}
              onChange={(e) => handleSetNull(e.target.checked)}
            />
            Set NULL
          </label>
        )}
      </div>
    );
  }

  if (fkOptions && fkOptions.length > 0) {
    const q = query.trim().toLowerCase();
    const filtered = q === "" ? fkOptions : fkOptions.filter((o) => o.label.toLowerCase().includes(q));
    return (
      <div className="flex flex-col gap-1 p-1 bg-canvas border border-accent rounded">
        <input
          ref={searchRef}
          aria-label="Search foreign key options"
          placeholder={fkPlaceholder ?? "Search…"}
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length > 0) onCommit(filtered[0].value);
              else onCommit(query);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <div className="max-h-28 overflow-y-auto bg-canvas border border-border rounded-md shadow-lg">
          {filtered.length === 0 && (
            <div className="px-2 py-1 text-xs text-text-muted">No matches</div>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="block w-full px-2 py-1 hover:bg-surface text-xs text-left"
              onClick={() => onCommit(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {nullable && (
          <label className="flex items-center gap-1 text-[10px] text-text-muted">
            <input
              type="checkbox"
              checked={setNull}
              onChange={(e) => handleSetNull(e.target.checked)}
            />
            Set NULL
          </label>
        )}
      </div>
    );
  }

  const cls = large ? `${inputClass} h-6 resize-none overflow-y-auto leading-none` : inputClass;
  return (
    <div className="flex flex-col gap-1 p-1 bg-canvas border border-accent rounded">
      <Tag
        ref={ref as any}
        className={cls}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSetNull(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {nullable && (
        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          <input
            type="checkbox"
            checked={setNull}
            onChange={(e) => handleSetNull(e.target.checked)}
          />
          Set NULL
        </label>
      )}
    </div>
  );
}