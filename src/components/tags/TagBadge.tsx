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
      className={`text-xs px-2 py-0.5 rounded ${onToggle ? "cursor-pointer hover:brightness-125" : ""} ${active ? "brightness-150" : ""}`}
      style={{ backgroundColor: `${tag.color}33`, color: tag.color }}
    >
      {tag.name}
    </Comp>
  );
}