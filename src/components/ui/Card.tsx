import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={`glass rounded-xl p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}