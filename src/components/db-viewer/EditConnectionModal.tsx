import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { DetailedConnectionForm } from "../connections/DetailedConnectionForm";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { updateConnection, testConnection, saveConnectionPassword } from "../../lib/commands";
import type { Connection, ConnectionInput } from "../../lib/types";
import type { ConnectionFormData } from "../connections/connectionFormData";

interface EditConnectionModalProps {
  connection: Connection;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Connection) => void;
}

export function EditConnectionModal({
  connection,
  open,
  onClose,
  onSaved,
}: EditConnectionModalProps) {
  const [form, setForm] = useState<ConnectionFormData>(() => ({
    name: connection.name,
    environment: (connection.environment as ConnectionFormData["environment"]) ?? null,
    folder_id: connection.folder_id,
    tag_ids: [...connection.tag_ids],
    connection_string: "",
    db_type: connection.db_type,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: null,
    database: connection.database ?? null,
    use_keychain: false,
  }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const loadAll = useConnectionStore((s) => s.loadAll);
  const notify = useNotificationStore((s) => s.notify);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const input: ConnectionInput = {
        name: form.name,
        db_type: form.db_type,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        database: form.database,
        folder_id: form.folder_id,
        environment: form.environment,
        tag_ids: form.tag_ids,
      };
      const updated = await updateConnection(connection.id, input);
      if (form.password) {
        await saveConnectionPassword(connection.id, form.password).catch(() => {});
      }
      notify("Connection updated", "success");
      onSaved(updated);
      onClose();
      loadAll();
    } catch (e) {
      notify(`Failed to update: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setSaving(false);
    }
  }, [form, connection.id, notify, onSaved, onClose, loadAll]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const result = await testConnection({
        name: form.name,
        db_type: form.db_type,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        database: form.database,
        folder_id: form.folder_id,
        environment: form.environment,
        tag_ids: form.tag_ids,
      });
      if (result.ok) {
        notify("Connection successful", "success");
      } else {
        notify(result.error ?? "Connection failed", "error");
      }
    } catch (e) {
      notify(`Test failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setTesting(false);
    }
  }, [form, notify]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50">
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-surface border border-border shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Edit Connection</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">
          <DetailedConnectionForm form={form} onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))} />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={handleTest}
            disabled={testing}
            className="rounded-lg border border-border px-4 py-1.5 text-sm text-text hover:bg-surface-raised transition-colors disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}