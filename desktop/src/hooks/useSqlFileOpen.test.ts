import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const listeners: Record<string, (e: unknown) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: unknown) => void) => {
    listeners[name] = cb;
    return () => {};
  }),
}));

const takePendingSqlFiles = vi.hoisted(() => vi.fn());
vi.mock("../lib/commands", () => ({
  takePendingSqlFiles: () => takePendingSqlFiles(),
}));

import { useSqlFileOpen } from "./useSqlFileOpen";
import { useUiStore } from "../stores/uiStore";
import { useDbViewerStore } from "../stores/dbViewerStore";
import { useNotificationStore } from "../stores/notificationStore";

const file = { path: "/tmp/student_db.sql", name: "student_db.sql", content: "SELECT 1;" };

beforeEach(() => {
  takePendingSqlFiles.mockReset();
  useUiStore.setState({ activeConnectionId: null, pendingSqlFile: null, activeView: "home" });
  useDbViewerStore.setState({ tabs: [], activeTabId: null });
});

describe("useSqlFileOpen", () => {
  it("opens a tab when a connection is active", async () => {
    takePendingSqlFiles.mockResolvedValue([file]);
    useUiStore.setState({ activeConnectionId: "conn-1" });

    renderHook(() => useSqlFileOpen());

    await waitFor(() => {
      const tab = useDbViewerStore.getState().tabs.slice(-1)[0];
      expect(tab?.query).toBe("SELECT 1;");
    });
    expect(useDbViewerStore.getState().tabs.slice(-1)[0]?.table).toBe("student_db.sql");
    expect(useUiStore.getState().pendingSqlFile).toBeNull();
  });

  it("stashes the file and prompts when no connection is active", async () => {
    takePendingSqlFiles.mockResolvedValue([file]);

    renderHook(() => useSqlFileOpen());

    await waitFor(() => {
      expect(useUiStore.getState().pendingSqlFile).toEqual(file);
    });
    expect(useDbViewerStore.getState().tabs).toHaveLength(0);
    expect(useUiStore.getState().activeView).toBe("home");
  });

  it("drains the buffer again when the nudge event fires", async () => {
    takePendingSqlFiles.mockResolvedValue([]);
    useUiStore.setState({ activeConnectionId: "conn-1" });

    renderHook(() => useSqlFileOpen());
    await waitFor(() => expect(takePendingSqlFiles).toHaveBeenCalledTimes(1));

    takePendingSqlFiles.mockResolvedValue([file]);
    listeners["sql-file-opened"]?.({});

    await waitFor(() => {
      expect(useDbViewerStore.getState().tabs.slice(-1)[0]?.query).toBe("SELECT 1;");
    });
  });

  it("opens the stashed file once a connection becomes active", async () => {
    takePendingSqlFiles.mockResolvedValue([file]);
    renderHook(() => useSqlFileOpen());

    await waitFor(() => expect(useUiStore.getState().pendingSqlFile).toEqual(file));

    useUiStore.setState({ activeConnectionId: "conn-2" });

    await waitFor(() => {
      expect(useDbViewerStore.getState().tabs.slice(-1)[0]?.query).toBe("SELECT 1;");
    });
    expect(useUiStore.getState().pendingSqlFile).toBeNull();
  });

  it("surfaces a read failure as a notification instead of throwing", async () => {
    takePendingSqlFiles.mockRejectedValue(new Error("a.sql is not valid UTF-8"));
    useUiStore.setState({ activeConnectionId: "conn-1" });

    renderHook(() => useSqlFileOpen());

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications.slice(-1)[0]?.message).toContain("UTF-8");
    });
  });
});
