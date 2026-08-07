import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RestorePage } from "./RestorePage";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockReturnValue(Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn().mockResolvedValue("/tmp/backup.dump") }));

const mockConnections: any[] = [];
vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: (selector: any) => selector({ connections: mockConnections }),
}));

const pgToolsOk = {
  pg_dump_found: true,
  pg_restore_found: true,
  pg_dump_version: "16",
  pg_restore_version: "16",
  pg_dump_source: "system",
  pg_restore_source: "system",
};

const mysqlToolsOk = {
  mysqldumpFound: true,
  mysqlFound: true,
  mysqldumpVersion: "8.0",
  mysqlVersion: "8.0",
  mysqldumpSource: "system",
  mysqlSource: "system",
};

describe("RestorePage DB-aware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
  });

  it("shows format selector for PostgreSQL", async () => {
    mockConnections.push({ id: "c1", db_type: "postgresql", name: "p" });
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    render(<RestorePage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_restore/i)).not.toBeInTheDocument());
    expect(screen.getByText("Custom Archive")).toBeTruthy();
  });

  it("renders a plain MySQL restore (no format selector)", async () => {
    mockConnections.push({ id: "c2", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue(mysqlToolsOk);
    render(<RestorePage connectionId="c2" />);
    await waitFor(() => expect(screen.queryByText(/checking for mysqldump/i)).not.toBeInTheDocument());
    expect(screen.queryByText("Custom Archive")).toBeNull();
    expect(screen.queryByText(/Plain SQL restores run via psql/i)).toBeNull();
  });

  it("renders a plain SQLite restore (no format selector, no tool card)", () => {
    mockConnections.push({ id: "c3", db_type: "sqlite", name: "s" });
    render(<RestorePage connectionId="c3" />);
    expect(screen.queryByText("Custom Archive")).toBeNull();
    expect(screen.queryByText(/pg_restore/i)).toBeNull();
    expect(screen.queryByText(/mysqldump/i)).toBeNull();
  });
});