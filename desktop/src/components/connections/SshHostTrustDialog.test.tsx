import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { SshHostTrustDialog } from "./SshHostTrustDialog";
import type { SshHostTrustState } from "../../lib/types";

const unknown: SshHostTrustState = {
  state: "unknown",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
};

const mismatch: SshHostTrustState = {
  state: "mismatch",
  host: "db.example.com",
  port: 22,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:presented",
  expected_key_type: "ssh-ed25519",
  expected_fingerprint: "SHA256:expected",
  source: "known_hosts",
};

describe("SshHostTrustDialog", () => {
  it("renders nothing without an untrusted state", () => {
    const { container } = render(
      <SshHostTrustDialog state={null} onAccept={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the endpoint and fingerprint of an unknown host and accepts it", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <SshHostTrustDialog state={unknown} onAccept={onAccept} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/db\.example\.com:2222/)).toBeInTheDocument();
    expect(screen.getByTestId("ssh-host-fingerprint")).toHaveTextContent(
      "SHA256:abc123",
    );

    await user.click(screen.getByRole("button", { name: /accept fingerprint/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("disables acceptance while the enrollment is in flight", () => {
    render(
      <SshHostTrustDialog state={unknown} busy onAccept={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /accepting/i })).toBeDisabled();
  });

  it("shows both fingerprints for a conflicting key and offers no inline bypass", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SshHostTrustDialog state={mismatch} onAccept={vi.fn()} onClose={onClose} />,
    );

    expect(screen.getByTestId("ssh-host-expected")).toHaveTextContent(
      "SHA256:expected",
    );
    expect(screen.getByTestId("ssh-host-presented")).toHaveTextContent(
      "SHA256:presented",
    );
    expect(
      screen.queryByRole("button", { name: /accept/i }),
      "a changed key is never accepted during authentication",
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reports an enrollment error next to the fingerprint", () => {
    render(
      <SshHostTrustDialog
        state={unknown}
        error="the SSH server now offers a different host key"
        onAccept={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/different host key/)).toBeInTheDocument();
  });
});
