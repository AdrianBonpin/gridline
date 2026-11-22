import { useCallback, useState } from "react";
import * as cmd from "../lib/commands";
import type { SshHostTrustState } from "../lib/types";

/**
 * SSH host trust during a connection attempt.
 *
 * A failed connect/test that goes through an SSH tunnel probes the endpoint's
 * host key (`check`) — a handshake only, so no credential is sent — and exposes
 * the resulting state for the enrollment dialog. Accepting a fingerprint calls
 * `ssh_host_trust_enroll`, which re-reads the offered key before remembering it,
 * and returns whether the caller should retry the operation.
 */
export function useSshHostTrust() {
  const [trustState, setTrustState] = useState<SshHostTrustState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Probe the endpoint after a failure. Only an untrusted state is surfaced: a
   * trusted host means the failure was something else, so the caller's own
   * error stays the story.
   */
  const check = useCallback(async (host: string | null | undefined, port: number | null | undefined) => {
    if (!host) return;
    const state = await cmd
      .sshHostTrustState(host, port ?? 22)
      .catch(() => null);
    setTrustState(state && state.state !== "trusted" ? state : null);
    setError(null);
  }, []);

  /** Accept the fingerprint the dialog is showing. True means "retry now". */
  const accept = useCallback(async (): Promise<boolean> => {
    if (!trustState || trustState.state !== "unknown") return false;
    setBusy(true);
    setError(null);
    try {
      await cmd.sshHostTrustEnroll(trustState.host, trustState.port, {
        key_type: trustState.key_type,
        fingerprint: trustState.fingerprint,
      });
      setTrustState(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [trustState]);

  const dismiss = useCallback(() => {
    setTrustState(null);
    setError(null);
  }, []);

  return { trustState, busy, error, check, accept, dismiss };
}
