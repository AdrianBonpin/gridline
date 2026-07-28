import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { ConfirmDialog } from "../ui/ConfirmDialog";

interface TableOverflowMenuProps {
  schema: string;
  table: string;
  onOpenTab: (schema: string, table: string, forceNew?: boolean) => string;
}

interface MenuItem {
  id: string;
  label: string;
  stub?: boolean;
  danger?: boolean;
}

export function TableOverflowMenu({ schema, table, onOpenTab }: TableOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"empty" | "delete" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleAction = (id: string) => {
    switch (id) {
      case "open":
        onOpenTab(schema, table, true);
        setOpen(false);
        break;
      case "copy-schema": {
        const sql = `-- Schema for ${schema}.${table}\n-- TODO: fetch schema DDL`;
        if (navigator.clipboard) {
          void navigator.clipboard.writeText(sql);
        }
        setOpen(false);
        break;
      }
      case "empty":
        setConfirmAction("empty");
        setOpen(false);
        break;
      case "delete":
        setConfirmAction("delete");
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const items: MenuItem[] = [
    { id: "open", label: "Open in new tab" },
    { id: "copy-schema", label: "Copy table schema" },
    { id: "export-csv", label: "Export data (CSV)", stub: true },
    { id: "export-json", label: "Export data (JSON)", stub: true },
    { id: "export-sql", label: "Export data (SQL)", stub: true },
    { id: "empty", label: "Empty Table", danger: true },
    { id: "delete", label: "Delete Table", danger: true },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-label="Table options"
        onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 rounded-xl bg-surface border border-border py-1 z-20 min-w-[180px] shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAction(item.id)}
              disabled={item.stub}
              className={[
                "flex items-center justify-between px-3 py-2 text-sm w-full text-left transition-colors cursor-pointer",
                item.danger ? "text-error hover:bg-error/10" : "text-text-muted hover:text-text hover:bg-surface-raised",
                item.stub ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
            >
              <span>{item.label}</span>
              {item.stub && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-raised text-text-subtle">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {confirmAction === "empty" && (
        <ConfirmDialog
          open
          title={`Empty Table: ${table}`}
          message={`Are you sure you want to delete ALL rows from "${schema}"."${table}"? This action cannot be undone.`}
          confirmLabel="Empty Table"
          onConfirm={() => {
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "delete" && (
        <ConfirmDialog
          open
          title={`Delete Table: ${table}`}
          message={`Are you sure you want to permanently delete "${schema}"."${table}"? All data will be lost.`}
          confirmLabel="Delete Table"
          onConfirm={() => {
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}