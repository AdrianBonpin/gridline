import { useSettingsStore } from "../../stores/settingsStore";
import { Input } from "../ui/Input";
import { Toggle } from "../ui/Toggle";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSection } from "../ui/SettingsSection";
import type { DbType } from "../../lib/types";

const DB_TYPES: { id: DbType; label: string }[] = [
  { id: "postgresql", label: "PostgreSQL" },
  { id: "mysql", label: "MySQL" },
  { id: "sqlite", label: "SQLite" },
  { id: "redis", label: "Redis" },
];

export function AdvancedSettingsTab() {
  const { settings, updateSetting } = useSettingsStore();

  if (!settings) return null;

  const defaultPorts = settings.default_ports ?? {
    postgresql: 5432,
    mysql: 3306,
    sqlite: null,
    redis: 6379,
  };

  const updatePort = (key: string, value: string) => {
    const port = value === "" ? null : Number(value);
    const next = { ...defaultPorts, [key]: port };
    updateSetting("default_ports", JSON.stringify(next));
  };

  return (
    <>
      <SettingsSection title="Safety">
        <SettingsRow
          title="Confirm before delete"
          description="Show a confirmation dialog before deleting connections or folders."
        >
          <Toggle
            checked={settings.confirm_before_delete}
            onChange={(checked) =>
              updateSetting("confirm_before_delete", checked ? "true" : "false")
            }
            label="Confirm before delete"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Default ports">
        {DB_TYPES.map((db) => (
          <SettingsRow
            key={db.id}
            title={db.label}
            description={`Default port for new ${db.label} connections.`}
          >
            <Input
              type="number"
              value={defaultPorts[db.id]?.toString() ?? ""}
              onChange={(value) => updatePort(db.id, value)}
              className="w-24"
              aria-label={`Default port for ${db.label}`}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </>
  );
}