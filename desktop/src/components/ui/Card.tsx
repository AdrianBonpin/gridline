import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-4 transition-colors hover:border-border-hover ${className}`} {...rest}>
      {children}
    </div>
  );
}