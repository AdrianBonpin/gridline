import { useMemo, useState } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import {
  normalizeImport,
  assertImportByteLimit,
  sourceColumnLabel,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportCell,
  type NormalizedImport,
} from "../../lib/importNormalize";
import {
  convertImportRows,
  describeImportErrors,
  planImport,
  type ImportTargetColumn,
} from "../../lib/importConvert";
import { readImportFile, selectFileForGrant } from "../../lib/commands";
import type { FileFilter } from "../../lib/fileGrant";
import { fileGrantErrorMessage } from "../../lib/fileGrant";

/** `<skip>` is a sentinel target index, not a column: nothing maps to it. */
const SKIP = -1;

export interface ImportDialogProps {
  open: boolean;
  schema: string;
  table: string;
  /**
   * The table's target columns *with their declared types*. Conversion is
   * driven by the declared type, so a name alone is not enough to import.
   */
  columns: ImportTargetColumn[];
  onStage: (change: {
    type: "bulk_insert";
    schema: string;
    table: string;
    columns: string[];
    rows: unknown[][];
    description: string;
  }) => void;
  onClose: () => void;
}

/** How a source cell reads in the preview. */
function previewCell(cell: ImportCell): string | null {
  if (cell.kind === "null") return null; // rendered as the NULL marker
  if (cell.kind === "text") return cell.value === "" ? '""' : cell.value;
  try {
    return JSON.stringify(cell.value) ?? String(cell.value);
  } catch {
    return String(cell.value);
  }
}

export function ImportDialog({
  open: isOpen,
  schema,
  table,
  columns,
  onStage,
  onClose,
}: ImportDialogProps) {
  const [parsed, setParsed] = useState<NormalizedImport | null>(null);
  /**
   * Source column position → target column index, or {@link SKIP}.
   *
   * Indexed by POSITION, never by header text: a file may repeat a header, and
   * a header-keyed map would then copy one column's values into another
   * column's target.
   */
  const [mapping, setMapping] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);

  const chooseFile = async () => {
    try {
      // The import source is authorized by a backend-issued read grant: the
      // renderer never names a path, and the grant is consumed by the read.
      const filters: FileFilter[] = [{ name: "Data", extensions: ["csv", "json"] }];
      const picked = await selectFileForGrant({
        intent: "read",
        title: "Choose a data file to import",
        filters,
      });
      if (!picked) return; // cancelled: nothing to authorize

      const source = await readImportFile(picked.id);

      // Size is checked before the text is touched. The backend already refuses
      // an oversized file from its metadata (so the bytes are never buffered);
      // this repeats the contract on the reported size before any parsing.
      assertImportByteLimit(source.bytes, MAX_IMPORT_BYTES);

      const normalized = normalizeImport(source.text);

      if (normalized.rows.length > MAX_IMPORT_ROWS) {
        setParsed(null);
        setError(
          `File has ${normalized.rows.length.toLocaleString()} rows; limit is ${MAX_IMPORT_ROWS.toLocaleString()}`,
        );
        return;
      }

      setParsed(normalized);
      setSourceName(source.displayName);
      // Positional auto-mapping: the i-th source column proposes the i-th
      // target column.
      setMapping(normalized.headers.map((_, i) => (i < columns.length ? i : SKIP)));
      setError(null);
    } catch (e) {
      // A grant rejection (expired, already used, wrong intent) is shown with
      // its own recovery text instead of a raw backend error. Either way the
      // previous file is dropped, so a failed pick can never stage stale data.
      setError(fileGrantErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)));
      setParsed(null);
      setMapping([]);
    }
  };

  const plan = useMemo(
    () => (parsed ? planImport(columns, mapping) : null),
    [parsed, columns, mapping],
  );

  const mappingError = plan && !plan.ok ? plan.error : null;
  const canStage = Boolean(parsed) && Boolean(plan?.ok);

  const stage = () => {
    if (!parsed || !plan?.ok) return;

    const converted = convertImportRows(parsed.headers, parsed.rows, plan.plan);
    if (!converted.ok) {
      // An invalid value names its row and column and stages nothing at all.
      setError(describeImportErrors(converted.errors));
      return;
    }

    onStage({
      type: "bulk_insert",
      schema,
      table,
      columns: plan.plan.columns,
      rows: converted.rows,
      description: `Import ${converted.rows.length.toLocaleString()} rows into ${schema}.${table}`,
    });
    onClose();
  };

  const mappingOptions = [
    { value: String(SKIP), label: "<skip>" },
    ...columns.map((c, i) => ({ value: String(i), label: c.name })),
  ];

  const previewRows = parsed ? parsed.rows.slice(0, 100) : [];

  return (
    <AnimatedModal open={isOpen} onClose={onClose}>
      <div className="w-full min-w-md max-w-2xl max-h-[80vh] overflow-y-auto">
        <h3 className="font-heading text-text text-lg mb-4">
          Import into {schema}.{table}
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={chooseFile}>Choose file</Button>
            <span className="text-xs text-text-muted">
              {sourceName ?? "CSV or JSON, up to 100 MB / 100,000 rows"}
            </span>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3">
              <span className="text-red-300 text-sm whitespace-pre-line">{error}</span>
            </div>
          )}

          {mappingError && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3">
              <span className="text-amber-300 text-sm">{mappingError}</span>
            </div>
          )}

          {parsed && (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Preview ({parsed.rows.length.toLocaleString()} rows × {parsed.headers.length} columns)
              </p>

              <div className="space-y-2">
                {parsed.headers.map((_, si) => (
                  <div key={si} className="flex items-center gap-3">
                    <span
                      className="text-sm text-text w-24 truncate"
                      title={sourceColumnLabel(parsed.headers, si)}
                    >
                      {sourceColumnLabel(parsed.headers, si)}
                    </span>
                    <span className="text-xs text-text-muted">→</span>
                    <Select
                      value={String(mapping[si] ?? SKIP)}
                      onChange={(v) => {
                        setMapping((prev) => {
                          const next = [...prev];
                          next[si] = Number(v);
                          return next;
                        });
                        // A stale conversion report no longer describes the new
                        // mapping; the next Stage re-validates it.
                        setError(null);
                      }}
                      options={mappingOptions}
                      label={`Map ${sourceColumnLabel(parsed.headers, si)}`}
                    />
                  </div>
                ))}
              </div>

              <div className="overflow-auto max-h-64 rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface sticky top-0">
                    <tr className="border-b border-border">
                      {parsed.headers.map((_, ci) => (
                        <th
                          key={ci}
                          className="px-3 py-2 text-left text-text-muted font-heading whitespace-nowrap"
                        >
                          {sourceColumnLabel(parsed.headers, ci)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border last:border-0 hover:bg-surface/30">
                        {row.map((cell, ci) => {
                          const shown = previewCell(cell);
                          return (
                            <td key={ci} className="px-3 py-1.5 text-text whitespace-nowrap">
                              {shown === null ? (
                                <span className="italic text-text-muted/50">null</span>
                              ) : (
                                shown
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={stage} disabled={!canStage}>Stage import</Button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}
