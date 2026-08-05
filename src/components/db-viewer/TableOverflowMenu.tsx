import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ImportDialog } from "./ImportDialog";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { exportData } from "../../lib/exportData";
import * as cmd from "../../lib/commands";
import { DependencyDialog } from "./DependencyDialog";
import type { ColumnInfo, DependencyInfo } from "../../lib/types";

interface TableOverflowMenuProps {
  schema: string;
  table: string;
  onOpenTab: (schema: string, table: string, forceNew?: boolean) => string;
  connectionId?: string;
  columns?: ColumnInfo[];
  rows?: unknown[][];
}

interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
}

export function TableOverflowMenu({
  schema,
  table,
  onOpenTab,
  connectionId: connectionIdProp,
  columns,
  rows,
}: TableOverflowMenuProps) {
  const storeConnectionId = useUiStore((s) => s.activeConnectionId);
  const connectionId = connectionIdProp ?? storeConnectionId;
  const addChange = useDbViewerStore((s) => s.addChange);

  const [open, setOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"empty" | "delete" | null>(null);
  const [dropDeps, setDropDeps] = useState<DependencyInfo[]>([]);
  const [importOpen, setImportOpen] = useState(false);
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

  const handleAction = async (id: string) => {
    switch (id) {
      case "open":
        onOpenTab(schema, table, true);
        setOpen(false);
        break;
      case "copy-schema": {
        if (!connectionId) break;
        try {
          const ddl = await cmd.getTableDdl(connectionId, schema, table);
          if (navigator.clipboard) {
            void navigator.clipboard.writeText(ddl);
          }
        } catch {
          /* ignore copy failures */
        }
        setOpen(false);
        break;
      }
      case "export-csv":
      case "export-json":
      case "export-sql":
      case "export-md": {
        const format = id.replace("export-", "");
        if (rows && rows.length > 0 && columns && columns.length > 0) {
          exportData(rows, columns, format, `${schema}.${table}`);
        }
        setOpen(false);
        break;
      }
      case "import":
        setImportOpen(true);
        setOpen(false);
        break;
      case "empty":
        setConfirmAction("empty");
        setOpen(false);
        break;
      case "delete": {
        if (!connectionId) break;
        try {
          const deps = await cmd.getObjectDependencies(connectionId, schema, "table", table);
          setDropDeps(deps);
        } catch {
          setDropDeps([]);
        }
        setConfirmAction("delete");
        setOpen(false);
        break;
      }
      default:
        break;
    }
  };

  const items: MenuItem[] = [
    { id: "open", label: "Open in new tab" },
    { id: "copy-schema", label: "Copy table schema" },
    { id: "export-csv", label: "Export data (CSV)" },
    { id: "export-json", label: "Export data (JSON)" },
    { id: "export-sql", label: "Export data (SQL)" },
    { id: "export-md", label: "Export data (Markdown)" },
    { id: "import", label: "Import data (CSV/JSON)" },
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
              className={[
                "flex items-center justify-between px-3 py-2 text-sm w-full text-left transition-colors cursor-pointer",
                item.danger ? "text-red-400 hover:bg-red-500/10 hover:text-red-300" : "text-text-muted hover:text-text hover:bg-surface-raised",
              ].join(" ")}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {confirmAction === "delete" && dropDeps.length > 0 && (
        <DependencyDialog
          open
          deps={dropDeps}
          onProceed={() => setConfirmAction(null)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === "empty" && (
        <ConfirmDialog
          open
          title={`Empty Table: ${table}`}
          message={`Are you sure you want to delete ALL rows from "${schema}"."${table}"? This action cannot be undone.`}
          confirmLabel="Empty Table"
          onConfirm={() => {
            addChange({
              type: "empty_table",
              schema,
              table,
              description: `Empty Table: ${schema}.${table}`,
            });
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
            addChange({
              type: "drop_table",
              schema,
              table,
              description: `Drop Table: ${schema}.${table}`,
            });
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <ImportDialog
        open={importOpen}
        schema={schema}
        table={table}
        columns={columns?.map((c) => c.name) ?? []}
        onStage={(change) => {
          addChange({
            type: "bulk_insert",
            schema: change.schema,
            table: change.table,
            columns: change.columns,
            rows: change.rows,
            description: change.description,
          });
          setImportOpen(false);
        }}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}