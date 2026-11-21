import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

  // Regression (#47): `isMysql = dbType === "mysql"` made a MariaDB connection
  // match neither branch, so the MySQL tool check never ran and no MySQL backup
  // form was rendered.
  it("runs the MySQL tool check for a MariaDB connection", async () => {
    mockConnections.push({ id: "c1", db_type: "mariadb", name: "mdb", database: "db1" });
    const detectMysql = vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: true,
      mysqlFound: true,
      mysqldumpVersion: "11.4",
      mysqlVersion: "11.4",
      mysqldumpSource: "system",
      mysqlSource: "system",
    });
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(detectMysql).toHaveBeenCalled());
    expect(screen.getByText("Plain SQL")).toBeTruthy();
  });
});

describe("BackupPage tool provenance and re-check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue([]);
  });

  it("shows the resolved tool and its source", async () => {
    mockConnections.push({ id: "c1", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: true,
      mysqlFound: true,
      mysqldumpVersion: "mariadb-dump 11.4.5-MariaDB",
      mysqlVersion: "mariadb 11.4.5-MariaDB",
      mysqldumpSource: "bundled",
      mysqlSource: "bundled",
      mysqldumpResolvedName: "mariadb-dump",
      mysqlResolvedName: "mariadb",
      mysqldumpBundledAvailable: true,
      mysqlBundledAvailable: true,
    });
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.getByText(/Using bundled mariadb-dump/)).toBeTruthy());
  });

  it("re-checks with force when Check again is clicked", async () => {
    mockConnections.push({ id: "c2", db_type: "mysql", name: "m", database: "db1" });
    const spy = vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: false,
      mysqlFound: false,
      mysqldumpVersion: null,
      mysqlVersion: null,
      mysqldumpSource: null,
      mysqlSource: null,
    });
    render(<BackupPage connectionId="c2" />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
  });

  it("explains when the bundled tool is present but could not run", async () => {
    mockConnections.push({ id: "c3", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: false,
      mysqlFound: false,
      mysqldumpVersion: null,
      mysqlVersion: null,
      mysqldumpSource: null,
      mysqlSource: null,
      mysqldumpBundledAvailable: true,
      mysqlBundledAvailable: false,
    });
    render(<BackupPage connectionId="c3" />);
    await waitFor(() =>
      expect(screen.getByText(/bundled copy is present but could not run/i)).toBeTruthy(),
    );
  });

  it("shows install instructions when nothing resolves at all", async () => {
    mockConnections.push({ id: "c4", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: false,
      mysqlFound: false,
      mysqldumpVersion: null,
      mysqlVersion: null,
      mysqldumpSource: null,
      mysqlSource: null,
      mysqldumpBundledAvailable: false,
    });
    render(<BackupPage connectionId="c4" />);
    await waitFor(() => expect(screen.getByText(/mysql-client/)).toBeTruthy());
  });

  it("offers a copy button for the install command", async () => {
    mockConnections.push({ id: "c-copy", db_type: "mysql", name: "m", database: "db1" });
    vi.spyOn(commands, "detectMysqlTools").mockResolvedValue({
      mysqldumpFound: false,
      mysqlFound: false,
      mysqldumpVersion: null,
      mysqlVersion: null,
      mysqldumpSource: null,
      mysqlSource: null,
      mysqldumpBundledAvailable: false,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });
    render(<BackupPage connectionId="c-copy" />);
    const btn = await screen.findByTitle("Copy to clipboard");
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("mysql-client"),
    );
  });
});
describe("BackupPage job cancellation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue([]);
    vi.spyOn(commands, "detectPgTools").mockResolvedValue({
      pg_dump_found: true,
      pg_restore_found: true,
      pg_dump_version: "16",
      pg_restore_version: "16",
      pg_dump_source: "system",
      pg_restore_source: "system",
    });
  });

  it("cancels the running job by the backend's job id", async () => {
    mockConnections.push({ id: "c1", db_type: "postgresql", name: "p" });
    const cancel = vi.spyOn(commands, "cancelToolJob").mockResolvedValue(true);
    useBackupStore.getState().startJob("backend-uuid", "dump");

    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.getByText("In progress...")).toBeTruthy());

    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith("backend-uuid"));
    await waitFor(() =>
      expect(useBackupStore.getState().jobs[0].status).toBe("cancelled"),
    );
  });

  it("offers a retry after a failed backup", async () => {
    mockConnections.push({ id: "c2", db_type: "postgresql", name: "p" });
    useBackupStore.getState().startJob("job-failed", "dump");
    useBackupStore.getState().failJob("job-failed", "pg_dump: connection refused");

    render(<BackupPage connectionId="c2" />);
    await waitFor(() => expect(screen.getByTestId("backup-retry")).toBeTruthy());
    expect(screen.getByText(/connection refused/)).toBeTruthy();
  });

  it("shows why a bounded tool probe failed instead of only 'not found'", async () => {
    mockConnections.push({ id: "c3", db_type: "postgresql", name: "p" });
    vi.spyOn(commands, "detectPgTools").mockResolvedValue({
      pg_dump_found: false,
      pg_restore_found: false,
      pg_dump_version: null,
      pg_restore_version: null,
      pg_dump_source: null,
      pg_restore_source: null,
      pg_dump_probe_error:
        "/opt/homebrew/bin/pg_dump — The tool did not respond within 1s and was stopped",
    });

    render(<BackupPage connectionId="c3" />);
    await waitFor(() => expect(screen.getByTestId("tool-probe-error")).toBeTruthy());
    expect(screen.getByTestId("tool-probe-error").textContent).toContain(
      "did not respond",
    );
  });
});

