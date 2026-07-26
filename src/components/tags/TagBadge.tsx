import type { Tag } from "../../lib/types";

interface TagBadgeProps {
  tag: Tag;
  active?: boolean;
  onToggle?: (id: string) => void;
}

export function TagBadge({ tag, active = false, onToggle }: TagBadgeProps) {
  const Comp = onToggle ? "button" : "span";
  return (
    <Comp
      onClick={onToggle ? () => onToggle(tag.id) : undefined}
      className={`text-xs px-2 py-0.5 rounded-full border border-border bg-surface-raised text-text-muted transition-colors ${onToggle ? "cursor-pointer hover:text-text hover:border-border-hover" : ""} ${active ? "text-text border-border-hover" : ""}`}
    >
      {tag.name}
    </Comp>
  );
}