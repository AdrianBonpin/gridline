import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

interface TooltipContextValue {
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext() {
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error("Tooltip must be used inside a TooltipProvider");
  }
  return ctx;
}

interface TooltipProviderProps {
  children: ReactNode;
}

export function TooltipProvider({ children }: TooltipProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <TooltipContext.Provider value={{ activeId, setActiveId }}>
      {children}
    </TooltipContext.Provider>
  );
}

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}

const GAP = 8;
const VIEWPORT_MARGIN = 4;

/**
 * Tooltip that renders into `document.body` via a portal and positions itself
 * with fixed coordinates relative to its trigger. Rendering through a portal
 * means tooltips are never clipped by `overflow`/`transform` ancestors (e.g.
 * scrollable dropdowns or panels).
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const id = useId();
  const { activeId, setActiveId } = useTooltipContext();
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const isActive = activeId === id;

  const clearTimer = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    showTimer.current = setTimeout(() => {
      setActiveId(id);
    }, 300);
  }, [clearTimer, id, setActiveId]);

  const hide = useCallback(() => {
    clearTimer();
    setActiveId((prev) => (prev === id ? null : prev));
  }, [clearTimer, id, setActiveId]);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltipEl = tooltipRef.current;
    if (!trigger || !tooltipEl) return;

    const tr = trigger.getBoundingClientRect();
    const tt = tooltipEl.getBoundingClientRect();

    let top = 0;
    let left = 0;
    switch (side) {
      case "right":
        top = tr.top + tr.height / 2 - tt.height / 2;
        left = tr.right + GAP;
        break;
      case "bottom":
        top = tr.bottom + GAP;
        left = tr.left + tr.width / 2 - tt.width / 2;
        break;
      case "left":
        top = tr.top + tr.height / 2 - tt.height / 2;
        left = tr.left - tt.width - GAP;
        break;
      case "top":
      default:
        top = tr.top - tt.height - GAP;
        left = tr.left + tr.width / 2 - tt.width / 2;
        break;
    }

    // Keep the tooltip fully inside the viewport.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - tt.height - VIEWPORT_MARGIN));
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tt.width - VIEWPORT_MARGIN));

    setPos({ top, left });
  }, [side]);

  // Position the tooltip once it is visible, and keep it glued to the trigger
  // while scrolling (capture phase catches scrolls in any container).
  useLayoutEffect(() => {
    if (!isActive) {
      setPos(null);
      return;
    }
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [isActive, measure]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex cursor-pointer"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {isActive &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            className="fixed z-50 px-2 py-1 text-xs rounded-md bg-surface-raised border border-border text-text shadow-lg whitespace-nowrap"
            style={pos ?? undefined}
          >
            {content}
            {side === "top" && (
              <span
                className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-surface-raised"
                aria-hidden="true"
              />
            )}
            {side === "bottom" && (
              <span
                className="absolute left-1/2 -translate-x-1/2 bottom-full border-4 border-transparent border-b-surface-raised"
                aria-hidden="true"
              />
            )}
            {side === "left" && (
              <span
                className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-surface-raised"
                aria-hidden="true"
              />
            )}
            {side === "right" && (
              <span
                className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-surface-raised"
                aria-hidden="true"
              />
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}