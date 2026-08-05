import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BackupPage } from "./BackupPage";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockReturnValue(Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn().mockResolvedValue("/tmp/backup.dump") }));

describe("BackupPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
  });

  it("hides install instructions when tools are bundled", async () => {
    vi.spyOn(commands, "detectPgTools").mockResolvedValue({
      pg_dump_found: false,
      pg_restore_found: false,
      pg_dump_version: null,
      pg_restore_version: null,
      pg_dump_source: "bundled",
      pg_restore_source: "bundled",
    });
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/brew install|apt install/i)).toBeNull();
  });
});