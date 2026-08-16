import { Copy, Braces, Pencil, CircleSlash, Link2, Eye, MousePointerClick } from "lucide-react";

interface Props {
  anchorRect: DOMRect;
  editable: boolean;
  isJson: boolean;
  isFk: boolean;
  nullable: boolean;
  onCopy: () => void; onCopyJson: () => void; onEdit: () => void;
  onSetNull: () => void; onOpenFk: () => void; onClose: () => void;
  onViewRow: () => void; onSelectRow: () => void;
}
export function CellContextMenu({ anchorRect, editable, isJson, isFk, nullable, onCopy, onCopyJson, onEdit, onSetNull, onOpenFk, onClose, onViewRow, onSelectRow }: Props) {
  const items: { label: string; icon: React.ReactNode; onClick: () => void; show: boolean }[] = [
    { label: "Copy", icon: <Copy size={12} />, onClick: () => { onCopy(); onClose(); }, show: true },
    { label: "Copy JSON", icon: <Braces size={12} />, onClick: () => { onCopyJson(); onClose(); }, show: isJson },
    { label: "View Row", icon: <Eye size={12} />, onClick: () => { onViewRow(); onClose(); }, show: true },
    { label: "Select Row", icon: <MousePointerClick size={12} />, onClick: () => { onSelectRow(); onClose(); }, show: true },
    { label: "Edit", icon: <Pencil size={12} />, onClick: () => { onEdit(); onClose(); }, show: editable },
    { label: "Set NULL", icon: <CircleSlash size={12} />, onClick: () => { onSetNull(); onClose(); }, show: editable && nullable },
    { label: "Open FK reference", icon: <Link2 size={12} />, onClick: () => { onOpenFk(); onClose(); }, show: isFk },
  ];
  return (
    <div
      className="fixed z-50 min-w-[160px] bg-canvas border border-border rounded-md shadow-lg py-1 text-xs"
      style={{ top: anchorRect.bottom, left: anchorRect.left }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.filter((i) => i.show).map((i) => (
        <button key={i.label} onClick={i.onClick}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface text-left text-text">
          {i.icon} {i.label}
        </button>
      ))}
    </div>
  );
}