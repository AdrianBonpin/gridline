import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSortedTags } from "../../hooks/useSortedTags";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Plus, Trash2, Check, X, Palette, ChevronUp, ChevronDown } from "lucide-react";

const TAG_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899", "#78716c",
];

type SettingsTab = "tags";

export function SettingsPage() {
  const setActiveView = useUiStore((s) => s.setActiveView);
  const tags = useSortedTags();
  const tagOrder = useConnectionStore((s) => s.tagOrder);
  const setTagOrder = useConnectionStore((s) => s.setTagOrder);
  const createTag = useConnectionStore((s) => s.createTag);
  const updateTag = useConnectionStore((s) => s.updateTag);
  const deleteTag = useConnectionStore((s) => s.deleteTag);
  const notify = useNotificationStore((s) => s.notify);
  const [activeTab, setActiveTab] = useState<SettingsTab>("tags");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

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
    const newOrder = [...tagOrder.length === tags.length ? tagOrder : tags.map((t) => t.id)];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    try {
      await setTagOrder(newOrder);
    } catch (e) {
      notify(`Failed to reorder tags: ${e}`, "error");
    }
  };

  const startEdit = (tag: { id: string; name: string; color: string }) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  return (
    <div className="min-h-screen bg-canvas select-none">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-heading text-2xl text-text">Settings</h1>
          <Button variant="ghost" onClick={() => setActiveView("home")}>Back</Button>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <nav className="w-48 shrink-0 space-y-1">
            <button
              onClick={() => setActiveTab("tags")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer ${
                activeTab === "tags"
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text hover:bg-surface-raised"
              }`}
            >
              <Palette size={16} /> Tags
            </button>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeTab === "tags" && (
              <div>
                <h2 className="font-heading text-lg text-text mb-4">Manage Tags</h2>

                {/* Create new tag */}
                <div className="bg-surface border border-border rounded-xl p-4 mb-6">
                  <h3 className="text-sm font-medium text-text mb-3">Create Tag</h3>
                  <div className="flex items-center gap-3">
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
                </div>

                {/* Tag list */}
                {tags.length === 0 ? (
                  <div className="text-center py-12 text-text-muted text-sm">
                    No tags yet. Create one above.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tags.map((tag, index) => {
                      const isEditing = editingId === tag.id;
                      return (
                        <div
                          key={tag.id}
                          className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3"
                        >
                          {/* Reorder buttons */}
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
                              <Input
                                value={editName}
                                onChange={setEditName}
                                className="flex-1"
                              />
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}