import { useState } from "react";
import { SelectDropdown } from "../ui/SelectDropdown";
import { BackupPage } from "./BackupPage";
import { RestorePage } from "./RestorePage";
import { SyncPage } from "./SyncPage";

type ToolOperation = "backup" | "restore" | "sync";

const OPERATION_OPTIONS = [
  { value: "backup", label: "Backup" },
  { value: "restore", label: "Restore" },
  { value: "sync", label: "DB Sync" },
];

export function ToolsPage({ connectionId }: { connectionId: string }) {
  const [operation, setOperation] = useState<ToolOperation>("backup");
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Operation switcher toolbar */}
      <div className="px-3 pt-3 pb-3 border-b border-border shrink-0">
        <SelectDropdown
          value={operation}
          onChange={(v) => setOperation(v as ToolOperation)}
          options={OPERATION_OPTIONS}
          variant="ghost"
          aria-label="Operation"
        />
      </div>
      {/* Content — BackupPage/RestorePage/SyncPage each render their own
          toolbar header and flex-1 overflow-y-auto scroll container, so this
          wrapper only provides a definite height (h-full resolves against it). */}
      <div className="flex-1 min-h-0">
        {operation === "backup" && <BackupPage connectionId={connectionId} />}
        {operation === "restore" && <RestorePage connectionId={connectionId} />}
        {operation === "sync" && <SyncPage />}
      </div>
    </div>
  );
}