describe("BackupPage File Grant output authorization", () => {
  const grant = {
    id: "grant-1",
    path: "/tmp/granted-backup.dump",
    displayName: "granted-backup.dump",
    intent: "write" as const,
    expiresInSeconds: 300,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockConnections.length = 0;
    mockConnections.push({ id: "c1", db_type: "postgresql", name: "p" });
    useBackupStore.setState({ jobs: [], activeJobId: null, progress: 0 });
    useNotificationStore.setState({ notifications: [] });
    vi.spyOn(commands, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(commands, "detectPgTools").mockResolvedValue({
      pg_dump_found: true,
      pg_restore_found: true,
      pg_dump_version: "16",
      pg_restore_version: "16",
      pg_dump_source: "system",
      pg_restore_source: "system",
    });
  });

  it("asks the backend for a File Grant and sends its id instead of a path", async () => {
    const select = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue(grant);
    const dump = vi.spyOn(commands, "pgDump").mockResolvedValue("job-1");

    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Browse for file"));

    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(select).toHaveBeenCalledWith({
      intent: "write",
      title: "Save backup as",
      defaultName: "backup.dump",
      filters: [{ name: "Backup", extensions: ["dump", "custom"] }],
    });

    // The picked path is shown (display metadata) but Start sends only the id.
    const output = screen.getByTestId("backup-output-path") as HTMLInputElement;
    expect(output.value).toBe("/tmp/granted-backup.dump");
    expect(output.readOnly).toBe(true);

    fireEvent.click(screen.getByText("Start Backup"));
    await waitFor(() => expect(dump).toHaveBeenCalledTimes(1));

    const [connectionId, options, grantId] = dump.mock.calls[0];
    expect(connectionId).toBe("c1");
    expect(grantId).toBe("grant-1");
    expect(options).toEqual({
      format: "custom",
      schema: undefined,
      tables: undefined,
      noOwner: true,
    });
    expect(options).not.toHaveProperty("filePath");
  });

  it("offers no way to authorize a backup from a typed path", async () => {
    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());

    const output = screen.getByTestId("backup-output-path") as HTMLInputElement;
    expect(output.readOnly).toBe(true);
    expect(output.value).toBe("");

    // Without a grant there is nothing to authorize, so Start cannot fire.
    const start = screen.getByText("Start Backup").closest("button")!;
    expect(start.disabled).toBe(true);
  });

  it("shows a visible expired-grant state with a recovery action", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(grant);
    vi.spyOn(commands, "pgDump").mockRejectedValue(
      "file-grant-expired: The file selection expired five minutes after it was made. Choose the file again.",
    );

    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Browse for file"));
    await waitFor(() => expect(screen.getByTestId("backup-output-path")).toBeTruthy());
    fireEvent.click(screen.getByText("Start Backup"));

    const expired = await screen.findByTestId("file-grant-expired");
    expect(expired.textContent).toContain("File selection expired");
    // Recovery is a fresh selection, not a silent retry with the same id.
    expect(within(expired).getByText("Choose file")).toBeTruthy();

    // The spent selection is gone, so Start is disabled until a new one.
    const start = screen.getByText("Start Backup").closest("button")!;
    expect(start.disabled).toBe(true);
  });

  it("requires a fresh selection for the next job (each grant is single-use)", async () => {
    vi.spyOn(commands, "selectFileForGrant").mockResolvedValue(grant);
    vi.spyOn(commands, "pgDump").mockResolvedValue("job-1");

    render(<BackupPage connectionId="c1" />);
    await waitFor(() => expect(screen.queryByText(/checking for pg_dump/i)).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Browse for file"));
    await waitFor(() => expect(screen.getByTestId("backup-output-path")).toBeTruthy());
    fireEvent.click(screen.getByText("Start Backup"));

    await waitFor(() => expect(commands.pgDump).toHaveBeenCalledTimes(1));

    // The spent grant is not offered again: the next job must pick a file.
    const start = screen.getByRole("button", { name: /backing up|start backup/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    // The path is still displayed as metadata; it is not authorization.
    expect(
      (screen.getByTestId("backup-output-path") as HTMLInputElement).value,
    ).toBe("/tmp/granted-backup.dump");
  });

  it("sends the grant id for MySQL and SQLite backups too", async () => {
    mockConnections.length = 0;
    mockConnections.push({ id: "s1", db_type: "sqlite", name: "s" });
    const select = vi
      .spyOn(commands, "selectFileForGrant")
      .mockResolvedValue({ ...grant, path: "/tmp/demo.db.sql" });
    const dump = vi.spyOn(commands, "sqliteDump").mockResolvedValue("job-sqlite");

    render(<BackupPage connectionId="s1" />);
    fireEvent.click(screen.getByLabelText("Browse for file"));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(select).toHaveBeenCalledWith({
      intent: "write",
      title: "Save backup as",
      defaultName: "backup.db",
      filters: [{ name: "Backup", extensions: ["db", "sqlite", "sql"] }],
    });

    fireEvent.click(screen.getByText("Start Backup"));
    await waitFor(() => expect(dump).toHaveBeenCalledWith("s1", "grant-1"));
  });
});
