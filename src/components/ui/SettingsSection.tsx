import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-text mb-1">{title}</h2>
      <div className="bg-surface border border-border rounded-xl px-4 overflow-hidden">
        {children}
      </div>
    </section>
  );
}