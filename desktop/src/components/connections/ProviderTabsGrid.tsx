import { PROVIDER_TABS, SETUP_GUIDES, type ProviderId } from "../../lib/providers";
import { DbIcon, ProviderIcon } from "../../lib/dbIcons";

interface ProviderTabsGridProps {
  selectedId?: ProviderId | null;
  onSelect: (id: ProviderId) => void;
}

export function ProviderTabsGrid({ selectedId, onSelect }: ProviderTabsGridProps) {
  return (
    <div data-testid="provider-grid" className="grid grid-cols-2 gap-3">
      {PROVIDER_TABS.map((p) => {
        const isSelected = selectedId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-label={p.label}
            className={`flex flex-col items-center gap-2 p-4 rounded-lg border bg-surface transition-colors cursor-pointer ${
              isSelected
                ? "border-accent text-text"
                : "border-border text-text-muted hover:border-accent/50 hover:text-text"
            }`}
          >
            <span className="w-8 h-8 flex items-center justify-center">
              {p.isManagedPreset ? <ProviderIcon id={p.id as "supabase" | "neon"} size={24} /> : <DbIcon type={p.dbType} size={24} />}
            </span>
            <span className="text-sm font-medium">{p.label}</span>
            {p.isManagedPreset && (
              <span className="text-[10px] text-text-muted text-center leading-tight">
                {SETUP_GUIDES[p.id as keyof typeof SETUP_GUIDES].blurb}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}