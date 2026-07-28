import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSortedTags } from "../../hooks/useSortedTags";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SettingsSection } from "../ui/SettingsSection";
import { Plus, Trash2, Check, X, ChevronUp, ChevronDown } from "lucide-react";
import type { Tag } from "../../lib/types";

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

export function TagsSettingsTab() {
  const tags = useSortedTags();
  const tagOrder = useConnectionStore((s) => s.tagOrder);
  const setTagOrder = useConnectionStore((s) => s.setTagOrder);
  const createTag = useConnectionStore((s) => s.createTag);
  const updateTag = useConnectionStore((s) => s.updateTag);
  const deleteTag = useConnectionStore((s) => s.deleteTag);
  const notify = useNotificationStore((s) => s.notify);

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

  return (
    <>
      <SettingsSection title="Create tag">
        <div className="py-4 flex items-center gap-3">
          <Input
            placeholder="Tag name"
            value={newName}
            onChange={setNewName}
            className="flex-1"
            aria-label="New tag name"
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setNewColor(color)}
                className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                  newColor === color ? "border-text scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
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
                      type="button"
                      onClick={() => handleMoveTag(index, "up")}
                      disabled={index === 0}
                      className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      aria-label="Move tag up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveTag(index, "down")}
                      disabled={index === tags.length - 1}
                      className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      aria-label="Move tag down"
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
                        aria-label="Edit tag name"
                      />
                      <div className="flex items-center gap-1">
                        {TAG_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setEditColor(color)}
                            className={`w-5 h-5 rounded-full border-2 transition-all cursor-pointer ${
                              editColor === color ? "border-text scale-110" : "border-transparent"
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={`Select color ${color}`}
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
                      <Button
                        variant="ghost"
                        className="text-xs"
                        onClick={() => startEdit(tag)}
                      >
                        Edit
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTag(tag.id, tag.name)}
                        className="text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                        aria-label={`Delete tag ${tag.name}`}
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
}