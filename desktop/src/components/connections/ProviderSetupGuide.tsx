import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SETUP_GUIDES } from "../../lib/providers";

interface ProviderSetupGuideProps {
  provider: "supabase" | "neon" | "planetscale";
}

const SSL_NOTE: Record<"supabase" | "neon" | "planetscale", string> = {
  supabase: "SSL is required by Supabase.",
  neon: "Neon requires SSL.",
  planetscale: "PlanetScale requires SSL with identity verification.",
};

export function ProviderSetupGuide({ provider }: ProviderSetupGuideProps) {
  const [open, setOpen] = useState(false);
  const guide = SETUP_GUIDES[provider];

  return (
    <div className="mt-2 border border-border rounded-lg bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="How to connect"
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-text-muted hover:text-text cursor-pointer transition-colors"
      >
        <span>How to connect</span>
        <ChevronDown
          size={14}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
          aria-hidden="true"
        />
      </button>

      {guide.sslRequired && (
        <p className="px-3 pb-2 text-xs text-accent-muted">{SSL_NOTE[provider]}</p>
      )}

      {open && (
        <ol className="px-3 pb-3 space-y-2 list-decimal list-inside text-xs text-text-muted">
          {guide.steps.map((step, i) => (
            <li key={i} className="space-y-0.5">
              <span className="text-text font-medium">{step.title}</span>
              <p className="text-text-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}