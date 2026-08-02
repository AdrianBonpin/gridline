import { useState, useCallback } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
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
    ssh_password: null,
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
        ssh_password: form.ssh_password ?? null,
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
      // Fetch password from keychain if not provided in form
      let password = form.password;
      if (!password) {
        password = await useConnectionStore.getState().getConnectionPassword(connection.id).catch(() => null);
      }

      const result = await testConnection({
        name: form.name,
        db_type: form.db_type,
        host: form.host,
        port: form.port,
        username: form.username,
        password,
        database: form.database,
        folder_id: form.folder_id,
        environment: form.environment,
        tag_ids: form.tag_ids,
        ssh_password: form.ssh_password ?? null,
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
  }, [form, notify, connection.id]);

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-full min-w-md max-w-lg max-h-[80vh] overflow-y-auto">
        <h3 className="font-heading text-text text-lg mb-4">Edit Connection</h3>
        <DetailedConnectionForm form={form} onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))} />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}