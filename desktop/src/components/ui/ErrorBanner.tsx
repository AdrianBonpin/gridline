interface ErrorBannerProps {
  error: string | null;
  onRetry: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-md px-4 py-2 mb-4">
      <span className="text-red-300 text-sm">{error}</span>
      <button onClick={onRetry} className="text-sm text-text-muted underline hover:text-text">Retry</button>
    </div>
  );
}