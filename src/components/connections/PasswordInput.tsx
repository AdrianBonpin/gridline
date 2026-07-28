import { useState, forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { KeyboardEvent } from "react";

interface PasswordInputProps {
  value?: string;
  placeholder?: string;
  className?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ onChange, onKeyDown, className = "", ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={`w-full rounded-full bg-surface border border-border px-4 py-2 pr-10 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer ${className}`}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => onKeyDown?.(e)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors cursor-pointer"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  }
);