import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditConnectionModal } from "./EditConnectionModal";
import type { Connection } from "../../lib/types";

const { updateConnection, loadAll } = vi.hoisted(() => ({
  updateConnection: vi.fn().mockResolvedValue({}),
  loadAll: vi.fn(),
}));

vi.mock("../../stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: any) => any) =>
    sel({ updateConnection, loadAll, folders: [], tags: [] }),
}));
vi.mock("../../lib/commands", () => ({
  updateConnection: vi.fn(),
  testConnection: vi.fn(),
  saveConnectionPassword: vi.fn(),
  saveConnectionSshPassword: vi.fn(),
  saveConnectionSshPassphrase: vi.fn(),
}));
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
});