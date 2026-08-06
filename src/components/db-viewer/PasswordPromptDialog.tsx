import { useState } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";

interface Props {
  open: boolean;
  connectionName: string;
  onConnect: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptDialog({
  open,
  connectionName,
  onConnect,
  onCancel,
}: Props) {
  const [pw, setPw] = useState("");
  if (!open) return null;
  return (
    <AnimatedModal open={open} onClose={onCancel}>
      <div className="p-5 w-80">
        <h2 className="text-sm font-medium text-text mb-1">Enter password</h2>
        <p className="text-xs text-text-muted mb-3">
          “{connectionName}” has keychain disabled. Enter the password for this
          session (it will not be saved).
        </p>
        <input
          type="password"
          autoFocus
          aria-label="Password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pw) onConnect(pw);
          }}
          className="w-full rounded-lg border-border bg-surface px-3 py-2 text-sm text-text mb-3"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-lg text-text-muted hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => pw && onConnect(pw)}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white"
          >
            Connect
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}