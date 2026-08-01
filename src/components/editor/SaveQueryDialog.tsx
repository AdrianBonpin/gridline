import { useState } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useQueryStore } from "../../stores/queryStore";

interface SaveQueryDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  queryText: string;
}

export function SaveQueryDialog({
  open,
  onClose,
  connectionId,
  queryText,
}: SaveQueryDialogProps) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveCurrentQuery = useQueryStore((s) => s.saveCurrentQuery);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveCurrentQuery({
        connectionId,
        name: trimmed,
        queryText,
        folder: folder.trim(),
      });
      // Reset form on success
      setName("");
      setFolder("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setError("");
    setName("");
    setFolder("");
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatedModal open={open} onClose={handleClose}>
      <div className="w-80">
        <h3 className="font-heading text-text text-lg mb-1">Save Query</h3>
        <p className="text-sm text-text-muted mb-4">Save the current query for later use.</p>

        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">Name</label>
            <Input
              value={name}
              placeholder="Query name"
              onChange={(v) => { setName(v); if (error) setError(""); }}
              aria-label="Query name"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Folder (optional)</label>
            <Input
              value={folder}
              placeholder="Folder"
              onChange={setFolder}
              aria-label="Folder"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-xs mb-3">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}