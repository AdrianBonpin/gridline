import { useEffect, useRef, useState } from "react";
import { ObjectCrudDialog } from "./ObjectCrudDialog";
import { SequenceForm } from "./SequenceForm";
import { EnumForm } from "./EnumForm";
import { ExtensionForm } from "./ExtensionForm";
import { ViewForm } from "./ViewForm";
import { IndexForm } from "./IndexForm";
import { ConstraintForm } from "./ConstraintForm";
import { FunctionForm } from "./FunctionForm";
import { TriggerForm } from "./TriggerForm";
import { DependencyDialog } from "../DependencyDialog";
import {
  buildObjectDdl,
  dropCrudParams,
  initialCrudParams,
  type CrudItem,
  type DdlParams,
  type ObjectKind,
} from "../../../lib/objectCrud";
import { getObjectDependencies } from "../../../lib/commands";
import type { DependencyInfo } from "../../../lib/types";
import { useDbViewerStore } from "../../../stores/dbViewerStore";

interface Props {
  connectionId: string;
  objectType: ObjectKind;
  item: CrudItem;
  onRefresh: () => void;
  /** Controlled open state (e.g. driven by a row's right-click). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra non-CRUD actions appended below the divider (Copy DDL, Dependencies…). */
  extraItems?: { id: string; label: string; danger?: boolean; onClick: () => void }[];
}

const DROP_TITLE: Record<ObjectKind, string> = {
  sequence: "sequence",
  enum: "type",
  view: "view",
  extension: "extension",
  index: "index",
  constraint: "constraint",
  function: "function",
  procedure: "procedure",
  trigger: "trigger",
};

/** Renders the matching CRUD form for a kind (shared by the context menu and header create button). */
export function ObjectFormFields({
  connectionId,
  kind,
  params,
  onChange,
}: {
  connectionId: string;
  kind: ObjectKind;
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}) {
  switch (kind) {
    case "sequence":
      return <SequenceForm params={params} onChange={onChange} />;
    case "enum":
      return <EnumForm params={params} onChange={onChange} />;
    case "extension":
      return (
        <ExtensionForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "view":
      return <ViewForm params={params} onChange={onChange} />;
    case "index":
      return (
        <IndexForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "constraint":
      return (
        <ConstraintForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
    case "function":
    case "procedure":
      return <FunctionForm kind={kind} params={params} onChange={onChange} />;
    case "trigger":
      return (
        <TriggerForm
          connectionId={connectionId}
          params={params}
          onChange={onChange}
        />
      );
  }
}

export function ObjectContextMenu({
  connectionId,
  objectType,
  item,
  onRefresh,
  open,
  onOpenChange,
  extraItems,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "create" | null>(null);
  const [params, setParams] = useState<DdlParams>({});
  const [deps, setDeps] = useState<DependencyInfo[] | null>(null);
  const addChange = useDbViewerStore((s) => s.addChange);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOpen = open ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  // Track the current open state in a ref so the document-level outside-click
  // handler (registered once) only closes a menu that is actually open. Without
  // this, closed instances would fire onOpenChange(false) on every mousedown
  // and clobber the shared open key in the controlled (row right-click) case.
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        openRef.current &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kind = objectType;
  const title = `${mode === "create" ? "Create" : "Edit"} ${kind}`;
  const description = `${mode === "create" ? "Create" : "Edit"} ${
    item.name || kind
  }`;

  const openEdit = () => {
    setMode("edit");
    setParams(initialCrudParams(kind, item, "edit"));
    setOpen(false);
  };
  const openCreate = () => {
    setMode("create");
    setParams(initialCrudParams(kind, item, "create"));
    setOpen(false);
  };
  const startDrop = async () => {
    setOpen(false);
    let d: DependencyInfo[] = [];
    try {
      d = await getObjectDependencies(connectionId, item.schema, kind, item.name);
    } catch {
      d = [];
    }
    setDeps(d);
  };
  const confirmDrop = async () => {
    const sqls = await buildObjectDdl(
      connectionId,
      kind,
      dropCrudParams(kind, item),
    );
    sqls.forEach((sql) =>
      addChange({
        type: "ddl",
        sql,
        description: `Drop ${DROP_TITLE[kind]} ${item.name}`,
      }),
    );
    setDeps(null);
    onRefresh();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!isOpen)}
        aria-label="actions"
        className="text-text-muted hover:text-text cursor-pointer"
      >
        ⋮
      </button>
      {isOpen && (
        <div className="absolute right-0 top-6 z-20 w-40 rounded-lg border border-border bg-surface py-1 text-sm text-text shadow-lg">
          <button
            onClick={openCreate}
            className="block w-full text-left px-3 py-1.5 hover:bg-border/30 cursor-pointer"
          >
            Create…
          </button>
          <button
            onClick={openEdit}
            className="block w-full text-left px-3 py-1.5 hover:bg-border/30 cursor-pointer"
          >
            Edit…
          </button>
          <button
            onClick={startDrop}
            className="block w-full text-left px-3 py-1.5 text-red-400 hover:bg-border/30 cursor-pointer"
          >
            Drop…
          </button>
          {extraItems && extraItems.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              {extraItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={`block w-full text-left px-3 py-1.5 hover:bg-border/30 cursor-pointer ${
                    it.danger ? "text-red-400" : ""
                  }`}
                >
                  {it.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <ObjectCrudDialog
        open={!!mode}
        connectionId={connectionId}
        kind={kind}
        title={title}
        params={params}
        description={description}
        onClose={() => setMode(null)}
      >
        <ObjectFormFields
          connectionId={connectionId}
          kind={kind}
          params={params}
          onChange={setParams}
        />
      </ObjectCrudDialog>
      <DependencyDialog
        open={!!deps}
        deps={deps ?? []}
        onProceed={confirmDrop}
        onCancel={() => setDeps(null)}
      />
    </div>
  );
}