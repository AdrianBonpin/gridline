import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BackupPage } from "./BackupPage";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockReturnValue(Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn().mockResolvedValue("/tmp/backup.dump") }));

const mockConnections: any[] = [];
vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: (selector: any) => selector({ connections: mockConnections }),
}));

describe("BackupPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
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
    mockConnections.push({ id: "c1", db_type: "postgresql", name: "p" });
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/brew install|apt install/i)).toBeNull();
  });
});

describe("BackupPage DB-aware", () => {
  beforeEach(() => {
    mockConnections.length = 0;
  });

  it("shows a single SQL format for MySQL (no custom/tar/directory)", async () => {
    mockConnections.push({ id: "c1", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: true,
      mysqlFound: true,
      mysqldumpVersion: "8.0",
      mysqlVersion: "8.0",
      mysqldumpSource: "system",
      mysqlSource: "system",
    });
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for mysqldump/i)).not.toBeInTheDocument());
    expect(screen.queryByText("Custom Archive")).toBeNull();
    expect(screen.queryByText("Tarball")).toBeNull();
    expect(screen.queryByText("Directory")).toBeNull();
    expect(screen.getByText("Plain SQL")).toBeTruthy();
  });

  it("renders a plain file-picker backup for SQLite (no format selector, no tool card)", () => {
    mockConnections.push({ id: "c2", db_type: "sqlite", name: "s" });
    render(<BackupPage connectionId="c2" />);
    expect(screen.queryByText("Custom Archive")).toBeNull();
    expect(screen.queryByText(/pg_dump/i)).toBeNull();
    expect(screen.queryByText(/mysqldump/i)).toBeNull();
  });

  it("still lists Custom Archive for PostgreSQL (regression guard)", async () => {
    mockConnections.push({ id: "c3", db_type: "postgresql", name: "p" });
    vi.spyOn(commands, "detectPgTools").mockResolvedValue({
      pg_dump_found: true,
      pg_restore_found: true,
      pg_dump_version: "16",
      pg_restore_version: "16",
      pg_dump_source: "system",
      pg_restore_source: "system",
    });
    render(<BackupPage connectionId="c3" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());
    expect(screen.getByText("Custom Archive")).toBeTruthy();
  });
});