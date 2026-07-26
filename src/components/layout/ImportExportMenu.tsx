import { useState } from "react";
import { Download, Upload, ChevronDown } from "lucide-react";
import { Button } from "../ui/Button";

interface ImportExportMenuProps {
  onImport: () => void;
  onExport: () => void;
}

export function ImportExportMenu({ onImport, onExport }: ImportExportMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)}>
        Import / Export <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 rounded-xl bg-surface border border-border py-1 z-10 min-w-[160px] shadow-lg">
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-raised w-full text-left transition-colors" onClick={() => { setOpen(false); onImport(); }}>
            <Upload size={14} /> Import Connections
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-raised w-full text-left transition-colors" onClick={() => { setOpen(false); onExport(); }}>
            <Download size={14} /> Export Connections
          </button>
        </div>
      )}
    </div>
  );
}