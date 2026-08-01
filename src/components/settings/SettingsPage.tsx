import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { Tooltip, TooltipProvider } from "../ui/Tooltip";
import { SettingsSection } from "../ui/SettingsSection";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { TagsSettingsTab } from "./TagsSettingsTab";
import { ShortcutsSettingsTab } from "./ShortcutsSettingsTab";
import { AdvancedSettingsTab } from "./AdvancedSettingsTab";
import {
    ChevronLeft,
    Cog,
    Keyboard,
    Paintbrush,
    Settings,
    Tag as TagIcon,
} from "lucide-react";
import type { ComponentType } from "react";

type SettingsTab = "general" | "editor" | "tags" | "shortcuts" | "advanced";

interface TabDefinition {
    id: SettingsTab;
    label: string;
    icon: ComponentType<{ size?: number }>;
}

const TABS: TabDefinition[] = [
    { id: "general", label: "General", icon: Settings },
    { id: "editor", label: "Editor", icon: Paintbrush },
    { id: "tags", label: "Tags", icon: TagIcon },
    { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
    { id: "advanced", label: "Advanced", icon: Cog },
];

export function SettingsPage() {
    const closeSettings = useUiStore((s) => s.closeSettings);
    const { load } = useSettingsStore();

    const [activeTab, setActiveTab] = useState<SettingsTab>("general");

    useEffect(() => {
        load();
    }, [load]);

    const renderEditor = () => (
        <SettingsSection title="Editor">
            <div className="py-8 text-center text-sm text-text-muted">
                Editor settings are coming soon.
            </div>
        </SettingsSection>
    );

    const renderTabContent = () => {
        switch (activeTab) {
            case "general":
                return <GeneralSettingsTab />;
            case "editor":
                return renderEditor();
            case "tags":
                return <TagsSettingsTab />;
            case "shortcuts":
                return <ShortcutsSettingsTab />;
            case "advanced":
                return <AdvancedSettingsTab />;
        }
    };

    return (
        <TooltipProvider>
            <div className="h-screen bg-canvas flex overflow-hidden">
                {/* Left icon rail — mirrors DbViewerSidebar */}
                <div className="w-14 h-full bg-canvas border-r border-border flex flex-col items-center py-3 gap-2 shrink-0">
                    <nav
                        role="tablist"
                        aria-label="Settings sections"
                        className="flex flex-col gap-2 flex-1"
                    >
                        {TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <Tooltip
                                    key={tab.id}
                                    content={tab.label}
                                    side="right"
                                >
                                    <button
                                        id={`settings-tab-${tab.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        aria-controls="settings-tabpanel"
                                        aria-label={tab.label}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 ${
                                            isActive
                                                ? "text-accent"
                                                : "text-text-muted hover:text-text hover:bg-surface-raised"
                                        }`}
                                    >
                                        <Icon size={16} />
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </nav>
                    <div className="flex flex-col gap-2">
                        <Tooltip content="Back" side="right">
                            <button
                                type="button"
                                aria-label="Back"
                                onClick={closeSettings}
                                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-text-muted hover:text-text hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/50"
                            >
                                <ChevronLeft size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col min-h-0">
                    <header className="px-3 pt-3 pb-3 border-b border-border shrink-0 flex items-center justify-between gap-3">
                        <h1 className="font-heading text-lg text-text">
                            Settings
                        </h1>
                        <span className="text-sm text-text-muted truncate">
                            {TABS.find((t) => t.id === activeTab)?.label}
                        </span>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                id="settings-tabpanel"
                                role="tabpanel"
                                aria-labelledby={`settings-tab-${activeTab}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                            >
                                {renderTabContent()}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </TooltipProvider>
    );
}