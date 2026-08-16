import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { normalizeImport, coerceRow } from "../../lib/importNormalize";

const MAX_ROWS = 100_000;
const MAX_BYTES = 100 * 1024 * 1024;
const SKIP = "<skip>";

export interface ImportDialogProps {
  open: boolean;
  schema: string;
  table: string;
  columns: string[];
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

export function ImportDialog({
  open: isOpen,
  schema,
  table,
  columns,
  onStage,
  onClose,
}: ImportDialogProps) {
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async () => {
    try {
      const path = await open({
        filters: [{ name: "Data", extensions: ["csv", "json"] }],
      });
      if (!path || Array.isArray(path)) return;

      const text = await readTextFile(path as string);
      if (text.length > MAX_BYTES) {
        setError("File exceeds 100 MB limit");
        return;
      }

      const { headers, rows } = normalizeImport(text);

      if (rows.length > MAX_ROWS) {
        setError(`File has ${rows.length.toLocaleString()} rows; limit is ${MAX_ROWS.toLocaleString()}`);
        return;
      }

      setParsed({ headers, rows });
      setMapping(
        Object.fromEntries(
          headers.map((h, i) => [h, columns[i] ?? SKIP]),
        ),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stage = () => {
    if (!parsed) return;

    const selected = parsed.headers
      .map((header) => ({ header, col: mapping[header] }))
      .filter(({ col }) => col && col !== SKIP);

    const targetColumns = selected.map(({ col }) => col);
    const dataRows = parsed.rows.map((row) =>
      selected.map(({ header }) => {
        const idx = parsed.headers.indexOf(header);
        return coerceRow(row[idx]);
      }),
    );

    onStage({
      type: "bulk_insert",
      schema,
      table,
      columns: targetColumns,
      rows: dataRows,
      description: `Import ${dataRows.length.toLocaleString()} rows into ${schema}.${table}`,
    });
    onClose();
  };

  const mappingOptions = [
    { value: SKIP, label: "<skip>" },
    ...columns.map((c) => ({ value: c, label: c })),
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
            <span className="text-xs text-text-muted">CSV or JSON, up to 100 MB / 100,000 rows</span>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3">
              <span className="text-red-300 text-sm">{error}</span>
            </div>
          )}

          {parsed && (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Preview ({parsed.rows.length.toLocaleString()} rows × {parsed.headers.length} columns)
              </p>

              <div className="space-y-2">
                {parsed.headers.map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="text-sm text-text w-24 truncate" title={header}>{header}</span>
                    <span className="text-xs text-text-muted">→</span>
                    <Select
                      value={mapping[header] ?? SKIP}
                      onChange={(v) =>
                        setMapping((prev) => ({ ...prev, [header]: v }))
                      }
                      options={mappingOptions}
                      label={`Map ${header}`}
                    />
                  </div>
                ))}
              </div>

              <div className="overflow-auto max-h-64 rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface sticky top-0">
                    <tr className="border-b border-border">
                      {parsed.headers.map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-text-muted font-heading whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border last:border-0 hover:bg-surface/30">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-text whitespace-nowrap">
                            {cell === "" ? (
                              <span className="italic text-text-muted/50">null</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={stage} disabled={!parsed}>Stage import</Button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}