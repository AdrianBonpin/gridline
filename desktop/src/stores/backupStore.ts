import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { BackupJob } from "../lib/types";
import { cancelToolJob } from "../lib/commands";
import { useNotificationStore } from "./notificationStore";

interface BackupJobEvent {
  job_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string | null;
  warning?: string | null;
}

interface BackupStore {
  jobs: BackupJob[];
  activeJobId: string | null;
  progress: number;
  startJob: (jobId: string, type: string) => void;
  /**
   * Replace the locally-generated job id with the id the backend returned.
   *
   * Every terminal event (`completed` / `failed` / `cancelled`) carries the
   * backend id, and cancelling is addressed by it, so the UI must adopt it —
   * otherwise completion never matches and a running job cannot be cancelled.
   */
  adoptJobId: (localId: string, jobId: string) => void;
  completeJob: (jobId: string) => void;
  failJob: (jobId: string, error: string) => void;
  markCancelled: (jobId: string) => void;
  /** Ask the backend to cancel a running job (terminates its process tree). */
  cancelJob: (jobId: string) => Promise<boolean>;
  /**
   * Start a job and run the command that launches it, keeping the store in sync
   * with the backend's job id. A command that fails before the job exists is
   * surfaced as a failure instead of leaving a spinner forever.
   */
  runJob: (
    type: BackupJob["type"],
    action: () => Promise<unknown>,
  ) => Promise<void>;
  initListener: () => Promise<void>;
}

export const useBackupStore = create<BackupStore>((set, get) => ({
  jobs: [],
  activeJobId: null,
  progress: 0,

  startJob: (jobId: string, type: string) =>
    set((s) => ({
      activeJobId: jobId,
      progress: 0,
      jobs: [
        ...s.jobs,
        {
          id: jobId,
          connection_id: "",
          type: type as BackupJob["type"],
          format: null,
          file_path: null,
          source_connection_id: null,
          status: "running",
          error_message: null,
          size_bytes: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        } satisfies BackupJob,
      ],
    })),

  adoptJobId: (localId: string, jobId: string) =>
    set((s) => ({
      activeJobId: s.activeJobId === localId ? jobId : s.activeJobId,
      jobs: s.jobs.map((j) => (j.id === localId ? { ...j, id: jobId } : j)),
    })),

  completeJob: (jobId: string) =>
    set((s) => ({
      progress: 100,
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? { ...j, status: "completed" as const, completed_at: new Date().toISOString() }
          : j,
      ),
    })),

  failJob: (jobId: string, error: string) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: "failed" as const,
              error_message: error,
              completed_at: new Date().toISOString(),
            }
          : j,
      ),
    })),

  markCancelled: (jobId: string) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: "cancelled" as const,
              completed_at: new Date().toISOString(),
            }
          : j,
      ),
    })),

  cancelJob: async (jobId: string) => {
    try {
      const wasRunning = await cancelToolJob(jobId);
      // The backend's own `cancelled` event confirms it; updating now keeps the
      // button responsive instead of double-clickable while the tool exits.
      if (wasRunning) get().markCancelled(jobId);
      return wasRunning;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().failJob(jobId, msg);
      return false;
    }
  },

  runJob: async (type, action) => {
    const localId = `${type}-${Date.now()}`;
    let jobId = localId;
    get().startJob(localId, type);
    try {
      const returned = await action();
      // The backend returns the real job id; adopting it is what makes the
      // progress events and the cancel command match this card.
      if (typeof returned === "string" && returned.length > 0) {
        jobId = returned;
        get().adoptJobId(localId, jobId);
      }
    } catch (e) {
      // The command itself failed (e.g. connection not found), so no event
      // will ever arrive — record the failure here.
      const msg = e instanceof Error ? e.message : String(e);
      get().failJob(jobId, msg);
    }
  },

  initListener: async () => {
    await listen<BackupJobEvent>("backup-progress", (event) => {
      const { job_id, status, error, warning } = event.payload;
      if (warning) {
        useNotificationStore.getState().notify(warning, "info");
      }
      if (status === "completed") {
        get().completeJob(job_id);
      } else if (status === "cancelled") {
        get().markCancelled(job_id);
      } else if (status === "failed") {
        get().failJob(job_id, error || "Unknown error");
      }
    });
  },
}));
