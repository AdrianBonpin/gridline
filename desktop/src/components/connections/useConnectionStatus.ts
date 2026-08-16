import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionInput, ConnectionTestResult } from "../../lib/types";
import * as cmd from "../../lib/commands";

export type ConnectionStatusState = "idle" | "checking" | "online" | "offline";

const DEBOUNCE_MS = 2000;
const RESET_MS = 5000;

/**
 * Extracted from the former status-dot UI: runs a connection test on
 * demand, debounced to once per 2s, and auto-resets to "idle" 5s after the
 * last check. `check()` is stable (useCallback) and safe to hand to menu
 * handlers; it no-ops while a check is already in flight or within the
 * debounce window.
 */
export function useConnectionStatus(
  connectionId: string,
  buildConfig: (password: string | null) => ConnectionInput,
): { state: ConnectionStatusState; info: string; check: () => Promise<void> } {
  const [state, setState] = useState<ConnectionStatusState>("idle");
  const [info, setInfo] = useState<string>("");
  const timeoutRef = useRef<number | null>(null);
  const lastCheckRef = useRef<number>(0);
  // Mirror `state` in a ref so `check` stays stable while still being able to
  // skip a second run while one is already in flight.
  const stateRef = useRef<ConnectionStatusState>("idle");

  const setStateBoth = useCallback((next: ConnectionStatusState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const check = useCallback(async () => {
    const now = Date.now();
    if (stateRef.current === "checking") return;
    if (now - lastCheckRef.current < DEBOUNCE_MS) return;
    lastCheckRef.current = now;
    setStateBoth("checking");
    setInfo("");

    try {
      const password = await cmd.getConnectionPassword(connectionId);
      const input = buildConfig(password);
      const result: ConnectionTestResult = await cmd.testConnection(input);
      if (result.ok) {
        const parts: string[] = [];
        if (result.server_version) parts.push(result.server_version);
        if (result.latency_ms != null) parts.push(`${result.latency_ms}ms`);
        setInfo(parts.join(" · "));
        setStateBoth("online");
      } else {
        setInfo(result.error ?? "offline");
        setStateBoth("offline");
      }
    } catch (e) {
      setInfo(e instanceof Error ? e.message : "offline");
      setStateBoth("offline");
    }

    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setStateBoth("idle");
      setInfo("");
    }, RESET_MS);
  }, [connectionId, buildConfig, setStateBoth]);

  return { state, info, check };
}