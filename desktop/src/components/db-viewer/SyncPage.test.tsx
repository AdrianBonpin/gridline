import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SyncPage } from "./SyncPage";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockReturnValue(Promise.resolve(() => {})) }));

const sessionCredentialMock = vi.hoisted(() => ({
  requestSessionCredential: vi.fn(),
  setSessionPassword: vi.fn(),
}));

const mockConnections: any[] = [];
vi.mock("../../stores/connectionStore", () => {
  // The page reads connections through the hook, and only reaches `getState()`
  // when a tool job asks for a session password.
  const hook = ((selector: any) =>
    selector({ connections: mockConnections })) as any;
  hook.getState = () => ({
    requestSessionCredential: sessionCredentialMock.requestSessionCredential,
    setSessionPassword: sessionCredentialMock.setSessionPassword,
  });
  return { useConnectionStore: hook };
});

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

describe("SyncPage tool re-check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
  });

  it("re-checks MySQL tools with force when Check again is clicked", async () => {
    mockConnections.push(
      { id: "my1", db_type: "mysql", name: "MySQL 1", database: "db1" },
      { id: "my2", db_type: "mysql", name: "MySQL 2", database: "db2" },
    );
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    const spy = vi.spyOn(commands, "detectMysqlTools").mockResolvedValue(mysqlToolsOk);
    vi.spyOn(commands, "getSchemas").mockResolvedValue([]);
    render(<SyncPage />);
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "my1" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
  });

  it("lists the specific missing MySQL role", async () => {
    mockConnections.push(
      { id: "my1", db_type: "mysql", name: "MySQL 1", database: "db1" },
      { id: "my2", db_type: "mysql", name: "MySQL 2", database: "db2" },
    );
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: false,
      mysqlFound: true,
      mysqldumpVersion: null,
      mysqlVersion: "8.0",
      mysqldumpSource: null,
      mysqlSource: "system",
    });
    vi.spyOn(commands, "getSchemas").mockResolvedValue([]);
    render(<SyncPage />);
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "my1" } });
    await waitFor(() => expect(screen.getByText(/mysqldump is missing/i)).toBeTruthy());
  });
});

// Regression (#47): `isMysql = dbType === "mysql"` made a MariaDB source match
// neither branch, so the MySQL tool check never ran and Start Sync fell through
// to sqliteSync().
describe("SyncPage MariaDB routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["db1"]);
  });

  it("treats a MariaDB source as the MySQL family", async () => {
    mockConnections.push({
      id: "src",
      db_type: "mariadb",
      name: "maria",
      database: "db1",
    });
    const detectMysql = vi
      .spyOn(commands, "detectMysqlTools")
      .mockResolvedValue(mysqlToolsOk);
    const detectPg = vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);

    render(<SyncPage />);
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "src" } });

    await waitFor(() => expect(detectMysql).toHaveBeenCalled());
    expect(detectPg).not.toHaveBeenCalled();
  });
});
// Ticket 33: a PostgreSQL sync restores into the target in one transaction, so a
// failure rolls back instead of leaving a half-replaced target — and the UI says
// so before the destructive confirmation is ticked.
describe("SyncPage PostgreSQL atomicity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
  });

  it("states that a PostgreSQL sync rolls the target back on failure", async () => {
    mockConnections.push(
      { id: "pg1", db_type: "postgresql", name: "Postgres 1", database: "src" },
      { id: "pg2", db_type: "postgresql", name: "Postgres 2", database: "dst" },
    );
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    render(<SyncPage />);
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "pg1" } });

    const note = await screen.findByTestId("sync-atomicity");
    expect(note.textContent).toMatch(/one\s+transaction/i);
    expect(note.textContent).toMatch(/rolled back/i);
    expect(note.textContent).toMatch(/left\s+unchanged/i);
  });

  it("does not claim a transaction for a non-PostgreSQL target", async () => {
    mockConnections.push(
      { id: "my1", db_type: "mysql", name: "MySQL 1", database: "db1" },
      { id: "my2", db_type: "mysql", name: "MySQL 2", database: "db2" },
    );
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue(mysqlToolsOk);
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["db1"]);
    render(<SyncPage />);
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "my1" } });
    await waitFor(() => expect(screen.queryByTestId("sync-atomicity")).toBeNull());
  });
});

// Ticket 27: a sync resolves one credential per side, so a keychain-off target
// asks for its own session password instead of failing with an empty one.
describe("SyncPage session credential prompt (ticket 27)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    mockConnections.push({ id: "src", db_type: "postgresql", name: "source", database: "db1", use_keychain: false });
    mockConnections.push({ id: "tgt", db_type: "postgresql", name: "target", database: "db1", use_keychain: false });
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "detectPgTools").mockResolvedValue(pgToolsOk);
    sessionCredentialMock.requestSessionCredential.mockReset();
    sessionCredentialMock.setSessionPassword.mockReset();
    sessionCredentialMock.requestSessionCredential.mockResolvedValue("typed-password");
    sessionCredentialMock.setSessionPassword.mockResolvedValue(undefined);
  });

  it("asks for the missing side's password and retries the sync", async () => {
    const sync = vi
      .spyOn(commands, "dbSync")
      .mockRejectedValueOnce(new Error("session-credential-required:tgt"))
      .mockResolvedValueOnce("job-1");

    render(<SyncPage />);
    await waitFor(() => expect(screen.queryByText(/checking for/i)).not.toBeInTheDocument());
    const [sourceSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(sourceSelect, { target: { value: "src" } });
    // Selecting the source starts its tool check, whose effect also clears the
    // destructive confirmation. Wait for that commit before confirming, and
    // re-query the target (its options are rebuilt for the chosen db type).
    await waitFor(() => expect(commands.detectPgTools).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/checking for/i)).not.toBeInTheDocument());
    const [, targetSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(targetSelect, { target: { value: "tgt" } });
    fireEvent.click(await screen.findByTestId("sync-confirm-checkbox"));
    const startButton = await screen.findByRole("button", { name: /start sync/i });
    await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(startButton);

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    // The refusal names the target, not the page's source connection.
    expect(sessionCredentialMock.requestSessionCredential).toHaveBeenCalledWith("tgt");
    expect(sessionCredentialMock.setSessionPassword).toHaveBeenCalledWith("tgt", "typed-password");
  });
});
