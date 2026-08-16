import type { RoleInfo } from "../../../lib/types";
import { FormSectionHeader } from "./formRow";
import { RoleGrantsEditor } from "./RoleGrantsEditor";

interface Props {
  connectionId: string;
  item: RoleInfo;
}

interface AttributeRow {
  label: string;
  value: string;
  highlight?: boolean;
}

export function RoleDetail({ connectionId, item }: Props) {
  const attributes: AttributeRow[] = [
    { label: "Can login", value: item.can_login ? "Yes" : "No", highlight: item.can_login },
    { label: "Superuser", value: item.superuser ? "Yes" : "No", highlight: item.superuser },
    { label: "Create databases", value: item.create_db ? "Yes" : "No", highlight: item.create_db },
    { label: "Create roles", value: item.create_role ? "Yes" : "No", highlight: item.create_role },
    { label: "Inherit privileges", value: item.inherit ? "Yes" : "No", highlight: item.inherit },
    { label: "Replication", value: item.replication ? "Yes" : "No", highlight: item.replication },
    { label: "Bypass RLS", value: item.bypass_rls ? "Yes" : "No", highlight: item.bypass_rls },
    { label: "Connection limit", value: String(item.connection_limit) },
    { label: "Valid until", value: item.valid_until ?? "Never" },
  ];

  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Role</span>
      </div>
      <div className="border-b border-border px-4 py-2 flex items-center">
        <span className="text-xs text-text-muted w-28 shrink-0">Name</span>
        <span className="text-sm text-accent font-mono">{item.name}</span>
      </div>

      <div className="border-b border-border px-4 py-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Attributes</span>
      </div>
      {attributes.map((attr) => (
        <div key={attr.label} className="border-b border-border flex flex-row">
          <div className="border-r border-border px-4 py-2 flex items-center w-40 shrink-0">
            <span className="text-xs text-text-muted">{attr.label}</span>
          </div>
          <div className="px-4 py-2 flex items-center flex-1">
            <span className={`text-sm ${attr.highlight ? "text-emerald-400" : "text-text-muted"}`}>
              {attr.value}
            </span>
          </div>
        </div>
      ))}

      <div className="border-b border-border">
        <FormSectionHeader label="Member of" count={item.memberships.length} />
        {item.memberships.length === 0 && (
          <p className="px-4 py-2 text-xs text-text-muted">Not a member of any role.</p>
        )}
        {item.memberships.map((m, i) => (
          <div key={`${m.role}-${m.member}-${i}`} className="border-b border-border px-4 py-2 flex items-center">
            <span className="text-xs text-text-muted w-28 shrink-0">Role</span>
            <span className="text-sm text-accent font-mono">{m.member}</span>
            <span className="ml-2 text-xs text-text-muted">of {m.role}</span>
            {m.admin_option && (
              <span className="ml-2 text-[10px] text-amber-400 uppercase tracking-wider">admin</span>
            )}
          </div>
        ))}
      </div>

      <RoleGrantsEditor connectionId={connectionId} role={item.name} />
    </div>
  );
}