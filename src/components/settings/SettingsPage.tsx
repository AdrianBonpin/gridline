import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { SettingsSection } from "../ui/SettingsSection";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { TagsSettingsTab } from "./TagsSettingsTab";
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
  const setActiveView = useUiStore((s) => s.setActiveView);
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

  const renderShortcuts = () => (
    <SettingsSection title="Shortcuts">
      <div className="py-8 text-center text-sm text-text-muted">
        Shortcut customization is coming soon.
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
        return renderShortcuts();
      case "advanced":
        return <AdvancedSettingsTab />;
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* App header */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-border/50 bg-surface">
        <Button variant="ghost" onClick={() => setActiveView("home")} className="gap-1 px-2">
          <ChevronLeft size={16} /> Back
        </Button>
        <h1 className="font-heading text-lg text-text">Settings</h1>
      </header>

      <div className="flex gap-6 px-6 py-6">
        {/* Sidebar */}
        <nav
          className="w-48 shrink-0 space-y-1"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="settings-tabpanel"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer ${
                  isActive
                    ? "bg-surface-raised text-text"
                    : "text-text-muted hover:text-text hover:bg-surface-raised"
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0">
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
        </main>
      </div>
    </div>
  );
}