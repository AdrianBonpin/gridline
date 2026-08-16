import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useSortedTags } from "../../hooks/useSortedTags";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  Plus,
  Trash2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";
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

/** Move `activeId` to `overId`'s position. Returns `order` unchanged if the
 * ids are equal, or either id is missing. */
export function reorderTagIds(order: string[], activeId: string, overId: string): string[] {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (activeId === overId || from === -1 || to === -1) return order;
  return arrayMove(order, from, to);
}

interface SortableTagRowProps {
  tag: Tag;
  index: number;
  count: number;
  editingId: string | null;
  editName: string;
  editColor: string;
  onEditNameChange: (value: string) => void;
  onEditColorChange: (color: string) => void;
  onStartEdit: (tag: Tag) => void;
  onCancelEdit: () => void;
  onUpdateTag: (id: string) => void;
  onDeleteTag: (id: string, name: string) => void;
  onMoveTag: (index: number, direction: "up" | "down") => void;
}

function SortableTagRow({
  tag,
  index,
  count,
  editingId,
  editName,
  editColor,
  onEditNameChange,
  onEditColorChange,
  onStartEdit,
  onCancelEdit,
  onUpdateTag,
  onDeleteTag,
  onMoveTag,
}: SortableTagRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id });

  const isEditing = editingId === tag.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-surface-raised border border-border rounded-xl p-3 flex items-center gap-3 relative ${
        isDragging ? "opacity-50 z-10 ring-1 ring-accent" : ""
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Drag to reorder ${tag.name}`}
        className="cursor-grab active:cursor-grabbing touch-none text-text-muted hover:text-text transition-colors shrink-0"
      >
        <GripVertical size={14} />
      </button>

      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onMoveTag(index, "up")}
          disabled={index === 0}
          className="text-text-muted hover:text-text disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          aria-label="Move tag up"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => onMoveTag(index, "down")}
          disabled={index === count - 1}
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
            onChange={onEditNameChange}
            className="flex-1"
            aria-label="Edit tag name"
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onEditColorChange(color)}
                className={`w-5 h-5 rounded-full border-2 transition-all cursor-pointer ${
                  editColor === color ? "border-text scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
          <Button onClick={() => onUpdateTag(tag.id)}>
            <Check size={14} />
          </Button>
          <Button variant="ghost" onClick={onCancelEdit}>
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
            onClick={() => onStartEdit(tag)}
          >
            Edit
          </Button>
          <button
            type="button"
            onClick={() => onDeleteTag(tag.id, tag.name)}
            className="text-text-muted hover:text-red-400 transition-colors cursor-pointer"
            aria-label={`Delete tag ${tag.name}`}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentOrder = tagOrder.length === tags.length ? tagOrder : tags.map((t) => t.id);
    const newOrder = reorderTagIds(currentOrder, String(active.id), String(over.id));
    setTagOrder(newOrder).catch((e) => notify(`Failed to reorder tags: ${e}`, "error"));
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  return (
    <div className="space-y-6">
      {/* Create — no section label */}
      <div className="flex items-center gap-3">
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

      {/* Manage tags — plain section, no card */}
      <section>
        <h2 className="text-sm font-medium text-text mb-3">Manage tags</h2>
        {tags.length === 0 ? (
          <div className="text-center py-12 text-text-muted text-sm">
            No tags yet. Create one above.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tags.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {tags.map((tag, index) => (
                  <SortableTagRow
                    key={tag.id}
                    tag={tag}
                    index={index}
                    count={tags.length}
                    editingId={editingId}
                    editName={editName}
                    editColor={editColor}
                    onEditNameChange={setEditName}
                    onEditColorChange={setEditColor}
                    onStartEdit={startEdit}
                    onCancelEdit={() => setEditingId(null)}
                    onUpdateTag={handleUpdateTag}
                    onDeleteTag={handleDeleteTag}
                    onMoveTag={handleMoveTag}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </div>
  );
}