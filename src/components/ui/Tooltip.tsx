import { createContext, useContext, useId, useRef, useState, useCallback, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from "react";

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

function tooltipClasses(side: "top" | "right" | "bottom" | "left") {
  switch (side) {
    case "right":
      return {
        wrapper: "left-full ml-2 top-1/2 -translate-y-1/2",
        arrow: "right-full top-1/2 -translate-y-1/2 border-r-surface-raised",
      };
    case "bottom":
      return {
        wrapper: "top-full left-1/2 -translate-x-1/2 mt-2",
        arrow: "bottom-full left-1/2 -translate-x-1/2 border-b-surface-raised",
      };
    case "left":
      return {
        wrapper: "right-full mr-2 top-1/2 -translate-y-1/2",
        arrow: "left-full top-1/2 -translate-y-1/2 border-l-surface-raised",
      };
    case "top":
    default:
      return {
        wrapper: "bottom-full left-1/2 -translate-x-1/2 mb-2",
        arrow: "top-full left-1/2 -translate-x-1/2 border-t-surface-raised",
      };
  }
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const id = useId();
  const { activeId, setActiveId } = useTooltipContext();
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = activeId === id;
  const tc = tooltipClasses(side);

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

  return (
    <span
      className="relative inline-flex cursor-pointer"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {isActive && (
        <span
          role="tooltip"
          className={`absolute z-50 px-2 py-1 text-xs rounded-md bg-surface-raised border border-border text-text shadow-lg whitespace-nowrap ${tc.wrapper}`}
        >
          {content}
          <span
            className={`absolute border-4 border-transparent ${tc.arrow}`}
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}