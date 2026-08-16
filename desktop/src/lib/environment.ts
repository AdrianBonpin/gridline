export type Environment = "production" | "staging" | "development" | null;

export const ENV_LABELS: Record<string, string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
};

export const ENV_COLORS: Record<string, string> = {
  production: "bg-red-500/20 text-red-400 border-red-500/30",
  staging: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  development: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};