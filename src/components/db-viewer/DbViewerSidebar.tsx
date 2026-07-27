import { Database, Grid2x2, FunctionSquare, GitBranch, Home, Settings } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";

export interface DbViewerSidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  stub?: boolean;
}

export function DbViewerSidebar({ currentView, onNavigate }: DbViewerSidebarProps) {
  const topItems: NavItem[] = [
    { id: "db-viewer", label: "DB Viewer", icon: <Database size={20} /> },
    { id: "schema-visualizer", label: "Schema Visualizer coming soon", icon: <Grid2x2 size={20} />, stub: true },
    { id: "functions", label: "Functions coming soon", icon: <FunctionSquare size={20} />, stub: true },
    { id: "triggers", label: "Triggers coming soon", icon: <GitBranch size={20} />, stub: true },
  ];

  const bottomItems: NavItem[] = [
    { id: "home", label: "Home", icon: <Home size={20} /> },
    { id: "settings", label: "Settings", icon: <Settings size={20} /> },
  ];

  function renderItem(item: NavItem) {
    const isActive = currentView === item.id;
    const baseClass = "w-10 h-10 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50";
    const activeClass = "bg-accent/10 text-accent";
    const inactiveClass = "text-text-muted hover:text-text hover:bg-surface-raised";
    const stubClass = "opacity-40 cursor-not-allowed";

    return (
      <Tooltip key={item.id} content={item.label}>
        <button
          type="button"
          aria-label={item.label}
          disabled={item.stub}
          onClick={() => onNavigate(item.id)}
          className={`${baseClass} ${isActive ? activeClass : inactiveClass} ${item.stub ? stubClass : ""}`}
        >
          {item.icon}
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="w-14 h-screen bg-surface border-r border-border flex flex-col items-center py-3 gap-2 shrink-0">
      <div className="flex flex-col gap-2 flex-1">{topItems.map(renderItem)}</div>
      <div className="flex flex-col gap-2">{bottomItems.map(renderItem)}</div>
    </div>
  );
}