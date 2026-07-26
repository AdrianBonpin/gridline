import { forwardRef } from "react";
import type { KeyboardEvent } from "react";

interface InputProps {
  value?: string;
  placeholder?: string;
  className?: string;
  type?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ onChange, onKeyDown, className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-full bg-surface border border-border px-4 py-2 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer ${className}`}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => onKeyDown?.(e)}
        {...rest}
      />
    );
  },
);