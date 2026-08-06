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
  use_keychain: undefined as boolean | undefined,
  created_at: "2026-07-26T00:00:00Z",
  updated_at: "2026-07-26T00:00:00Z",
};

// Mutable stand-in for the connection store's session-password behavior: a
// fallback password (default "pw", like a keychain hit) plus a per-connection
// session map written by setSessionPassword (like the real store).
const mockStoreState = vi.hoisted(() => {
  const sessionPasswords = new Map<string, string>();
  let fallbackPassword: string | null = "pw";
  return {
    sessionPasswords,
    setFallbackPassword: (p: string | null) => {
      fallbackPassword = p;
    },
    getConnectionPassword: vi.fn(
      async (id: string) => sessionPasswords.get(id) ?? fallbackPassword,
    ),
    setSessionPassword: vi.fn((id: string, pw: string) => {
      sessionPasswords.set(id, pw);
    }),
  };
});

vi.mock("../stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [mockConnection],
      getConnectionPassword: mockStoreState.getConnectionPassword,
      setSessionPassword: mockStoreState.setSessionPassword,
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

function PromptHarness() {
  const { passwordPromptOpen } = useDbConnection("c1");
  return <div data-testid="prompt">{passwordPromptOpen ? "open" : "closed"}</div>;
}

describe("useDbConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mutable store stand-in + connection for isolation.
    mockStoreState.sessionPasswords.clear();
    mockStoreState.setFallbackPassword("pw");
    (mockConnection as any).use_keychain = undefined;
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

  it("opens the password prompt when use_keychain=false and no session password", async () => {
    mockConnection.use_keychain = false;
    mockStoreState.setFallbackPassword(null);
    render(<PromptHarness />);
    await waitFor(() =>
      expect(screen.getByTestId("prompt")).toHaveTextContent("open"),
    );
    // Early return: no Tauri call fires before the user submits a password.
    expect(mockCommands.dbConnect).not.toHaveBeenCalled();
  });

  it("does not prompt when keychain is enabled (even without a stored password)", async () => {
    mockConnection.use_keychain = true;
    mockStoreState.setFallbackPassword(null);
    render(<PromptHarness />);
    await waitFor(() =>
      expect(mockCommands.dbConnect).toHaveBeenCalled(),
    );
    expect(screen.getByTestId("prompt")).toHaveTextContent("closed");
  });

  it("submitPassword stores the session password and reconnects", async () => {
    mockConnection.use_keychain = false;
    mockStoreState.setFallbackPassword(null);
    let submit: ((pw: string) => void) | null = null;
    function SubmitHarness() {
      const { passwordPromptOpen, submitPassword } = useDbConnection("c1");
      submit = submitPassword;
      return (
        <div data-testid="prompt">
          {passwordPromptOpen ? "open" : "closed"}
        </div>
      );
    }
    render(<SubmitHarness />);
    await waitFor(() =>
      expect(screen.getByTestId("prompt")).toHaveTextContent("open"),
    );
    act(() => submit!("secret"));
    expect(mockStoreState.setSessionPassword).toHaveBeenCalledWith("c1", "secret");
    await waitFor(() =>
      expect(screen.getByTestId("prompt")).toHaveTextContent("closed"),
    );
    await waitFor(() => expect(mockCommands.dbConnect).toHaveBeenCalled());
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
