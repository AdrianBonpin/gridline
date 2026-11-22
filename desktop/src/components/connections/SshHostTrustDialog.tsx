import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import type { SshHostTrustState } from "../../lib/types";

interface SshHostTrustDialogProps {
  /** Untrusted host state to resolve; `null` closes the dialog. */
  state: SshHostTrustState | null;
  busy?: boolean;
  error?: string | null;
  /** Remember the shown fingerprint, then retry the connection. */
  onAccept: () => void;
  onClose: () => void;
}

/**
 * First-use SSH host-key enrollment (ADR 0001).
 *
 * An unknown host shows its key fingerprint and requires an explicit accept
 * before authentication. A conflicting key is a dead end here: replacing trust
 * is a deliberate re-enrollment, never an inline override.
 */
export function SshHostTrustDialog({
  state,
  busy = false,
  error,
  onAccept,
  onClose,
}: SshHostTrustDialogProps) {
  // Only untrusted states need a decision; a trusted host is not a dialog.
  if (!state || state.state === "trusted") return null;
  const endpoint = `${state.host}:${state.port}`;

  return (
    <AnimatedModal open onClose={onClose}>
      <div className="w-[26rem]">
        <h3 className="font-heading text-text text-lg mb-3">SSH host key</h3>

        {state.state === "unknown" ? (
          <>
            <p className="text-sm text-text-muted mb-3">
              Gridline has not connected to <span className="text-text">{endpoint}</span> before.
              Check the fingerprint against the server before accepting it — nothing
              credential-bearing is sent to this host until you do.
            </p>
            <dl className="text-sm mb-4 space-y-1">
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Key type</dt>
                <dd className="text-text font-mono">{state.key_type}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Fingerprint</dt>
                <dd className="text-text font-mono break-all" data-testid="ssh-host-fingerprint">
                  {state.fingerprint}
                </dd>
              </div>
            </dl>
            {error && <p className="text-red-300 text-sm mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onAccept} disabled={busy}>
                {busy ? "Accepting..." : "Accept fingerprint"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-3">
              <span className="text-text">{endpoint}</span> presented a different host key than
              the one Gridline trusts. The connection was stopped before any credential was sent.
            </p>
            <dl className="text-sm mb-4 space-y-1">
              <div className="flex gap-2">
                <dt className="text-text-muted w-32 shrink-0">Expected</dt>
                <dd className="text-text font-mono break-all" data-testid="ssh-host-expected">
                  {state.expected_key_type} {state.expected_fingerprint}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-text-muted w-32 shrink-0">Presented</dt>
                <dd className="text-text font-mono break-all" data-testid="ssh-host-presented">
                  {state.key_type} {state.fingerprint}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-text-muted mb-4">
              A changed key cannot be accepted while connecting. If the server key was rotated
              on purpose, open this connection's SSH settings and re-enroll the host key
              there — that is a separate, deliberate action, never an inline override.
            </p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </AnimatedModal>
  );
}
