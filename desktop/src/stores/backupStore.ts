import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { BackupJob } from "../lib/types";

interface BackupJobEvent {
  job_id: string;
  status: "running" | "completed" | "failed";
  error?: string | null;
}

interface BackupStore {
  jobs: BackupJob[];
  activeJobId: string | null;
  progress: number;
  startJob: (jobId: string, type: string) => void;
  completeJob: (jobId: string) => void;
  failJob: (jobId: string, error: string) => void;
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

  initListener: async () => {
    await listen<BackupJobEvent>("backup-progress", (event) => {
      const { job_id, status, error } = event.payload;
      if (status === "completed") {
        get().completeJob(job_id);
      } else if (status === "failed") {
        get().failJob(job_id, error || "Unknown error");
      }
    });
  },
}));