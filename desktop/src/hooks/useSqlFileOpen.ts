import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { takePendingSqlFiles } from "../lib/commands";
import { useUiStore } from "../stores/uiStore";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { useNotificationStore } from "../stores/notificationStore";
import type { PendingSqlFile } from "../lib/types";

/**
 * Turn OS "open this .sql file with Gridline" requests into editor tabs.
 *
 * Every platform path (macOS RunEvent::Opened, Windows/Linux argv, the
 * single-instance forward) ends up in a Rust buffer; this hook only ever
 * *drains* that buffer. That is deliberate: draining is idempotent, so a cold
 * start, a warm start, and a webview reload all converge on the same code path
 * and there is no cold-start race to handle.
 *
 * Opening never executes: the script lands in a query tab and runs only when
 * the user presses Run, which passes through the destructive-query guard.
 */
export function useSqlFileOpen(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const deliver = async () => {
      let files: PendingSqlFile[];
      try {
        files = await takePendingSqlFiles();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useNotificationStore.getState().notify(`Could not open SQL file: ${msg}`, "error");
        return;
      }
      if (disposed) return;
      for (const file of files) openOrStash(file);
    };

    void deliver();
    void listen("sql-file-opened", () => {
      void deliver();
    })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {
        // No Tauri event bridge (browser / tests): `listen` rejects there. The
        // mount-time drain already ran, and the Rust buffer survives until a
        // real webview asks for it, so there is nothing to recover here. The
        // drain is idempotent, so a missed nudge is not a correctness problem —
        // a warm webview still drains on mount and on the next event.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // A stashed file has no target until the user picks a connection, so
  // deliver it as soon as one becomes active.
  const pending = useUiStore((s) => s.pendingSqlFile);
  const activeConnectionId = useUiStore((s) => s.activeConnectionId);
  useEffect(() => {
    if (pending && activeConnectionId) {
      openQueryTabFor(pending);
      useUiStore.getState().clearPendingSqlFile();
    }
  }, [pending, activeConnectionId]);
}

function openOrStash(file: PendingSqlFile): void {
  const { activeConnectionId } = useUiStore.getState();
  if (!activeConnectionId) {
    // Guide rather than error: a Finder double-click should not dead-end.
    useUiStore.getState().setPendingSqlFile(file);
    useUiStore.getState().setActiveView("home");
    useNotificationStore
      .getState()
      .notify(`${file.name} is ready — open a connection to use it.`, "info");
    return;
  }
  openQueryTabFor(file);
}

function openQueryTabFor(file: PendingSqlFile): void {
  useDbViewerStore.getState().openQueryTab({
    sql: file.content,
    label: file.name,
    filePath: file.path,
  });
  useUiStore.getState().setActiveView("db-viewer");
}
