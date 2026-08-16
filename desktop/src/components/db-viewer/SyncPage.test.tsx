import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SyncPage } from "./SyncPage";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockReturnValue(Promise.resolve(() => {})) }));

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

describe("SyncPage DB-aware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
  });

  it("filters target connections to the same db_type as source (mysql)", async () => {
    mockConnections.push(
      { id: "pg1", db_type: "postgresql", name: "Postgres 1" },
      { id: "my1", db_type: "mysql", name: "MySQL 1" },
      { id: "my2", db_type: "mysql", name: "MySQL 2" },
      { id: "sq1", db_type: "sqlite", name: "SQLite 1" },
    );
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue(mysqlToolsOk);
    render(<SyncPage />);
    await waitFor(() => expect(screen.queryByText(/checking for/i)).not.toBeInTheDocument());

    const [sourceSelect, targetSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "my1" } });

    const options = Array.from(targetSelect.options).map((o) => o.value);
    expect(options).toContain("my1");
    expect(options).toContain("my2");
    expect(options).not.toContain("pg1");
    expect(options).not.toContain("sq1");
  });
});