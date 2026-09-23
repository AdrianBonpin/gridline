import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditConnectionModal } from "./EditConnectionModal";
import * as commands from "../../lib/commands";
import type { Connection } from "../../lib/types";

const { updateConnection, loadAll } = vi.hoisted(() => ({
  updateConnection: vi.fn().mockResolvedValue({}),
  loadAll: vi.fn(),
}));

vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (sel: (s: any) => any) =>
      sel({ updateConnection, loadAll, folders: [], tags: [] }),
    { getState: () => ({ getConnectionPassword: async () => "pw" }) },
  ),
}));
vi.mock("../../lib/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/commands")>();
  return {
    ...actual,
    updateConnection: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    saveConnectionPassword: vi.fn(),
    saveConnectionSshPassword: vi.fn(),
    saveConnectionSshPassphrase: vi.fn(),
    getConnectionSshPassword: vi.fn().mockResolvedValue(null),
    getConnectionSshPassphrase: vi.fn().mockResolvedValue(null),
    deleteConnectionPassword: vi.fn(),
  };
});
vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: (sel: (s: any) => any) => sel({ notify: vi.fn() }),
}));

const baseConn: Connection = {
  id: "c1",
  name: "Prod",
  db_type: "postgresql",
  host: "localhost",
  port: 5432,
  username: "u",
  folder_id: null,
  keychain_ref: null,
  tag_ids: [],
  favorite: false,
  created_at: "",
  updated_at: "",
  database: "db",
};

describe("EditConnectionModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the Connection Label field and General/SSH tabs", () => {
    render(
      <EditConnectionModal
        connection={baseConn}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(screen.getByLabelText(/connection label/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^general$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ssh \/ ssl/i })).toBeInTheDocument();
  });

  it("shows the Supabase SSL hint when editing a Supabase-host connection", () => {
    const supa = { ...baseConn, host: "db.abcdefghijklmnopqrst.supabase.co" };
    render(
      <EditConnectionModal
        connection={supa}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(screen.getByText(/requires ssl/i)).toBeInTheDocument();
  });

  it("prefills the keychain toggle from the connection (use_keychain=true)", () => {
    render(
      <EditConnectionModal
        connection={{ ...baseConn, use_keychain: true }}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    const cb = screen.getByLabelText("Enable keychain") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("saves to keychain when use_keychain=true", async () => {
    render(
      <EditConnectionModal
        connection={{ ...baseConn, use_keychain: true }}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(vi.mocked(commands.saveConnectionPassword)).toHaveBeenCalledWith("c1", "secret")
    );
    expect(vi.mocked(commands.deleteConnectionPassword)).not.toHaveBeenCalled();
  });

  it("purges keychain when use_keychain=false", async () => {
    render(
      <EditConnectionModal
        connection={{ ...baseConn, use_keychain: false }}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(vi.mocked(commands.deleteConnectionPassword)).toHaveBeenCalledWith("c1")
    );
    expect(vi.mocked(commands.saveConnectionPassword)).not.toHaveBeenCalled();
  });

  it("persists the existing SSL settings on save", async () => {
    render(
      <EditConnectionModal
        connection={{
          ...baseConn,
          ssl_mode: "verify-full",
          ssl_ca_path: "/tmp/ca.pem",
          ssl_cert_path: "/tmp/client.pem",
          ssl_key_path: "/tmp/client.key",
        }}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(vi.mocked(commands.updateConnection)).toHaveBeenCalled());
    expect(vi.mocked(commands.updateConnection)).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        ssl_mode: "verify-full",
        ssl_ca_path: "/tmp/ca.pem",
        ssl_cert_path: "/tmp/client.pem",
        ssl_key_path: "/tmp/client.key",
      }),
    );
  });

  it("tests with the same SSL + SSH config it would save", async () => {
    render(
      <EditConnectionModal
        connection={{
          ...baseConn,
          ssl_mode: "require",
          ssh_host: "jump.example.com",
          ssh_port: 22,
          ssh_user: "tunnel",
          ssh_auth_method: "key",
          ssh_private_key_path: "/tmp/id_ed25519",
        }}
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    await waitFor(() => expect(vi.mocked(commands.testConnection)).toHaveBeenCalled());
    expect(vi.mocked(commands.testConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        ssl_mode: "require",
        ssh_host: "jump.example.com",
        ssh_user: "tunnel",
        ssh_auth_method: "key",
        ssh_private_key_path: "/tmp/id_ed25519",
      }),
    );
  });
});