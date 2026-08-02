import { useEffect, useRef, useState } from "react";
import {
    Activity,
    ChevronRight,
    CircleCheck,
    CircleX,
    Copy,
    Loader2,
    MoreVertical,
    Pencil,
    Star,
    Trash2,
} from "lucide-react";
import type { Connection } from "../../lib/types";
import { useConnectionStore } from "../../stores/connectionStore";
import { buildConfigFromConnection } from "./ConnectionCard";
import { useConnectionStatus } from "./useConnectionStatus";

interface ConnectionCardMenuProps {
    connection: Connection;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}

const menuItemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text hover:bg-surface transition-colors cursor-pointer";

/**
 * Kebab (⋮) actions menu for a connection card. Hosts the favorite toggle,
 * on-demand connection test (inline status), and a Manage submenu
 * (Edit… / Duplicate / Delete…). Closes on outside mousedown, Escape, and
 * after selecting an action.
 */
export function ConnectionCardMenu({
    connection,
    onEdit,
    onDuplicate,
    onDelete,
}: ConnectionCardMenuProps) {
    const [open, setOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const { state, info, check } = useConnectionStatus(
        connection.id,
        (pw) => buildConfigFromConnection(connection, pw),
    );

    useEffect(() => {
        if (!open) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
                setManageOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setManageOpen(false);
            }
        };
        // Capture phase so we fire before other stopPropagation handlers
        document.addEventListener("mousedown", handleMouseDown, true);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    const toggleMenu = () => {
        setOpen((prev) => {
            const next = !prev;
            if (!next) setManageOpen(false);
            return next;
        });
    };

    const close = () => {
        setOpen(false);
        setManageOpen(false);
    };

    const statusLabel =
        state === "checking"
            ? "Testing…"
            : state === "online"
              ? `Online${info ? ` · ${info}` : ""}`
              : state === "offline"
                ? info
                : "Test connection";

    const statusIcon =
        state === "checking" ? (
            <Loader2 size={14} className="animate-spin text-text-muted" />
        ) : state === "online" ? (
            <CircleCheck size={14} className="shrink-0 text-green-500" />
        ) : state === "offline" ? (
            <CircleX size={14} className="shrink-0 text-red-500" />
        ) : (
            <Activity size={14} className="text-text-muted" />
        );

    return (
        <div className="absolute top-1/2 -translate-y-1/2 right-1 z-10" ref={menuRef}>
            <button
                type="button"
                aria-label="Connection actions"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={(e) => {
                    e.stopPropagation();
                    toggleMenu();
                }}
                className={`rounded-md p-1 text-text-muted hover:text-text hover:bg-surface transition-colors cursor-pointer ${
                    open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
            >
                <MoreVertical size={16} />
            </button>
            {open && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full right-0 mt-1 w-64 rounded-md border border-border bg-canvas shadow-lg z-20 py-1 text-xs"
                >
                    <button
                        type="button"
                        onClick={() => {
                            void useConnectionStore
                                .getState()
                                .toggleFavorite(connection.id)
                                .catch(() => {});
                            close();
                        }}
                        className={menuItemClass}
                    >
                        <Star
                            size={14}
                            className={
                                connection.favorite
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-text-muted"
                            }
                        />
                        <span className="truncate">
                            {connection.favorite
                                ? "Remove from favorites"
                                : "Add to favorites"}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            void check();
                        }}
                        className={menuItemClass}
                    >
                        {statusIcon}
                        <span
                            className={
                                state === "offline"
                                    ? "whitespace-normal break-words text-red-500"
                                    : "truncate"
                            }
                        >
                            {statusLabel}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setManageOpen((m) => !m)}
                        className={`${menuItemClass} justify-between`}
                    >
                        <span>Manage</span>
                        <ChevronRight
                            size={14}
                            className={`text-text-muted transition-transform ${
                                manageOpen ? "rotate-90" : ""
                            }`}
                        />
                    </button>

                    {manageOpen && (
                        <div className="mt-1 border-t border-border pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    onEdit();
                                    close();
                                }}
                                className={`${menuItemClass} pl-6`}
                            >
                                <Pencil size={14} className="text-text-muted" />
                                Edit…
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onDuplicate();
                                    close();
                                }}
                                className={`${menuItemClass} pl-6`}
                            >
                                <Copy size={14} className="text-text-muted" />
                                Duplicate
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onDelete();
                                    close();
                                }}
                                className={`${menuItemClass} pl-6 !text-red-500 hover:!text-red-400`}
                            >
                                <Trash2 size={14} className="text-red-500" />
                                Delete…
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}