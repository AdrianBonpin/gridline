import { useEffect, useRef, useState } from "react";
import { MoreVertical, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { ImportDialog } from "./ImportDialog";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { exportData } from "../../lib/exportData";
import * as cmd from "../../lib/commands";
import { getCapabilities } from "../../lib/dbCapabilities";
import { DependencyDialog } from "./DependencyDialog";
import { initialCrudParams } from "../../lib/objectCrud";
import {
  relationKindOf,
  relationSupportsAction,
  type TableActionId,
} from "../../lib/relationKind";
import type { ColumnInfo, DependencyInfo, MaintenanceResult } from "../../lib/types";

interface TableOverflowMenuProps {
  schema: string;
  table: string;
  onOpenTab: (schema: string, table: string, forceNew?: boolean) => string;
  connectionId?: string;
  columns?: ColumnInfo[];
  rows?: unknown[][];
  dbType?: string;
  /** `TableInfo.table_type` of the row that opened this menu. */
  tableType?: string;
}

interface MenuItem {
  id: string;
  label?: string;
  danger?: boolean;
  divider?: boolean;
}

type MaintenanceAction = "vacuum" | "analyze" | "reindex";

/**
 * Menu items whose action only applies to some relation kinds. A view is
 * browsable but its rows and shape are not editable, so `Empty Table`,
 * `Delete Table`, `Edit Table…`, import, index/constraint creation and
 * maintenance are never offered for it — an action that exists only to fail is
 * worse than no action.
 */
const MENU_ACTION_KIND: Partial<Record<string, TableActionId>> = {
  import: "import",
  create_index: "create_index",
  create_constraint: "create_constraint",
  edit_table: "edit_table",
  vacuum: "maintenance",
  analyze: "maintenance",
  reindex: "maintenance",
  empty: "empty",
  delete: "drop",
};

const maintenanceLockCopy: Record<MaintenanceAction, string> = {
  vacuum: "VACUUM blocks concurrent DDL only on this table.",
  analyze: "ANALYZE blocks concurrent DDL only on this table.",
  reindex: "REINDEX takes an ACCESS EXCLUSIVE lock — blocks reads and writes on this table until complete.",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TableOverflowMenu({
  schema,
  table,
  onOpenTab,
  connectionId: connectionIdProp,
  columns,
  rows,
  dbType,
  tableType,
}: TableOverflowMenuProps) {
  const storeConnectionId = useUiStore((s) => s.activeConnectionId);
  const connectionId = connectionIdProp ?? storeConnectionId;
  const addChange = useDbViewerStore((s) => s.addChange);
  const notify = useNotificationStore((s) => s.notify);
  const caps = getCapabilities(dbType ?? "postgresql");
  const kind = relationKindOf(tableType);
  const applies = (action: TableActionId) => relationSupportsAction(action, kind);

  const [open, setOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"empty" | "delete" | null>(null);
  const [dropDeps, setDropDeps] = useState<DependencyInfo[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [maintenance, setMaintenance] = useState<{ action: MaintenanceAction; lockCopy: string } | null>(null);
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [maintenanceResult, setMaintenanceResult] = useState<
    { type: "success" | "error"; message: string; duration_ms: number } | null
  >(null);
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

  const handleMaintenanceConfirm = async () => {
    if (!connectionId || !maintenance) return;
    setMaintenanceRunning(true);
    setMaintenanceResult(null);
    try {
      const result: MaintenanceResult = await cmd.runMaintenance(
        connectionId,
        schema,
        table,
        maintenance.action,
      );
      setMaintenanceResult({ type: "success", message: result.message, duration_ms: result.duration_ms });
      notify(`${result.message} · ${result.duration_ms}ms`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMaintenanceResult({ type: "error", message, duration_ms: 0 });
      notify(message, "error");
    } finally {
      setMaintenanceRunning(false);
    }
  };

  /** The single staged change a confirmed table drop produces. */
  const stageDropTable = () => {
    addChange({
      type: "drop_table",
      schema,
      table,
      description: `Drop Table: ${schema}.${table}`,
    });
    cancelDropTable();
  };

  /** Cancelling the drop acknowledgement stages nothing. */
  const cancelDropTable = () => {
    setDropDeps([]);
    setConfirmAction(null);
  };

  const handleAction = async (id: string) => {
    // Second line of defence: an action that does not apply to this relation
    // kind is not offered, and cannot do anything if it is somehow invoked.
    const gatedAction = MENU_ACTION_KIND[id];
    if (gatedAction && !applies(gatedAction)) {
      setOpen(false);
      return;
    }
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
      case "export-md":
      case "export-xlsx": {
        const format = id.replace("export-", "");
        const label =
          format === "xlsx"
            ? "Excel"
            : format === "md"
              ? "Markdown"
              : format.toUpperCase();
        try {
          if (rows && rows.length > 0 && columns && columns.length > 0) {
            exportData(rows, columns, format, table, { schema, dbType });
            notify(
              `Exported ${rows.length} row${rows.length === 1 ? "" : "s"} as ${label}`,
              "success",
            );
          } else if (connectionId) {
            // Tree kebab: no rows are loaded here — fetch one bounded page
            // first, then export. 500 is the largest page the backend accepts;
            // asking for more is rejected rather than silently clamped.
            const result = await cmd.getTableData(connectionId, schema, table, 1, 500);
            if (!result.rows.length) {
              notify("Nothing to export", "info");
            } else {
              exportData(result.rows, result.columns, format, table, { schema, dbType });
              // The table path always reports an exact total; treat an absent
              // one as "no truncation claim" rather than inventing a number.
              const truncated =
                (result.total_rows ?? 0) > result.rows.length
                  ? ` (first ${result.rows.length} of ${result.total_rows})`
                  : "";
              notify(
                `Exported ${result.rows.length} row${result.rows.length === 1 ? "" : "s"} as ${label}${truncated}`,
                "success",
              );
            }
          } else {
            notify("Nothing to export", "info");
          }
        } catch (e) {
          notify(
            `Export failed: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        }
        setOpen(false);
        break;
      }
      case "import":
        setImportOpen(true);
        setOpen(false);
        break;
      case "edit_table": {
        // Always read the live column snapshot: the tree row that opened this
        // menu may be unexpanded (no columns), and even an expanded row's
        // cached list can predate DDL. Editing an empty or stale schema
        // snapshot is the failure this avoids.
        if (!connectionId) {
          notify("Cannot edit table: no active connection", "error");
          setOpen(false);
          break;
        }
        setOpen(false);
        let liveColumns: ColumnInfo[];
        try {
          // Metadata read, not a row page: introspection never paginates or
          // consumes the table's rows.
          liveColumns = await cmd.getTableColumns(connectionId, schema, table);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          notify(
            `Could not load the live columns for ${schema}.${table}: ${message}`,
            "error",
          );
          break;
        }
        const columnMeta = liveColumns.map((c) => ({
          name: c.name,
          type: c.data_type,
          nullable: c.is_nullable,
          default: c.default_value,
          is_pk: c.is_pk,
        }));
        useDbViewerStore.getState().openFormTab({
          kind: "table",
          schema,
          name: table,
          title: "Edit Table",
          description: `Edit ${schema}.${table}`,
          mode: "edit",
          params: {
            schema,
            name: table,
            action: {
              op: "edit",
              // Each row remembers its live column (Column Identity); a rename
              // is a name the user edits on that row, never a positional match.
              columns: columnMeta.map((c) => ({
                ...c,
                original_name: c.name,
              })),
              old_columns: columnMeta,
            },
          },
        });
        break;
      }
      case "create_index":
        if (!connectionId) break;
        useDbViewerStore.getState().openFormTab({
          kind: "index",
          schema,
          name: "",
          title: "Create Index",
          description: `Create index on ${schema}.${table}`,
          mode: "create",
          params: initialCrudParams("index", { schema, table, name: "" }, "create"),
        });
        setOpen(false);
        break;
      case "create_constraint":
        if (!connectionId) break;
        useDbViewerStore.getState().openFormTab({
          kind: "constraint",
          schema,
          name: "",
          title: "Create Constraint",
          description: `Create constraint on ${schema}.${table}`,
          mode: "create",
          params: initialCrudParams("constraint", { schema, table, name: "" }, "create"),
        });
        setOpen(false);
        break;
      case "vacuum":
      case "analyze":
      case "reindex":
        setMaintenance({ action: id, lockCopy: maintenanceLockCopy[id] });
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
    { id: "export-xlsx", label: "Export data (Excel)" },
    ...(caps.import && applies("import")
      ? [{ id: "import", label: "Import data (CSV/JSON)" }]
      : []),
    ...(applies("create_index")
      ? [{ id: "create_index", label: "Create Index…" }]
      : []),
    ...(applies("create_constraint")
      ? [{ id: "create_constraint", label: "Create Constraint…" }]
      : []),
    ...(caps.tableManagement && applies("edit_table")
      ? [{ id: "edit_table", label: "Edit Table…" }]
      : []),
    ...(caps.maintenance && applies("maintenance")
      ? [
          { id: "maintenance-divider", divider: true },
          { id: "vacuum", label: "VACUUM" },
          { id: "analyze", label: "ANALYZE" },
          { id: "reindex", label: "REINDEX", danger: true },
        ]
      : []),
    ...(applies("empty")
      ? [{ id: "empty", label: "Empty Table", danger: true }]
      : []),
    ...(applies("drop")
      ? [{ id: "delete", label: "Delete Table", danger: true }]
      : []),
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
          {items.map((item) =>
            item.divider ? (
              <div key={item.id} className="border-t border-border my-1" />
            ) : (
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
            ),
          )}
        </div>
      )}

      {maintenance && (
        <AnimatedModal open onClose={() => setMaintenance(null)}>
          <div className="w-80">
            <h3 className="font-heading text-text text-lg mb-3">
              {maintenanceResult
                ? maintenanceResult.type === "success"
                  ? "Maintenance Complete"
                  : "Maintenance Failed"
                : `${capitalize(maintenance.action)}: ${schema}.${table}`}
            </h3>
            <p className="text-sm text-text-muted mb-4">
              {maintenanceResult
                ? `${maintenanceResult.message} · ${maintenanceResult.duration_ms}ms`
                : maintenance.lockCopy}
            </p>
            {maintenanceRunning && (
              <div className="flex items-center gap-2 text-sm text-text-muted mb-4">
                <RefreshCw size={14} className="animate-spin" />
                <span>Running {maintenance.action}…</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setMaintenance(null)}
                disabled={maintenanceRunning}
              >
                {maintenanceResult ? "Close" : "Cancel"}
              </Button>
              {!maintenanceResult && (
                <Button
                  variant="primary"
                  onClick={handleMaintenanceConfirm}
                  disabled={maintenanceRunning}
                >
                  {maintenanceRunning ? "Running…" : capitalize(maintenance.action)}
                </Button>
              )}
            </div>
          </div>
        </AnimatedModal>
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
      {/*
       * A drop reaches the changes queue through exactly ONE confirmation.
       * A dependent drop used to raise a dependency dialog *and* a confirm
       * dialog; Proceed dismissed both and staged nothing. Now the single
       * dialog is the whole acknowledgement: it names the dependencies, takes
       * one deliberate tick, and its confirm button stages the one change.
       */}
      {confirmAction === "delete" &&
        (dropDeps.length > 0 ? (
          <DependencyDialog
            open
            title={`Delete Table: ${table}`}
            dependencyNotice={`These objects depend on "${schema}"."${table}" — review them before dropping it:`}
            message={`Deleting "${schema}"."${table}" permanently loses all of its data. The staged change is a plain DROP TABLE without CASCADE.`}
            acknowledgementLabel="I understand these depend on it and may block or outlive the drop."
            confirmLabel="Delete Table"
            deps={dropDeps}
            onProceed={stageDropTable}
            onCancel={cancelDropTable}
          />
        ) : (
          <ConfirmDialog
            open
            title={`Delete Table: ${table}`}
            message={`Are you sure you want to permanently delete "${schema}"."${table}"? All data will be lost.`}
            confirmLabel="Delete Table"
            onConfirm={stageDropTable}
            onCancel={cancelDropTable}
          />
        ))}

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