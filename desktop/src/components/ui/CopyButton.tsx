import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  /** Text written to the clipboard. */
  text: string;
  /** Accessible name; also the tooltip. */
  label?: string;
  className?: string;
}

/**
 * Small inline copy control with a transient "Copied" confirmation.
 *
 * Clipboard writes are best-effort: `navigator.clipboard` is absent in some
 * webview contexts and can reject on permission grounds, so a failure leaves
 * the label unchanged instead of surfacing an error the user cannot act on.
 */
export function CopyButton({
  text,
  label = "Copy to clipboard",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] transition-colors cursor-pointer text-text-muted hover:text-text ${className}`}
    >
      {copied ? (
        <>
          <Check size={11} className="text-emerald-400" />
          Copied
        </>
      ) : (
        <>
          <Copy size={11} />
          Copy
        </>
      )}
    </button>
  );
}
