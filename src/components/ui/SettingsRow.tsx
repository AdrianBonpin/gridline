import type { ReactNode } from "react";

interface SettingsRowProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsRow({ title, description, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0 overflow-hidden">
        <div className="text-sm font-medium text-text truncate">{title}</div>
        {description && (
          <div className="text-xs text-text-muted mt-0.5 truncate">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}