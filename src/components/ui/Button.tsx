import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-border hover:border-border-hover";
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-hover shadow-none",
    secondary: "bg-surface-raised text-text-muted hover:text-text",
    ghost: "bg-transparent text-text-muted hover:text-text",
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}