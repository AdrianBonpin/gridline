interface BadgeProps {
  label: string;
  color: string;
  onClick?: () => void;
}

export function Badge({ label, color, onClick }: BadgeProps) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded ${onClick ? "cursor-pointer hover:brightness-125" : ""}`}
      style={{ backgroundColor: `${color}33`, color }}
    >
      {label}
    </Comp>
  );
}