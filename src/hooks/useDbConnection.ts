import { useEffect, useCallback, useRef, useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { useNotificationStore } from "../stores/notificationStore";
import * as cmd from "../lib/commands";
import type { ConnectionInput } from "../lib/types";

export function useDbConnection(connectionId: string) {
  const reset = useDbViewerStore((s) => s.reset);
  const populate = useDbViewerStore((s) => s.populate);
  const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
  const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
  const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);
  const notify = useNotificationStore((s) => s.notify);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const inputRef = useRef<ConnectionInput | null>(null);
  const initialDbRef = useRef<string | null>(null);

  const connect = useCallback(async () => {
    const conn = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connectionId);
    if (!conn) {
      setConnectionError("Connection not found");
      return;
    }
    try {
      const password = useConnectionStore.getState().connectionPasswords[conn.id] ?? undefined;
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

      // Load initial data
      const databases = await cmd
        .getDatabases(connectionId)
        .catch(() => [] as string[]);
      const schemas = await cmd
        .getSchemas(connectionId)
        .catch(() => [] as string[]);
      const tables = await cmd.getTables(connectionId);
      populate(databases, schemas, tables);
      if (databases.length > 0) {
        setCurrentDatabase(databases[0]);
        initialDbRef.current = databases[0];
      }
      if (schemas.length > 0) setCurrentSchema(schemas[0]);
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

  // Database switch effect: reconnect when user changes database from dropdown
  useEffect(() => {
    if (!currentDatabase || !inputRef.current) return;
    if (currentDatabase === initialDbRef.current) return;

    const reconnect = async () => {
      const input = { ...inputRef.current!, database: currentDatabase };
      try {
        await cmd.dbConnect(connectionId, input);
        const schemas = await cmd.getSchemas(connectionId);
        const tables = await cmd.getTables(connectionId);
        populate(
          useDbViewerStore.getState().databases,
          schemas,
          tables,
        );
        if (schemas.length > 0) setCurrentSchema(schemas[0]);
      } catch {
        /* silent */
      }
    };
    reconnect();
  }, [currentDatabase, connectionId, populate, setCurrentSchema]);

  return { connectionError, connect };
}