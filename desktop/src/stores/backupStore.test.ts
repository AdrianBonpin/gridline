import { describe, it, expect, vi, beforeEach } from "vitest";

const listeners = vi.hoisted(
  () => ({} as Record<string, (e: { payload: unknown }) => void>),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners[name] = cb;
    return () => {};
  }),
}));

import { useBackupStore } from "./backupStore";
import { useNotificationStore } from "./notificationStore";

describe("backupStore advisory warning", () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
  });

  it("surfaces a non-fatal warning as an info notification", async () => {
    await useBackupStore.getState().initListener();
    listeners["backup-progress"]({
      payload: {
        job_id: "j1",
        status: "running",
        progress: 0,
        warning: "Client/server version mismatch: the resolved dump tool is old",
      },
    });
    const notes = useNotificationStore.getState().notifications;
    expect(notes.some((n) => n.message.includes("version mismatch"))).toBe(true);
    expect(notes.some((n) => n.type === "info")).toBe(true);
  });
});
