import { useState } from "react";
import { Button } from "../ui/Button";
import { useSshHostTrustState } from "../../hooks/useSshHostTrustState";

export interface SshHostTrustPanelProps {
  host: string | null | undefined;
  port: number | null | undefined;
}

/**
 * The connection's SSH host-key trust state, with the deliberate re-enrollment
 * action (ADR 0001, ticket 22).
 *
 * Replacing stale trust lives here — in the connection's own SSH settings —
 * and never on the connect path, so a changed key stops a connection instead of
 * offering an override. Completing a re-enrollment makes the new key verify on
 * every later connection.
 */
export function SshHostTrustPanel({ host, port }: SshHostTrustPanelProps) {
  const { state, busy, error, check, enroll, reenroll } =
    useSshHostTrustState();
  const [confirmed, setConfirmed] = useState(false);

  if (!host) return null;
  const endpoint = `${host}:${port ?? 22}`;

  return (
    <div
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
      data-testid="ssh-host-trust-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-text">Host key trust</p>
          <p className="text-xs text-text-muted">
            Checked against your known-hosts files and the enrollments Gridline
            remembers for {endpoint}. No credential is sent while checking.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setConfirmed(false);
            void check(host, port ?? 22);
          }}
          disabled={busy}
        >
          {busy ? "Checking..." : state ? "Re-check host key" : "Check host key"}
        </Button>
      </div>

      {error && (
        <p className="text-red-300 text-xs" data-testid="ssh-host-trust-error">
          {error}
        </p>
      )}

      {state?.state === "trusted" && (
        <dl className="text-sm space-y-1">
          <div className="flex gap-2">
            <dt className="text-text-muted w-24 shrink-0">Status</dt>
            <dd className="text-text">
              Trusted ({state.source === "known_hosts" ? "known hosts" : "enrolled"})
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-text-muted w-24 shrink-0">Fingerprint</dt>
            <dd
              className="text-text font-mono break-all"
              data-testid="ssh-host-trust-fingerprint"
            >
              {state.key_type} {state.fingerprint}
            </dd>
          </div>
        </dl>
      )}

      {state?.state === "unknown" && (
        <>
          <p className="text-sm text-text-muted">
            <span className="text-text">{endpoint}</span> is not trusted yet.
            Compare this fingerprint with the server before accepting it; no
            credential is sent until it is accepted.
          </p>
          <dl className="text-sm space-y-1">
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Fingerprint</dt>
              <dd
                className="text-text font-mono break-all"
                data-testid="ssh-host-trust-fingerprint"
              >
                {state.key_type} {state.fingerprint}
              </dd>
            </div>
          </dl>
          <div className="flex justify-end">
            <Button onClick={() => void enroll()} disabled={busy}>
              {busy ? "Accepting..." : "Accept fingerprint"}
            </Button>
          </div>
        </>
      )}

      {state?.state === "mismatch" && (
        <>
          <p className="text-sm text-text-muted">
            <span className="text-text">{endpoint}</span> presents a different
            host key than the one Gridline trusts. Connections to it are refused
            before any credential is sent.
          </p>
          <dl className="text-sm space-y-1">
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Trusted</dt>
              <dd
                className="text-text font-mono break-all"
                data-testid="ssh-host-trust-expected"
              >
                {state.expected_key_type} {state.expected_fingerprint}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Presented</dt>
              <dd
                className="text-text font-mono break-all"
                data-testid="ssh-host-trust-presented"
              >
                {state.key_type} {state.fingerprint}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-text-muted">
            Only re-enroll if the server key was rotated on purpose. Replacing it
            trusts the presented key for every later connection; until you
            confirm a fingerprint out of band, the change is refused
            {state.source === "known_hosts"
              ? " — and a known-hosts entry is never modified by Gridline, so update that file instead."
              : "."}
          </p>
          <label className="flex items-start gap-2 text-xs text-text-muted cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 cursor-pointer"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I compared the fingerprint with the server out of band and want to
              replace the trusted key for {endpoint}.
            </span>
          </label>
          <div className="flex justify-end">
            <Button
              onClick={() => void reenroll()}
              disabled={busy || !confirmed}
            >
              {busy ? "Re-enrolling..." : "Re-enroll host key"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
