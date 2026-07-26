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
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        Import / Export <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 rounded-md bg-canvas/90 backdrop-blur-md border border-border py-1 z-10">
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-white hover:bg-white/10 w-full text-left" onClick={() => { setOpen(false); onImport(); }}>
            <Upload size={14} /> Import Connections
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-white hover:bg-white/10 w-full text-left" onClick={() => { setOpen(false); onExport(); }}>
            <Download size={14} /> Export Connections
          </button>
        </div>
      )}
    </div>
  );
}