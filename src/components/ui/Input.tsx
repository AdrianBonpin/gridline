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
      className={`w-full rounded-md bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-accent ${className}`}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
}