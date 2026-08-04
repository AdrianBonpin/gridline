import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GeneralTab } from "./GeneralTab";
import type { ConnectionFormData } from "./connectionFormData";

const BASE_FORM: ConnectionFormData = {
  name: "My DB", environment: null, folder_id: null, tag_ids: [],
  connection_string: "postgresql://u:p@localhost:5432/db", db_type: "postgresql",
  host: "localhost", port: 5432, username: "u", password: "p", database: "db",
  use_keychain: false, ssh_password: null,
};

describe("GeneralTab", () => {
  it("renders the Connection URI input (not Name)", () => {
    render(<GeneralTab form={BASE_FORM} onChange={() => {}} />);
    expect(screen.getByLabelText(/connection uri/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("renders the OR divider, host, port, user, password, database, and keychain", () => {
    render(<GeneralTab form={BASE_FORM} onChange={() => {}} />);
    expect(screen.getByTestId("or-divider")).toBeInTheDocument();
    expect(screen.getByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toBeInTheDocument();
    expect(screen.getByLabelText("Authentication")).toBeInTheDocument();
    expect(screen.getByLabelText("User")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText(/database/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/keychain/i)).toBeInTheDocument();
  });

  it("emits host changes", () => {
    const onChange = vi.fn();
    render(<GeneralTab form={BASE_FORM} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "newhost" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ host: "newhost" }));
  });

  it("shows SqlitePathInput (File Path) and hides Host/Port for sqlite", () => {
    render(<GeneralTab form={{ ...BASE_FORM, db_type: "sqlite", host: "/data/x.db", port: null }} onChange={() => {}} />);
    expect(screen.getByLabelText(/file path/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
  });

  it("emits a connection_string change when the URI field is edited", () => {
    const onChange = vi.fn();
    render(<GeneralTab form={BASE_FORM} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/connection uri/i), { target: { value: "postgresql://u@h/db" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ connection_string: "postgresql://u@h/db" }));
  });

  it("shows an SSL hint when a managed-PG preset is active", () => {
    render(<GeneralTab form={{ ...BASE_FORM, db_type: "postgresql" }} managedPreset="supabase" onChange={() => {}} />);
    expect(screen.getByText(/requires ssl/i)).toBeInTheDocument();
  });
});