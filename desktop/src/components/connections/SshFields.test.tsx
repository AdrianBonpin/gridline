import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SshFields } from "./SshFields";

const notify = vi.fn();

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: (selector: (s: { notify: typeof notify }) => unknown) =>
    selector({ notify }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("SshFields", () => {
  it("renders SSH host, port, and user fields", () => {
    render(<SshFields values={{}} onChange={() => {}} />);

    expect(screen.getByLabelText("SSH Host")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH Port")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH User")).toBeInTheDocument();
  });

  it("renders auth method dropdown", () => {
    render(<SshFields values={{}} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Auth Method" })).toBeInTheDocument();
  });

  it("shows private key and passphrase fields when auth method is key", () => {
    render(<SshFields values={{ ssh_auth_method: "key" }} onChange={() => {}} />);

    expect(screen.getByLabelText("Private Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument();
    expect(screen.queryByLabelText("SSH Password")).not.toBeInTheDocument();
  });

  it("shows password field when auth method is password", () => {
    render(<SshFields values={{ ssh_auth_method: "password" }} onChange={() => {}} />);

    expect(screen.getByLabelText("SSH Password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Private Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Passphrase")).not.toBeInTheDocument();
  });
});