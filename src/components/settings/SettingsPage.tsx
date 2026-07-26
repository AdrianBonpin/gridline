import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSortedTags } from "../../hooks/useSortedTags";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Toggle } from "../ui/Toggle";
import { Select } from "../ui/Select";
import { ThemePicker } from "../ui/ThemePicker";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSection } from "../ui/SettingsSection";
import {
  ChevronLeft,
  Cog,
  Keyboard,
  Paintbrush,
  Plus,
  Settings,
  Tag as TagIcon,
  Trash2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { ComponentType } from "react";
import type { FontSize, Tag } from "../../lib/types";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#78716c",
];

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

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
  const { settings, load, updateSetting } = useSettingsStore();
  const folders = useConnectionStore((s) => s.folders);
  const tags = useSortedTags();
  const tagOrder = useConnectionStore((s) => s.tagOrder);
  const setTagOrder = useConnectionStore((s) => s.setTagOrder);
  const createTag = useConnectionStore((s) => s.createTag);
  const updateTag = useConnectionStore((s) => s.updateTag);
  const deleteTag = useConnectionStore((s) => s.deleteTag);
  const notify = useNotificationStore((s) => s.notify);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateTag = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      notify("Tag name must not be empty", "error");
      return;
    }
    try {
      await createTag({ name: trimmed, color: newColor });
      setNewName("");
      setNewColor(TAG_COLORS[0]);
    } catch (e) {
      notify(`Failed to create tag: ${e}`, "error");
    }
  };

  const handleUpdateTag = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      notify("Tag name must not be empty", "error");
      return;
    }
    try {
      await updateTag(id, { name: trimmed, color: editColor });
      setEditingId(null);
    } catch (e) {
      notify(`Failed to update tag: ${e}`, "error");
    }
  };

  const handleDeleteTag = async (id: string, name: string) => {
    try {
      await deleteTag(id);
      notify(`Deleted tag "${name}"`, "info");
    } catch (e) {
      notify(`Failed to delete tag: ${e}`, "error");
    }
  };

  const handleMoveTag = async (index: number, direction: "up" | "down") => {
    const currentOrder = tagOrder.length === tags.length ? tagOrder : tags.map((t) => t.id);
    const newOrder = [...currentOrder];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    try {
      await setTagOrder(newOrder);
    } catch (e) {
      notify(`Failed to reorder tags: ${e}`, "error");
    }
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const folderOptions = [
    { value: "", label: "None" },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  const defaultPorts = settings?.default_ports ?? {
    postgresql: 5432,
    mysql: 3306,
    sqlite: null,
    redis: 6379,
  };

  const updatePort = (key: string, value: string) => {
    const port = value === "" ? null : Number(value);
    const next = { ...defaultPorts, [key]: port };
    updateSetting("default_ports", JSON.stringify(next));
  };

  const renderGeneral = () => {
    if (!settings) return null;
    return (
      <>
        <SettingsSection title="Appearance">
          <SettingsRow title="Theme" description="Choose your preferred appearance.">
            <ThemePicker
              value={settings.theme}
              onChange={(theme) => updateSetting("theme", theme)}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Interface">
          <SettingsRow title="Font size" description="Adjust the application font size.">
            <Select
              value={settings.font_size}
              onChange={(value) => updateSetting("font_size", value)}
              options={FONT_SIZE_OPTIONS}
              label="Font size"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Workspace">
          <SettingsRow
            title="Default folder"
            description="Select the folder to show on startup."
          >
            <Select
              value={settings.default_folder_id ?? ""}
              onChange={(value) => updateSetting("default_folder_id", value)}
              options={folderOptions}
              label="Default folder"
            />
          </SettingsRow>
        </SettingsSection>
      </>
    );
  };

  const renderEditor = () => (
    <SettingsSection title="Editor">
      <div className="py-8 text-center text-sm text-text-muted">
        Editor settings are coming soon.
      </div>
    </SettingsSection>
  );

  const renderTags = () => (
    <>
      <SettingsSection title="Create tag">
        <div className="py-4 flex items-center gap-3">
          <Input
            placeholder="Tag name"
            value={newName}
            onChange={setNewName}
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                  newColor === c ? "border-text scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <Button onClick={handleCreateTag}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Manage tags">
        {tags.length === 0 ? (
          <div className="text-center py-12 text-text-muted text-sm">
            No tags yet. Create one above.
          </div>
        ) : (
          <div className="space-y-2 py-2">
            {tags.map((tag, index) => {
              const isEditing = editingId === tag.id;
              return (
                <div
                  key={tag.id}
                  className="bg-surface-raised border border-border rounded-xl p-3 flex items-center gap-3"
                >
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => handleMoveTag(index, "up")}
                      disabled={index === 0}
                      className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={() => handleMoveTag(index, "down")}
                      disabled={index === tags.length - 1}
                      className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>

                  {isEditing ? (
                    <>
                      <Input value={editName} onChange={setEditName} className="flex-1" />
                      <div className="flex items-center gap-1">
                        {TAG_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-5 h-5 rounded-full border-2 transition-all cursor-pointer ${
                              editColor === c ? "border-text scale-110" : "border-transparent"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <Button onClick={() => handleUpdateTag(tag.id)}>
                        <Check size={14} />
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm text-text flex-1">{tag.name}</span>
                      <Button variant="ghost" className="text-xs" onClick={() => startEdit(tag)}>
                        Edit
                      </Button>
                      <button
                        onClick={() => handleDeleteTag(tag.id, tag.name)}
                        className="text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </>
  );

  const renderShortcuts = () => (
    <SettingsSection title="Shortcuts">
      <div className="py-8 text-center text-sm text-text-muted">
        Shortcut customization is coming soon.
      </div>
    </SettingsSection>
  );

  const renderAdvanced = () => {
    if (!settings) return null;
    return (
      <>
        <SettingsSection title="Safety">
          <SettingsRow
            title="Confirm before delete"
            description="Show a confirmation dialog before deleting connections or folders."
          >
            <Toggle
              checked={settings.confirm_before_delete}
              onChange={(checked) =>
                updateSetting("confirm_before_delete", checked ? "true" : "false")
              }
              label="Confirm before delete"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Default ports">
          <SettingsRow title="PostgreSQL" description="Default port for new PostgreSQL connections.">
            <Input
              type="number"
              value={defaultPorts.postgresql?.toString() ?? ""}
              onChange={(value) => updatePort("postgresql", value)}
              className="w-24"
            />
          </SettingsRow>
          <SettingsRow title="MySQL" description="Default port for new MySQL connections.">
            <Input
              type="number"
              value={defaultPorts.mysql?.toString() ?? ""}
              onChange={(value) => updatePort("mysql", value)}
              className="w-24"
            />
          </SettingsRow>
          <SettingsRow title="SQLite" description="Default port for new SQLite connections.">
            <Input
              type="number"
              value={defaultPorts.sqlite?.toString() ?? ""}
              onChange={(value) => updatePort("sqlite", value)}
              className="w-24"
            />
          </SettingsRow>
          <SettingsRow title="Redis" description="Default port for new Redis connections.">
            <Input
              type="number"
              value={defaultPorts.redis?.toString() ?? ""}
              onChange={(value) => updatePort("redis", value)}
              className="w-24"
            />
          </SettingsRow>
        </SettingsSection>
      </>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return renderGeneral();
      case "editor":
        return renderEditor();
      case "tags":
        return renderTags();
      case "shortcuts":
        return renderShortcuts();
      case "advanced":
        return renderAdvanced();
    }
  };

  return (
    <div className="min-h-screen bg-canvas select-none">
      {/* Mac-style title bar */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <Button variant="ghost" onClick={() => setActiveView("home")} className="gap-1 px-2">
          <ChevronLeft size={16} /> Back
        </Button>
        <h1 className="font-heading text-lg text-text">Settings</h1>
      </header>

      <div className="flex gap-6 px-6 py-6">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 space-y-1" aria-label="Settings sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer ${
                  activeTab === tab.id
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
          <AnimatePresence>
            <motion.div
              key={activeTab}
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