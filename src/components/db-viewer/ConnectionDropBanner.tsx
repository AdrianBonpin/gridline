import { AlertTriangle, X } from "lucide-react";

interface ConnectionDropBannerProps {
  error: string;
  onRetry: () => void;
  onDismiss?: () => void;
}

export function ConnectionDropBanner({ error, onRetry, onDismiss }: ConnectionDropBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/20 rounded-md px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle size={18} className="text-red-400 shrink-0" />
        <span className="text-red-300 text-sm truncate">{error}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRetry}
          className="text-sm px-3 py-1.5 rounded-md bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors"
        >
          Reconnect
        </button>
        <button
          type="button"
          aria-label="Dismiss error"
          onClick={onDismiss}
          className="p-1.5 rounded-md text-red-300 hover:bg-red-500/20 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}