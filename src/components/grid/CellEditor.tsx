import { useState, useRef, useEffect } from "react";

interface CellEditorProps {
  initialValue: string;
  dataType: string;
  nullable?: boolean;
  onCommit: (value: string | null) => void;
  onCancel: () => void;
}

export function CellEditor({ initialValue, dataType, nullable, onCommit, onCancel }: CellEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [setNull, setSetNull] = useState(initialValue === "" && nullable);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const large = ["json", "jsonb", "text"].some((t) => dataType.toLowerCase().includes(t));
  const Tag = large ? "textarea" : "input";

  const commit = () => onCommit(setNull ? null : value);
  return (
    <div className="flex flex-col gap-1 p-1 bg-canvas border border-accent rounded">
      <Tag
        ref={ref as any}
        className="w-full px-1 py-0.5 text-xs bg-surface border border-border rounded font-mono"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSetNull(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
      {nullable && (
        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          <input type="checkbox" checked={setNull} onChange={(e) => setSetNull(e.target.checked)} />
          Set NULL
        </label>
      )}
    </div>
  );
}