import type { ReactNode } from "react";

interface SettingsRowProps {
  title: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
}

export function SettingsRow({ title, description, children, last }: SettingsRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-6 py-4 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{title}</div>
        {description && (
          <div className="text-xs text-text-muted mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}