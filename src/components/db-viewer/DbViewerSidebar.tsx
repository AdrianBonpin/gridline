import {
    Boxes,
    Clock,
    Database,
    DatabaseBackup,
    Home,
    Settings,
    Share2,
} from "lucide-react";
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

export function DbViewerSidebar({
    currentView,
    onNavigate,
}: DbViewerSidebarProps) {
    const topItems: NavItem[] = [
        { id: "db-viewer", label: "Explorer", icon: <Database size={16} /> },
        {
            id: "queries",
            label: "Queries",
            icon: <Clock size={16} />,
        },
        {
            id: "schema-visualizer",
            label: "Schema Visualizer",
            icon: <Share2 size={16} />,
        },
        { id: "objects", label: "Objects", icon: <Boxes size={16} /> },
        { id: "tools", label: "Tools", icon: <DatabaseBackup size={16} /> },
    ];

    const bottomItems: NavItem[] = [
        { id: "home", label: "Home", icon: <Home size={16} /> },
        { id: "settings", label: "Settings", icon: <Settings size={16} /> },
    ];

    function renderItem(item: NavItem) {
        const isActive = currentView === item.id;
        const baseClass =
            "w-8 h-8 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50";
        const activeClass = "text-accent";
        const inactiveClass =
            "text-text-muted hover:text-text hover:bg-surface-raised";
        const stubClass = "opacity-40 cursor-not-allowed";

        return (
            <Tooltip key={item.id} content={item.label} side="right">
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
        <div className="w-14 h-full bg-canvas border-r border-border flex flex-col items-center py-3 gap-2 shrink-0">
            <div className="flex flex-col gap-2 flex-1">
                {topItems.map(renderItem)}
            </div>
            <div className="flex flex-col gap-2">
                {bottomItems.map(renderItem)}
            </div>
        </div>
    );
}
