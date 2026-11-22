import { useMemo } from "react";
import { useUiStore } from "../stores/uiStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { changeOriginFor, type ChangeOrigin } from "../lib/changeOrigin";

/**
 * The active **Change Origin** (GLOSSARY.md), kept live: the active saved
 * connection, the database the viewer has selected, and that connection's
 * current target configuration.
 *
 * Reactively follows the saved connection record, so retargeting it (host,
 * port, database, SSH endpoint, TLS material) produces a new origin
 * immediately — work staged against the previous target then fails Commit All
 * instead of being applied somewhere else.
 *
 * Returns `null` when no saved connection is active or its record is unknown.
 */
export function useActiveChangeOrigin(): ChangeOrigin | null {
  const connectionId = useUiStore((s) => s.activeConnectionId);
  const connections = useConnectionStore((s) => s.connections);
  const database = useDbViewerStore((s) => s.currentDatabase);

  return useMemo(() => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return null;
    return changeOriginFor(connection, database);
  }, [connectionId, connections, database]);
}
