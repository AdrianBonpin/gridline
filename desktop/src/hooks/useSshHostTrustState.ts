import { useCallback, useState } from "react";
import * as cmd from "../lib/commands";
import type { SshHostTrustState } from "../lib/types";

/**
 * The connection's SSH host-key trust state (ADR 0001, ticket 22).
 *
 * This is the deliberate surface. It reports the endpoint's current trust and
 * offers the two decisions that belong to the user rather than to a connection
 * attempt:
 *
 * - `enroll` — first-use acceptance of an unknown host's fingerprint;
 * - `reenroll` — replacing trust after a legitimate server key rotation.
 *
 * It is deliberately separate from `useSshHostTrust`, which serves the connect
 * path: that hook may only resolve an unknown host and has no way to replace
 * trust, so a mismatch stays a dead end during authentication.
 */
export function useSshHostTrustState() {
  const [state, setState] = useState<SshHostTrustState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Probe the endpoint and report its trust. Unlike the connect path this keeps
   * a `trusted` result — the panel is the place that shows all is well.
   */
  const check = useCallback(
    async (
      host: string | null | undefined,
      port: number | null | undefined,
    ): Promise<SshHostTrustState | null> => {
      if (!host) {
        setState(null);
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const next = await cmd.sshHostTrustState(host, port ?? 22);
        setState(next);
        return next;
      } catch (e) {
        // A failed probe proves nothing about the current trust, so do not
        // keep showing a fingerprint as if it were still current.
        setState(null);
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** First-use acceptance. Only an `unknown` endpoint can be enrolled. */
  const enroll = useCallback(async (): Promise<boolean> => {
    if (state?.state !== "unknown") return false;
    setBusy(true);
    setError(null);
    try {
      const next = await cmd.sshHostTrustEnroll(state.host, state.port, {
        key_type: state.key_type,
        fingerprint: state.fingerprint,
      });
      setState(next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [state]);

  /**
   * Replace stale trust with the key the endpoint offers now.
   *
   * Only a `mismatch` — a key that actually conflicts — can be re-enrolled: an
   * unknown host is a first-use acceptance, and a trusted host has nothing to
   * replace. The backend re-reads the offered key, so a server that switched
   * keys after the confirmation is refused and the old trust survives.
   */
  const reenroll = useCallback(async (): Promise<boolean> => {
    if (state?.state !== "mismatch") return false;
    setBusy(true);
    setError(null);
    try {
      const next = await cmd.sshHostTrustReenroll(state.host, state.port, {
        key_type: state.key_type,
        fingerprint: state.fingerprint,
      });
      setState(next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [state]);

  const reset = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  return { state, busy, error, check, enroll, reenroll, reset };
}
