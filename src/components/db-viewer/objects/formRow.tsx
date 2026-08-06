import type { ReactNode } from "react";

export const inputClass =
  "min-w-0 flex-1 bg-transparent px-3 font-heading text-xs text-text outline-none placeholder:text-text-muted";
export const controlClass =
  "min-w-0 flex-1 rounded bg-surface px-2 py-1 font-heading text-xs text-text outline-none placeholder:text-text-muted";
export const monoInputClass =
  "min-w-0 flex-1 bg-transparent px-3 font-mono text-xs text-text outline-none placeholder:text-text-muted";

export interface FormRowProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function FormRow({ label, children, className }: FormRowProps) {
  return (
    <div
      className={[
        "border-b border-border flex flex-row items-stretch",
        className ?? "",
      ].join(" ")}
    >
      <div className="border-r border-border px-4 py-2 flex items-center w-40 shrink-0">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex-1 min-w-0 flex flex-row items-center focus-within:outline focus-within:outline-2 focus-within:outline-amber-400 focus-within:outline-offset-[-2px]">
        {children}
      </div>
    </div>
  );
}

export function FormSectionHeader({
  label,
  count,
}: {
  label: string;
  count?: number | string;
}) {
  return (
    <div className="border-b border-border px-4 py-2 flex items-center justify-between">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      {count !== undefined && (
        <span className="text-[10px] text-text-subtle">{count}</span>
      )}
    </div>
  );
}