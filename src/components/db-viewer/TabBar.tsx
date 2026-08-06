import { cloneElement, useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListChecks, Play, Table2, Layers, Eye, Terminal, X, Plus, Pencil } from "lucide-react";
import { useDbViewerStore, type ViewerTab } from "../../stores/dbViewerStore";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { OBJECT_ICONS } from "./objects/ObjectDetail";

function SortableTab({
  tab,
  isActive,
  icon,
  onSelect,
  onClose,
}: {
  tab: ViewerTab;
  isActive: boolean;
  icon: ReactNode;
  onSelect: () => void;
  onClose: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: rawTransform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  // dnd-kit scales the dragged item to the width of whichever tab it is
  // hovering over (adjustScale). Tabs have different widths, which would warp
  // the text — always render at scale 1 and let the horizontal strategy handle
  // positioning.
  const transform = rawTransform
    ? { ...rawTransform, scaleX: 1, scaleY: 1 }
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      role="tab"
      aria-selected={isActive}
      aria-label={tab.table}
      {...listeners}
      onClick={onSelect}
      className={[
        "group flex shrink-0 items-center gap-2 border-r border-border px-3 text-sm transition-colors cursor-grab active:cursor-grabbing select-none",
        isActive ? "bg-canvas text-text" : "text-text-muted hover:text-text",
        isDragging ? "opacity-50 z-10 ring-1 ring-accent" : "",
      ].join(" ")}
    >
      <span className="flex-1 text-left select-none">{icon}{tab.table}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${tab.table}`}
        className="rounded p-0.5 opacity-60 transition-opacity hover:bg-surface-raised hover:opacity-100 cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TabBar({ onCommitted }: { onCommitted?: () => void } = {}) {
  const tabs = useDbViewerStore((state) => state.tabs);
  const tables = useDbViewerStore((state) => state.tables);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const closeTab = useDbViewerStore((state) => state.closeTab);
  const setActiveTab = useDbViewerStore((state) => state.setActiveTab);
  const openQueryTab = useDbViewerStore((state) => state.openQueryTab);
  const reorderTab = useDbViewerStore((state) => state.reorderTab);
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const changesPanelExpanded = useDbViewerStore(
    (state) => state.changesPanelExpanded,
  );
  const toggleChangesPanel = useDbViewerStore(
    (state) => state.toggleChangesPanel,
  );

  // Drag threshold so a click still selects the tab; a deliberate drag (>= 4px)
  // starts a reorder. Keyboard sorting uses arrow keys, one axis only.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Keep the dragged tab on the tab strip: zero out any vertical movement so
  // dragging is constrained to the horizontal axis only.
  const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
    ...transform,
    y: 0,
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = tabs.findIndex((t) => t.id === active.id);
    const to = tabs.findIndex((t) => t.id === over.id);
    if (from >= 0 && to >= 0) reorderTab(from, to);
  };

  const pendingCount = changesQueue.filter(
    (c) => c.status === "pending",
  ).length;

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!changesPanelExpanded) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        toggleChangesPanel();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleChangesPanel();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [changesPanelExpanded, toggleChangesPanel]);

  return (
    <div className="flex h-9 items-stretch border-b border-border">
      {/* Left: open tabs (scrollable) */}
      <div
        className="flex flex-1 min-w-0 items-stretch overflow-x-auto"
        role="tablist"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex items-stretch">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const objectType =
                  tab.tabType === "table"
                    ? tables.find(
                          (t) =>
                              t.schema === tab.schema && t.name === tab.table,
                      )?.table_type
                    : undefined;
                const icon =
                  tab.tabType === "query" ? (
                    <Terminal
                      data-testid="tab-icon-query"
                      className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                    />
                  ) : tab.tabType === "object" ? (
                    <span
                        aria-label={`object icon: ${tab.objectType}`}
                        className="contents"
                    >
                      {cloneElement(
                          OBJECT_ICONS[tab.objectType!] as ReactElement<{
                              className?: string;
                          }>,
                          {
                              // Same handling as the query/table icons: the svg
                              // itself is display:inline (preflight vertical-align:
                              // middle centers it with the text) with the same
                              // optical-centering nudge. `display: contents` on the
                              // labelled span renders no box, so the geometry is
                              // identical to the bare Terminal/Table2 icons.
                              className:
                                  "mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current",
                          },
                      )}
                    </span>
                  ) : tab.tabType === "objectForm" ? (
                    tab.form?.mode === "create" ? (
                      <Plus
                        data-testid="tab-icon-form-create"
                        className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                      />
                    ) : (
                      <Pencil
                        data-testid="tab-icon-form-edit"
                        className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                      />
                    )
                  ) : objectType === "VIEW" ? (
                    <Eye
                      data-testid="tab-icon-view"
                      className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                    />
                  ) : objectType === "MATERIALIZED VIEW" ? (
                    <Layers
                      data-testid="tab-icon-matview"
                      className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                    />
                  ) : (
                    <Table2
                      data-testid="tab-icon-table"
                      className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                    />
                  );
                return (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    icon={icon}
                    onSelect={() => setActiveTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Right: fixed actions */}
      <div className="flex shrink-0 items-center gap-1.5 border-l border-border px-2">
        <button
          type="button"
          onClick={openQueryTab}
          aria-label="New query tab"
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover cursor-pointer"
        >
          <Play className="h-3 w-3 fill-current" />
          Query
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              if (changesQueue.length > 0) toggleChangesPanel();
            }}
            aria-label="Changes queue"
            className={[
              "flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              pendingCount > 0
                ? "text-amber-400 border-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
                : "border-border text-text-muted hover:text-text hover:bg-surface-raised",
            ].join(" ")}
          >
            <ListChecks className="h-3.5 w-3.5" />
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
          {changesPanelExpanded && (
            <div className="absolute right-0 top-full mt-1.5 z-30 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl bg-surface border border-border shadow-lg overflow-hidden">
              <ChangesQueuePanel onCommitted={onCommitted} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}