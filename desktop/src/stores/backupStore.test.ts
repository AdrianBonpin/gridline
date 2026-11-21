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
import * as commands from "../lib/commands";

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

describe("backupStore job identity, cancellation and terminal states", () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    vi.restoreAllMocks();
  });

  it("adopts the backend job id so progress events and cancelling match", async () => {
    const cancel = vi.spyOn(commands, "cancelToolJob").mockResolvedValue(true);

    await useBackupStore.getState().runJob("dump", async () => "backend-uuid");

    const state = useBackupStore.getState();
    expect(state.activeJobId).toBe("backend-uuid");
    expect(state.jobs.map((j) => j.id)).toEqual(["backend-uuid"]);

    // The backend's terminal event now matches the card.
    await useBackupStore.getState().initListener();
    listeners["backup-progress"]({
      payload: { job_id: "backend-uuid", status: "completed" },
    });
    expect(useBackupStore.getState().jobs[0].status).toBe("completed");

    // And cancelling addresses the real job, not a locally invented id.
    await useBackupStore.getState().cancelJob("backend-uuid");
    expect(cancel).toHaveBeenCalledWith("backend-uuid");
  });

  it("records a command that fails before the job exists as a failure", async () => {
    await useBackupStore.getState().runJob("restore", async () => {
      throw new Error("Connection not found: c1");
    });
    const job = useBackupStore.getState().jobs[0];
    expect(job.status).toBe("failed");
    expect(job.error_message).toContain("Connection not found");
  });

  it("marks a cancelled job cancelled, never failed", async () => {
    vi.spyOn(commands, "cancelToolJob").mockResolvedValue(true);
    useBackupStore.getState().startJob("job-1", "sync");

    const wasRunning = await useBackupStore.getState().cancelJob("job-1");

    expect(wasRunning).toBe(true);
    const job = useBackupStore.getState().jobs[0];
    expect(job.status).toBe("cancelled");
    expect(job.error_message).toBeNull();
  });

  it("surfaces a failed cancel request instead of pretending the job stopped", async () => {
    vi.spyOn(commands, "cancelToolJob").mockRejectedValue(new Error("IPC down"));
    useBackupStore.getState().startJob("job-2", "dump");

    const wasRunning = await useBackupStore.getState().cancelJob("job-2");

    expect(wasRunning).toBe(false);
    const job = useBackupStore.getState().jobs[0];
    expect(job.status).toBe("failed");
    expect(job.error_message).toContain("IPC down");
  });

  it("treats a backend cancelled event as cancelled", async () => {
    await useBackupStore.getState().initListener();
    useBackupStore.getState().startJob("job-3", "dump");
    listeners["backup-progress"]({
      payload: { job_id: "job-3", status: "cancelled", error: "Job cancelled" },
    });
    expect(useBackupStore.getState().jobs[0].status).toBe("cancelled");
  });
});
