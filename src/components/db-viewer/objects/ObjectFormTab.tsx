import { useEffect, useState } from "react";
import { KindForm } from "./KindForm";
import {
  buildObjectDdl,
  type DdlParams,
} from "../../../lib/objectCrud";
import { useDbViewerStore, type ViewerTab } from "../../../stores/dbViewerStore";

interface Props {
  connectionId: string;
  tab: ViewerTab;
}

export function ObjectFormTab({ connectionId, tab }: Props) {
  const form = tab.form;
  if (!form) return null;

  const { kind, params, title, description, mode } = form;

  const [view, setView] = useState<"visual" | "sql">("visual");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = true;
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
      useDbViewerStore.getState().addChange({
        type: "ddl",
        sql,
        description:
          sqls.length > 1
            ? `${description} (${i + 1}/${sqls.length})`
            : description,
      }),
    );
    useDbViewerStore.getState().closeTab(tab.id);
  };

  const schemas = useDbViewerStore((s) => s.schemas);

  const handleChange = (next: DdlParams) => {
    useDbViewerStore.getState().updateFormTabParams(tab.id, next);
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {mode} {kind}
          </span>
          <h2 className="text-sm font-medium text-text">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              aria-label="Visual"
              onClick={() => setView("visual")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "visual"
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              Visual
            </button>
            <button
              type="button"
              aria-label="SQL"
              onClick={() => setView("sql")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "sql"
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              SQL
            </button>
          </div>

          <button
            type="button"
            onClick={stage}
            disabled={!!error}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Stage
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {view === "visual" ? (
          <KindForm
            connectionId={connectionId}
            kind={kind}
            params={params}
            schemas={schemas}
            onChange={handleChange}
          />
        ) : (
          <pre className="text-xs text-text whitespace-pre-wrap rounded-md bg-canvas px-3 py-2 font-mono border border-border">
            {preview}
          </pre>
        )}
      </div>

      {error && (
        <div className="border-t border-border px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}