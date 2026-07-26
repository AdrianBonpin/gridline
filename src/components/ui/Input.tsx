interface InputProps {
  value?: string;
  placeholder?: string;
  className?: string;
  type?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export function Input({ onChange, className = "", ...rest }: InputProps) {
  return (
    <input
      className={`w-full rounded-full bg-surface border border-border px-4 py-2 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors ${className}`}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}