import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("writes certificate paths under the names the backend persists", () => {
    // Regression guard: these used to be ssl_ca_cert / ssl_client_cert /
    // ssl_client_key, which the Rust ConnectionInput silently ignores — the
    // connection was then saved with TLS disabled.
    const onChange = vi.fn();
    render(
      <SslFields
        values={{ ssl_mode: "verify-full", ssl_ca_path: "/tmp/ca.pem" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("CA Certificate")).toHaveValue("/tmp/ca.pem");
    fireEvent.change(screen.getByLabelText("CA Certificate"), {
      target: { value: "/tmp/root.pem" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ssl_ca_path: "/tmp/root.pem" });

    fireEvent.change(screen.getByLabelText("Client Certificate"), {
      target: { value: "/tmp/client.pem" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ssl_cert_path: "/tmp/client.pem" });

    fireEvent.change(screen.getByLabelText("Client Key"), {
      target: { value: "/tmp/client.key" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ssl_key_path: "/tmp/client.key" });
  });
});