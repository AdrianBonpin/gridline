import { forwardRef } from "react";
import type { KeyboardEvent } from "react";

interface ConnectionStringInputProps {
  value?: string;
  placeholder?: string;
  className?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export const ConnectionStringInput = forwardRef<HTMLInputElement, ConnectionStringInputProps>(
  function ConnectionStringInput({ onChange, onKeyDown, className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg bg-surface border border-border px-4 py-3 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer font-mono ${className}`}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => onKeyDown?.(e)}
        {...rest}
      />
    );
  }
);