import { useEffect, useCallback, useRef, useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { useNotificationStore } from "../stores/notificationStore";
import * as cmd from "../lib/commands";
import { pickDefaultSchema } from "../lib/utils";
import type { ConnectionInput, TableInfo } from "../lib/types";

export function useDbConnection(connectionId: string) {
  const reset = useDbViewerStore((s) => s.reset);
  const populate = useDbViewerStore((s) => s.populate);
  const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
  const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
  const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);
  const notify = useNotificationStore((s) => s.notify);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const inputRef = useRef<ConnectionInput | null>(null);
  // The database the pool is currently connected to. Unlike the selected
  // `currentDatabase`, this lets us reconnect whenever the selection drifts
  // from the live connection (including switching back to the first DB).
  const connectedDbRef = useRef<string | null>(null);

  const connect = useCallback(async () => {
    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connectionId);
    if (!conn) {
      setConnectionError("Connection not found");
      return;
    }
    try {
      const password = await useConnectionStore.getState().getConnectionPassword(conn.id).catch(() => null);
      const sshPassword = conn.ssh_host
        ? await cmd.getConnectionSshPassword(conn.id).catch(() => null)
        : null;
      const sshPassphrase = conn.ssh_host
        ? await cmd.getConnectionSshPassphrase(conn.id).catch(() => null)
        : null;
      const input: ConnectionInput = {
        name: conn.name,
        db_type: conn.db_type,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database,
        folder_id: conn.folder_id,
        ssh_host: conn.ssh_host,
        ssh_port: conn.ssh_port,
        ssh_user: conn.ssh_user,
        ssh_auth_method:
          conn.ssh_auth_method as "password" | "key" | null | undefined,
        ssh_private_key_path: conn.ssh_private_key_path,
        ssh_password: sshPassword,
        ssh_passphrase: sshPassphrase,
        ssl_mode:
          conn.ssl_mode as
            | "disable"
            | "require"
            | "verify-ca"
            | "verify-full"
            | null
            | undefined,
        ssl_ca_path: conn.ssl_ca_path,
        ssl_cert_path: conn.ssl_cert_path,
        ssl_key_path: conn.ssl_key_path,
      };
      await cmd.dbConnect(connectionId, input);
      setConnectionError(null);
      inputRef.current = input;
      connectedDbRef.current =
        input.db_type === "sqlite"
          ? "main"
          : (input.database ?? "postgres");

      // Load initial data, smart-selecting the default schema (e.g. `public`)
      const databases = await cmd
        .getDatabases(connectionId)
        .catch(() => [] as string[]);
      const schemas = await cmd
        .getSchemas(connectionId)
        .catch(() => [] as string[]);
      const defaultSchema = pickDefaultSchema(schemas);
      const tables = await cmd.getTables(
        connectionId,
        defaultSchema ?? undefined,
      );
      populate(databases, schemas, tables);
      if (databases.length > 0) {
        // Prefer the connection's configured database, fall back to the first
        // available one so the dropdown matches what the pool is connected to.
        const preferred =
          input.database && databases.includes(input.database)
            ? input.database
            : databases[0];
        setCurrentDatabase(preferred);
      }
      setCurrentSchema(defaultSchema);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConnectionError(msg);
      notify(`Failed to connect: ${msg}`, "error");
    }
  }, [connectionId, populate, setCurrentDatabase, setCurrentSchema, notify]);

  useEffect(() => {
    connect();
    return () => {
      cmd.dbDisconnect(connectionId).catch(() => {});
      const hasPending = useDbViewerStore
        .getState()
        .changesQueue.some((c) => c.status === "pending");
      if (!hasPending) reset();
    };
  }, [connectionId, connect, reset]);

  // Database switch effect: whenever the selected database drifts from the
  // pool's live connection, reconnect and refresh schemas/tables for that DB.
  useEffect(() => {
    if (!currentDatabase || !inputRef.current) return;
    if (currentDatabase === connectedDbRef.current) return;

    let cancelled = false;
    const reconnect = async () => {
      const input = { ...inputRef.current!, database: currentDatabase };
      try {
        await cmd.dbConnect(connectionId, input);
        if (cancelled) return;
        connectedDbRef.current = currentDatabase;
        const schemas = await cmd
          .getSchemas(connectionId)
          .catch(() => [] as string[]);
        if (cancelled) return;
        const newSchema = pickDefaultSchema(schemas);
        const tables = await cmd
          .getTables(connectionId, newSchema ?? undefined)
          .catch(() => [] as TableInfo[]);
        if (cancelled) return;
        populate(useDbViewerStore.getState().databases, schemas, tables);
        setCurrentSchema(newSchema);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Revert the selection so the dropdown matches the live connection
        setCurrentDatabase(connectedDbRef.current);
        notify(`Failed to switch database: ${msg}`, "error");
      }
    };
    reconnect();
    return () => {
      cancelled = true;
    };
  }, [currentDatabase, connectionId, populate, setCurrentSchema, notify]);

  return { connectionError, connect };
}
