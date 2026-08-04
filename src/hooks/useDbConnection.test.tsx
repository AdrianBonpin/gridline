import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useDbConnection } from "./useDbConnection";
import { useDbViewerStore } from "../stores/dbViewerStore";
import * as commands from "../lib/commands";

vi.mock("../lib/commands", () => ({
  dbConnect: vi.fn().mockResolvedValue(undefined),
  dbDisconnect: vi.fn().mockResolvedValue(undefined),
  getDatabases: vi.fn().mockResolvedValue([]),
  getSchemas: vi.fn().mockResolvedValue([]),
  getTables: vi.fn().mockResolvedValue([]),
  getConnectionPassword: vi.fn().mockResolvedValue("pw"),
  getConnectionSshPassword: vi.fn().mockResolvedValue(null),
  getConnectionSshPassphrase: vi.fn().mockResolvedValue(null),
}));

const mockCommands = vi.mocked(commands);

const mockConnection = {
  id: "c1",
  name: "Conn",
  db_type: "postgresql",
  host: "localhost",
  port: 5432,
  username: "postgres",
  database: "mydb",
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  environment: null,
  ssh_host: null as string | null,
  ssh_port: null,
  ssh_user: null,
  ssh_auth_method: null as string | null,
  ssh_private_key_path: null,
  ssl_mode: null,
  ssl_ca_path: null,
  ssl_cert_path: null,
  ssl_key_path: null,
  created_at: "2026-07-26T00:00:00Z",
  updated_at: "2026-07-26T00:00:00Z",
};

vi.mock("../stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [mockConnection],
      getConnectionPassword: async () => "pw",
    }),
  },
}));

function Harness() {
  const { connect } = useDbConnection("c1");
  return (
    <button type="button" onClick={() => connect()}>
      connect
    </button>
  );
}

describe("useDbConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDbViewerStore.getState().reset();
    mockCommands.getDatabases.mockResolvedValue(["mydb", "otherdb"]);
    mockCommands.getSchemas.mockResolvedValue(["app", "public"]);
    mockCommands.getTables.mockResolvedValue([]);
    mockCommands.getConnectionSshPassword.mockResolvedValue(null);
    mockCommands.getConnectionSshPassphrase.mockResolvedValue(null);
    mockConnection.ssh_host = null;
    mockConnection.ssh_auth_method = null;
  });

  it("sets schemaTreeLoading around the connect fetch", async () => {
    mockCommands.getSchemas.mockImplementation(
      () => new Promise((res) => setTimeout(() => res(["public"]), 50)),
    );
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(useDbViewerStore.getState().schemaTreeLoading).toBe(true),
    );
    await waitFor(() =>
      expect(useDbViewerStore.getState().schemaTreeLoading).toBe(false),
    );
  });

  it("clears schemaTreeLoading when connect throws", async () => {
    mockCommands.getSchemas.mockRejectedValue(new Error("boom"));
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(useDbViewerStore.getState().schemaTreeLoading).toBe(false),
    );
  });

  it("connects and smart-selects the public schema when available", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));

    await waitFor(() => {
      expect(useDbViewerStore.getState().currentDatabase).toBe("mydb");
    });
    expect(useDbViewerStore.getState().currentSchema).toBe("public");
    // tables are fetched for the smart default schema
    expect(mockCommands.getTables).toHaveBeenCalledWith("c1", "public");
  });

  it("falls back to the first schema when public is absent", async () => {
    mockCommands.getSchemas.mockResolvedValue(["analytics", "app"]);
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));

    await waitFor(() => {
      expect(useDbViewerStore.getState().currentSchema).toBe("analytics");
    });
    expect(mockCommands.getTables).toHaveBeenCalledWith("c1", "analytics");
  });

  it("reconnects and refreshes schemas when the database changes", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(useDbViewerStore.getState().currentDatabase).toBe("mydb");
    });
    mockCommands.getDatabases.mockResolvedValue(["mydb", "otherdb"]);
    mockCommands.getSchemas.mockResolvedValue(["analytics", "public"]);

    await act(async () => {
      useDbViewerStore.setState({ currentDatabase: "otherdb" });
    });

    expect(mockCommands.dbConnect).toHaveBeenLastCalledWith(
      "c1",
      expect.objectContaining({ database: "otherdb" }),
    );
    expect(useDbViewerStore.getState().schemas).toEqual([
      "analytics",
      "public",
    ]);
    expect(useDbViewerStore.getState().currentSchema).toBe("public");
    // tables refetched for the new database's smart schema
    expect(mockCommands.getTables).toHaveBeenLastCalledWith("c1", "public");
  });

  it("refreshes schemas when switching back to the initial database", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));
    await waitFor(() => {
      expect(useDbViewerStore.getState().currentDatabase).toBe("mydb");
    });

    // Switch away to otherdb
    await act(async () => {
      useDbViewerStore.setState({ currentDatabase: "otherdb" });
    });
    await waitFor(() =>
      expect(mockCommands.dbConnect).toHaveBeenLastCalledWith(
        "c1",
        expect.objectContaining({ database: "otherdb" }),
      ),
    );

    // Switch back to mydb — must reconnect and refresh schemas again
    mockCommands.getSchemas.mockResolvedValue(["public", "reporting"]);
    await act(async () => {
      useDbViewerStore.setState({ currentDatabase: "mydb" });
    });

    expect(mockCommands.dbConnect).toHaveBeenLastCalledWith(
      "c1",
      expect.objectContaining({ database: "mydb" }),
    );
    expect(useDbViewerStore.getState().schemas).toEqual([
      "public",
      "reporting",
    ]);
    expect(useDbViewerStore.getState().currentSchema).toBe("public");
  });

  it("fetches ssh secrets from keychain before connecting when ssh_host is set", async () => {
    mockConnection.ssh_host = "bastion.example.com";
    mockConnection.ssh_auth_method = "password";
    mockCommands.getConnectionSshPassword.mockResolvedValue("sshpw");
    mockCommands.getConnectionSshPassphrase.mockResolvedValue(null);
    render(<Harness />);
    fireEvent.click(screen.getByText("connect"));

    await waitFor(() => {
      expect(mockCommands.dbConnect).toHaveBeenCalled();
    });
    const config = mockCommands.dbConnect.mock.calls[0][1];
    expect(mockCommands.getConnectionSshPassword).toHaveBeenCalledWith("c1");
    expect(mockCommands.getConnectionSshPassphrase).toHaveBeenCalledWith("c1");
    expect(config.ssh_password).toBe("sshpw");
    expect(config.ssh_passphrase).toBeNull();
  });
});
