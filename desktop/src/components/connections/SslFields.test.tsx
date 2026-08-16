import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SslFields } from "./SslFields";

const notify = vi.fn();

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: (selector: (s: { notify: typeof notify }) => unknown) =>
    selector({ notify }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("SslFields", () => {
  it("renders SSL mode dropdown", () => {
    render(<SslFields values={{}} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "SSL Mode" })).toBeInTheDocument();
  });

  it("shows file pickers for verify-full mode", () => {
    render(<SslFields values={{ ssl_mode: "verify-full" }} onChange={() => {}} />);

    expect(screen.getByLabelText("CA Certificate")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Certificate")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Key")).toBeInTheDocument();
  });

  it("hides file pickers for disable mode", () => {
    render(<SslFields values={{ ssl_mode: "disable" }} onChange={() => {}} />);

    expect(screen.queryByLabelText("CA Certificate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Client Certificate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Client Key")).not.toBeInTheDocument();
  });
});