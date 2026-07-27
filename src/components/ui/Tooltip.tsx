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
}

export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const { activeId, setActiveId } = useTooltipContext();
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {isActive && (
        <span
          role="tooltip"
          className="absolute z-50 px-2 py-1 text-xs rounded-md bg-surface-raised border border-border text-text shadow-lg whitespace-nowrap bottom-full left-1/2 -translate-x-1/2 mb-2"
        >
          {content}
          <span
            className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-surface-raised"
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}