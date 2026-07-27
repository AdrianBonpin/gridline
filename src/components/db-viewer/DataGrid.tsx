import { useDbViewerStore } from "../../stores/dbViewerStore";

// TODO: Replace this plain HTML table with @tanstack/react-virtual for large
// result sets so we can render millions of rows without DOM overhead.

export function DataGrid() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const tables = useDbViewerStore((state) => state.tables);

  if (!activeTabId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a table to view data
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a table to view data
      </div>
    );
  }

  if (activeTab.loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading...
      </div>
    );
  }

  if (activeTab.error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
        {activeTab.error}
      </div>
    );
  }

  if (!activeTab.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading table data...
      </div>
    );
  }

  const { columns, rows } = activeTab.data;

  const tableInfo = tables.find(
    (t) => t.name === activeTab.table && t.schema === activeTab.schema,
  );
  const columnTypes = new Map(
    tableInfo?.columns?.map((c) => [c.name, c.data_type]) ?? [],
  );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {columns.map((col) => {
              const type = columnTypes.get(col);
              return (
                <th
                  key={col}
                  scope="col"
                  role="columnheader"
                  className="border-b border-border px-3 py-2 font-heading text-text-muted"
                >
                  <div className="flex flex-col">
                    <span className="text-text">{col}</span>
                    {type && (
                      <span className="text-xs font-sans text-text-muted/70">
                        {type}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border/50 hover:bg-surface/50"
            >
              {columns.map((col) => {
                const value = row[col];
                const isNull = value === null || value === undefined;
                return (
                  <td key={col} className="px-3 py-2">
                    {isNull ? (
                      <span className="italic text-text-muted">NULL</span>
                    ) : (
                      String(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}