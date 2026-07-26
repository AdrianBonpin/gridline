import { useEffect, useRef, useState } from "react";
import { Plus, Settings as SettingsIcon, Tag, Filter, FolderPlus, Trash2, Check, X, ChevronDown } from "lucide-react";
import { Button } from "../ui/Button";
import { useUiStore } from "../../stores/uiStore";
import { ImportExportMenu } from "./ImportExportMenu";

interface ActionRowProps {
  onImport?: () => void;
  onExport?: () => void;
  onNewFolder?: () => void;
  onFilters?: () => void;
  onDeleteSelected?: () => void;
  visibleItemIds?: string[];
}

export function ActionRow({ onImport, onExport, onNewFolder, onFilters, onDeleteSelected, visibleItemIds = [] }: ActionRowProps) {
  const setActiveView = useUiStore((s) => s.setActiveView);
  const selectedItemIds = useUiStore((s) => s.selectedItemIds);
  const selectAllItems = useUiStore((s) => s.selectAllItems);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const hasSelection = selectedItemIds.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center justify-between w-full">
        <h2 className="font-heading text-lg text-text">Saved Connections</h2>
        <div className="flex items-center gap-2">
          <Button onClick={() => setActiveView("new-connection")}>
            <Plus size={14} /> New Connection
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="text-xs" onClick={() => setActiveView("settings")}>
          <Tag size={14} /> Tags
        </Button>
        <Button variant="ghost" className="text-xs" onClick={onFilters ?? (() => {})}>
          <Filter size={14} /> Filters
        </Button>
        <Button variant="ghost" className="text-xs border-0" onClick={onNewFolder ?? (() => {})}>
          <FolderPlus size={14} /> New Folder
        </Button>
        {hasSelection && (
          <div className="relative" ref={menuRef}>
            <Button variant="ghost" className="text-xs border-0" onClick={() => setMenuOpen((o) => !o)}>
              {selectedItemIds.length} selected <ChevronDown size={12} />
            </Button>
            {menuOpen && (
              <div className="absolute left-0 mt-1 rounded-xl bg-surface border border-border py-1 z-10 min-w-[180px] shadow-lg">
                <button
                  className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-raised w-full text-left transition-colors cursor-pointer"
                  onClick={() => { selectAllItems(visibleItemIds); setMenuOpen(false); }}
                >
                  <Check size={14} /> Select All
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-raised w-full text-left transition-colors cursor-pointer"
                  onClick={() => { clearSelection(); setMenuOpen(false); }}
                >
                  <X size={14} /> Clear Selection
                </button>
                <div className="border-t border-border my-1" />
                <button
                  className="flex items-center gap-2 px-3 py-2 text-sm !text-red-400 hover:!text-red-300 hover:bg-surface-raised w-full text-left transition-colors cursor-pointer"
                  onClick={() => { onDeleteSelected?.(); setMenuOpen(false); }}
                >
                  <Trash2 size={14} /> Delete ({selectedItemIds.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <ImportExportMenu onImport={onImport ?? (() => {})} onExport={onExport ?? (() => {})} />
        <Button variant="ghost" className="text-xs" onClick={() => setActiveView("settings")}>
          <SettingsIcon size={14} /> Settings
        </Button>
      </div>
    </div>
  );
}