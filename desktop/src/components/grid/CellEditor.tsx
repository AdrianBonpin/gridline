import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export interface FkOption {
  value: string; // the referenced column's value (what gets committed)
  label: string; // fallback display text (e.g. "42 — Alice")
  /** Referenced row cells shown in one row (≤5 columns), FK-reference style. */
  cells?: { name: string; value: string }[];
}

const MAX_FK_CELLS = 4;
const FK_DROPDOWN_WIDTH = 360;

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
  "min-w-0 flex-1 bg-transparent px-3 font-heading text-xs text-text outline-none placeholder:text-text-muted";
const controlClass =
  "min-w-0 flex-1 rounded bg-surface px-2 py-1 font-heading text-xs text-text outline-none placeholder:text-text-muted";

/** Types that tolerate an empty string when NOT NULL ('' is a valid value). */
const TEXT_LIKE = ["char", "text", "uuid", "bit"];

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
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const enumRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [fkDropdownPos, setFkDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const textLike = TEXT_LIKE.some((t) => dataType.toLowerCase().includes(t));

  useLayoutEffect(() => {
    if (fkOptions && fkOptions.length > 0 && searchRef.current) {
      const r = searchRef.current.getBoundingClientRect();
      let left = r.left;
      if (left + FK_DROPDOWN_WIDTH > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - FK_DROPDOWN_WIDTH - 16);
      }
      setFkDropdownPos({
        top: r.bottom + 4,
        left,
        width: FK_DROPDOWN_WIDTH,
      });
    }
  }, [fkOptions]);

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

  /**
   * Constraint-aware commit resolution:
   * - Empty input on a nullable column → NULL (smart "clear = null").
   * - Empty input on a NOT NULL column → only text-ish types may fall back to
   *   an empty string; everything else is blocked with an error.
   */
  const resolveCommit = (
    raw: string,
  ): { value: string | null } | { error: string } => {
    if (raw.trim() === "") {
      if (nullable) return { value: null };
      if (textLike) return { value: raw };
      return { error: "This column cannot be NULL" };
    }
    return { value: raw };
  };

  const commitRaw = (raw: string) => {
    const r = resolveCommit(raw);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    onCommit(r.value);
  };

  const commit = () => commitRaw(value);

  const errorRect = error ? rootRef.current?.getBoundingClientRect() : null;
  const errorBubble =
    error && errorRect
      ? createPortal(
          <div
            data-testid="cell-editor-error"
            className="fixed z-50 pointer-events-none rounded-md border border-red-500/50 bg-red-950/95 px-2 py-1 text-[10px] text-red-300 shadow-lg"
            style={{ top: errorRect.bottom + 4, left: errorRect.left, maxWidth: 320 }}
          >
            {error}
          </div>,
          document.body,
        )
      : null;

  // Priority: enum > FK > default input/textarea
  if (enumValues && enumValues.length > 0) {
    return (
      <div ref={rootRef} className={`flex h-full w-full items-center gap-1.5 px-1.5 ${error ? "ring-1 ring-inset ring-red-500/60" : ""}`}>
        <select
          ref={enumRef}
          className={controlClass}
          value={initialValue}
          onChange={(e) => commitRaw(e.target.value)}
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
        {errorBubble}
      </div>
    );
  }

  if (fkOptions && fkOptions.length > 0) {
    const q = query.trim().toLowerCase();
    const fkSearchText = (o: FkOption) =>
    [
      o.label,
      ...(o.cells ?? []).map((c) => `${c.name}:${c.value}`),
    ]
      .join(" ")
      .toLowerCase();

  const filtered =
    q === ""
      ? fkOptions
      : fkOptions.filter((o) => fkSearchText(o).includes(q));
    return (
      <div ref={rootRef} className={`flex h-full w-full items-center gap-1.5 px-1.5 ${error ? "ring-1 ring-inset ring-red-500/60" : ""}`}>
        <input
          ref={searchRef}
          aria-label="Search foreign key options"
          placeholder={fkPlaceholder ?? "Search…"}
          className={controlClass}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered.length > 0) commitRaw(filtered[0].value);
              else commitRaw(query);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {fkDropdownPos &&
        createPortal(
          <div
            data-testid="fk-options"
            style={{
              position: "fixed",
              top: fkDropdownPos.top,
              left: fkDropdownPos.left,
              width: fkDropdownPos.width,
              minWidth: fkDropdownPos.width,
              zIndex: 50,
            }}
            className="max-h-28 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl"
          >
          {nullable && (
            <button
              type="button"
              className="block w-full px-3 py-1.5 hover:bg-surface-raised text-xs text-left italic text-text-muted"
              onClick={() => commitRaw("")}
            >
              NULL
            </button>
          )}
          {filtered.length === 0 && (
            <div className="px-2 py-1 text-xs text-text-muted">No matches</div>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="block w-full px-3 py-1.5 hover:bg-surface-raised text-xs text-left"
              onClick={() => commitRaw(o.value)}
            >
              {o.cells && o.cells.length > 0 ? (
                <span className="flex items-center gap-0 min-w-0">
                  {o.cells.slice(0, MAX_FK_CELLS).map((c, ci) => (
                    <span key={ci} className="flex items-center min-w-0">
                      {ci > 0 && (
                        <span className="mx-1.5 h-3 w-px bg-border shrink-0" />
                      )}
                      {c.value === "" ? (
                        <span className="italic text-text-muted">NULL</span>
                      ) : (
                        <span className="truncate text-text">{c.value}</span>
                      )}
                    </span>
                  ))}
                </span>
              ) : (
                o.label
              )}
            </button>
          ))}
            </div>,
            document.body,
          )}
        {errorBubble}
      </div>
    );
  }

  const cls = large
    ? `${inputClass} h-4 resize-none overflow-y-auto whitespace-pre leading-none py-0.5`
    : inputClass;
  return (
    <div
      ref={rootRef}
      data-testid="cell-editor"
      className={`flex h-full w-full items-center gap-2 ${error ? "ring-1 ring-inset ring-red-500/60" : ""}`}
    >
      <Tag
        ref={ref as any}
        className={cls}
        placeholder={nullable && value === "" ? "NULL" : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
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
      {errorBubble}
    </div>
  );
}