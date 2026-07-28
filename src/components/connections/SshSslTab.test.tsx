import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SshSslTab } from "./SshSslTab";

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("SshSslTab", () => {
  it("renders SSH and SSL sub-tab buttons", () => {
    render(<SshSslTab form={{}} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "SSH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SSL" })).toBeInTheDocument();
  });

  it("toggles between SSH and SSL content", async () => {
    const user = userEvent.setup();
    render(<SshSslTab form={{}} onChange={() => {}} />);

    expect(screen.getByLabelText("SSH Host")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SSL Mode" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "SSL" }));

    expect(screen.queryByLabelText("SSH Host")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SSL Mode" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "SSH" }));

    expect(screen.getByLabelText("SSH Host")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SSL Mode" })).not.toBeInTheDocument();
  });
});