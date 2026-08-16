import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Braces, Copy, Check, X } from "lucide-react";

interface JsonCellPopoverProps {
  value: unknown;
  anchorRect: DOMRect | null;
  onClose: () => void;
}

function safeJsonParse(value: unknown): object | null {
  if (typeof value === "object" && value !== null) return value as object;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function formatJson(obj: object): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function JsonCellPopover({ value, anchorRect, onClose }: JsonCellPopoverProps) {
  const [tab, setTab] = useState<"formatted" | "raw">("formatted");
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const parsed = safeJsonParse(value);
  const rawText = typeof value === "string" ? value : JSON.stringify(value);
  const formattedText = parsed ? formatJson(parsed) : rawText;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  const popoverWidth = 420;
  const popoverMaxHeight = 360;
  const gap = 8;
  let left = anchorRect.left;
  let top = anchorRect.bottom + gap;

  if (left + popoverWidth > window.innerWidth - 16) {
    left = Math.max(16, window.innerWidth - popoverWidth - 16);
  }
  if (top + popoverMaxHeight > window.innerHeight - 16) {
    top = anchorRect.top - popoverMaxHeight - gap;
    if (top < 16) top = 16;
  }

  const handleCopy = async () => {
    const text = tab === "formatted" ? formattedText : rawText;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
      style={{
        left,
        top,
        width: popoverWidth,
        maxHeight: popoverMaxHeight,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface/80">
        <div className="flex items-center gap-1.5 min-w-0">
          <Braces size={12} className="text-accent shrink-0" />
          <span className="text-xs font-heading text-text">JSON</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Tabs */}
          <div className="flex rounded bg-surface-raised border border-border overflow-hidden mr-1">
            <button
              onClick={() => setTab("formatted")}
              className={`px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                tab === "formatted" ? "bg-accent text-white" : "text-text-muted hover:text-text"
              }`}
            >
              Formatted
            </button>
            <button
              onClick={() => setTab("raw")}
              className={`px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                tab === "raw" ? "bg-accent text-white" : "text-text-muted hover:text-text"
              }`}
            >
              Raw
            </button>
          </div>
          {/* Copy */}
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors cursor-pointer"
            title="Copy to clipboard"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="overflow-auto p-3"
        style={{ maxHeight: popoverMaxHeight - 41 }}
      >
        <pre className="text-[11px] text-text font-mono whitespace-pre-wrap break-all leading-relaxed select-text">
          {tab === "formatted" ? formattedText : rawText}
        </pre>
      </div>
    </div>,
    document.body,
  );
}

/** Extract a brief label for the collapsed JSON preview shown in the cell. */
export function jsonPreview(value: unknown): { label: string; isJson: boolean } {
  const parsed = safeJsonParse(value);
  if (!parsed) return { label: "", isJson: false };
  if (Array.isArray(parsed)) {
    return { label: `[ ${parsed.length} item${parsed.length !== 1 ? "s" : ""} ]`, isJson: true };
  }
  const keys = Object.keys(parsed);
  return { label: `{ ${keys.length} key${keys.length !== 1 ? "s" : ""} }`, isJson: true };
}