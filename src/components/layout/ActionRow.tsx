import { Plus, Settings as SettingsIcon, Tag, Filter, FolderPlus } from "lucide-react";
import { Button } from "../ui/Button";
import { useUiStore } from "../../stores/uiStore";
import { ImportExportMenu } from "./ImportExportMenu";

interface ActionRowProps {
  onImport?: () => void;
  onExport?: () => void;
  onNewFolder?: () => void;
  onFilters?: () => void;
}

export function ActionRow({ onImport, onExport, onNewFolder, onFilters }: ActionRowProps) {
  const setActiveView = useUiStore((s) => s.setActiveView);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center justify-between w-full">
        <h2 className="font-heading text-lg">Saved Connections</h2>
        <Button onClick={() => setActiveView("new-connection")}><Plus size={14} /> New Connection</Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setActiveView("settings")}><Tag size={14} /> Tags</Button>
        <Button variant="ghost" onClick={onFilters ?? (() => {})}><Filter size={14} /> Filters</Button>
        <Button variant="ghost" onClick={onNewFolder ?? (() => {})}><FolderPlus size={14} /> Folder</Button>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <ImportExportMenu onImport={onImport ?? (() => {})} onExport={onExport ?? (() => {})} />
        <Button variant="ghost" onClick={() => setActiveView("settings")}><SettingsIcon size={14} /> Settings</Button>
      </div>
    </div>
  );
}