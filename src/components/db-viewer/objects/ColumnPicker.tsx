interface Props {
  cols: string[];
  selected: string[];
  onToggle: (col: string) => void;
}

export function ColumnPicker({ cols, selected, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="column-picker">
      {cols.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onToggle(c)}
          className={`text-xs px-2 py-1 rounded-lg border ${
            selected.includes(c)
              ? "bg-accent text-white border-accent"
              : "border-border text-text"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}