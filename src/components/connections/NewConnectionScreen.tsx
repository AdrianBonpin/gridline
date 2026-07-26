import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { ConnectionFormShell } from "./ConnectionFormShell";
import { SimpleConnectionForm } from "./SimpleConnectionForm";
import { DetailedConnectionForm } from "./DetailedConnectionForm";
import { parseConnectionString } from "../../lib/connectionString";
import { validateConnectionInput } from "../../lib/utils";
import { testConnection } from "../../lib/commands";
import type { DbType, Folder, Tag, NewConnectionMode, ConnectionInput } from "../../lib/types";
import type { ConnectionFormData } from "./connectionFormData";

interface NewConnectionScreenProps {
  defaultFolderId?: string | null;
  prefilledConnectionString?: string;
  folders: Folder[];
  tags: Tag[];
  onSaved?: () => void;
  onCancel?: () => void;
}

const DEFAULT_PORTS: Record<DbType, number | null> = {
  postgresql: 5432,
  mysql: 3306,
  sqlite: null,
  redis: 6379,
};

function createEmptyForm(defaultFolderId: string | null = null): ConnectionFormData {
  return {
    name: "",
    environment: null,
    folder_id: defaultFolderId,
    tag_ids: [],
    connection_string: "",
    db_type: "postgresql",
    host: "",
    port: 5432,
    username: null,
    password: null,
    database: null,
    use_keychain: false,
  };
}

export function NewConnectionScreen({
  defaultFolderId = null,
  prefilledConnectionString = "",
  folders,
  tags,
  onSaved,
  onCancel,
}: NewConnectionScreenProps) {
  const [mode, setMode] = useState<NewConnectionMode>("simple");
  const [form, setForm] = useState<ConnectionFormData>(() =>
    createEmptyForm(defaultFolderId)
  );
  const [testLoading, setTestLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const createConnection = useConnectionStore((s) => s.createConnection);
  const notify = useNotificationStore((s) => s.notify);

  useEffect(() => {
    if (prefilledConnectionString) {
      handleConnectionStringChange(prefilledConnectionString);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledConnectionString]);

  const updateForm = useCallback((updates: Partial<ConnectionFormData>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleConnectionStringChange = useCallback((value: string) => {
    setForm((prev) => {
      const parsed = parseConnectionString(value);
      if (!parsed) return { ...prev, connection_string: value };
      return {
        ...prev,
        connection_string: value,
        db_type: parsed.db_type,
        host: parsed.host,
        port: parsed.port ?? DEFAULT_PORTS[parsed.db_type],
        username: parsed.username,
        password: parsed.password,
        database: parsed.database,
      };
    });
  }, []);

  const buildPayload = useCallback((): ConnectionInput => {
    return {
      name: form.name,
      db_type: form.db_type,
      host: form.host,
      port: form.port,
      username: form.username,
      folder_id: form.folder_id,
      tag_ids: form.tag_ids,
      connection_string: form.connection_string,
      environment: form.environment,
      password: form.password,
      database: form.database,
      use_keychain: form.use_keychain,
    };
  }, [form]);

  const validate = useCallback((): string | null => {
    const result = validateConnectionInput(buildPayload());
    return result.ok ? null : result.error;
  }, [buildPayload]);

  const handleSave = async () => {
    const error = validate();
    if (error) {
      notify(error, "error");
      return;
    }
    setSaveLoading(true);
    try {
      await createConnection(buildPayload());
      notify("Connection saved", "success");
      onSaved?.();
    } catch (e) {
      notify(`Failed to save connection: ${e}`, "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTest = async () => {
    const error = validate();
    if (error) {
      notify(error, "error");
      return;
    }
    setTestLoading(true);
    try {
      const result = await testConnection(buildPayload());
      if (result.ok) {
        notify("Connection successful", "success");
      } else {
        notify(result.error ?? "Connection failed", "error");
      }
    } catch (e) {
      notify(`Connection test failed: ${e}`, "error");
    } finally {
      setTestLoading(false);
    }
  };

  const onSimpleChange = (updates: Partial<ConnectionFormData>) => {
    if ("connection_string" in updates && updates.connection_string !== undefined) {
      handleConnectionStringChange(updates.connection_string);
    } else {
      updateForm(updates);
    }
  };

  return (
    <ConnectionFormShell
      db_type={form.db_type}
      mode={mode}
      onBack={() => onCancel?.()}
      onTest={handleTest}
      onSave={handleSave}
      onToggleMode={() => setMode((m) => (m === "simple" ? "detailed" : "simple"))}
      testLoading={testLoading}
      saveLoading={saveLoading}
    >
      {mode === "simple" ? (
        <SimpleConnectionForm
          form={form}
          folders={folders}
          tags={tags}
          onChange={onSimpleChange}
        />
      ) : (
        <DetailedConnectionForm form={form} onChange={updateForm} />
      )}
    </ConnectionFormShell>
  );
}