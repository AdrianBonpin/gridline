import { useEffect, useState, type ReactNode } from "react";
import { AnimatedModal } from "../../ui/AnimatedModal";
import {
  buildObjectDdl,
  type ObjectKind,
  type DdlParams,
} from "../../../lib/objectCrud";
import { useDbViewerStore } from "../../../stores/dbViewerStore";

interface Props {
  open: boolean;
  connectionId: string;
  kind: ObjectKind;
  title: string;
  params: DdlParams;
  description: string;
  onClose: () => void;
  children: ReactNode;
}

export function ObjectCrudDialog({
  open,
  connectionId,
  kind,
  title,
  params,
  description,
  onClose,
  children,
}: Props) {
  const addChange = useDbViewerStore((s) => s.addChange);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    buildObjectDdl(connectionId, kind, params)
      .then((sqls) => {
        if (active) {
          setPreview(sqls.join("\n;\n"));
          setError(null);
        }
      })
      .catch((e) => {
        if (active) {
          setPreview("");
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [open, connectionId, kind, params]);

  const stage = async () => {
    const sqls = await buildObjectDdl(connectionId, kind, params);
    sqls.forEach((sql, i) =>
      addChange({
        type: "ddl",
        sql,
        description:
          sqls.length > 1
            ? `${description} (${i + 1}/${sqls.length})`
            : description,
      }),
    );
    onClose();
  };

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="p-5 w-[640px] max-h-[80vh] flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        <div className="min-h-[120px]">{children}</div>
        <div className="text-xs font-medium text-text-muted">SQL preview</div>
        <pre className="font-mono text-xs bg-surface rounded-lg p-3 border border-border overflow-auto max-h-48 text-text">
          {preview}
        </pre>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg text-text-muted hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={stage}
            disabled={!!error}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-50"
          >
            Stage
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}