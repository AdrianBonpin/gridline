import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { SshHostTrustPanel } from "./SshHostTrustPanel";
import * as commands from "../../lib/commands";
import type { SshHostTrustState } from "../../lib/types";

vi.mock("../../lib/commands", () => ({
  sshHostTrustState: vi.fn(),
  sshHostTrustEnroll: vi.fn(),
  sshHostTrustReenroll: vi.fn(),
}));

const mockCommands = vi.mocked(commands);

const trusted: SshHostTrustState = {
  state: "trusted",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:current",
  source: "enrolled",
};

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
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:rotated",
  expected_key_type: "ssh-ed25519",
  expected_fingerprint: "SHA256:stale",
  source: "enrolled",
};

const rotatedTrusted: SshHostTrustState = {
  state: "trusted",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:rotated",
  source: "enrolled",
};

describe("SshHostTrustPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing until the connection has an SSH host", () => {
    const { container } = render(<SshHostTrustPanel host="" port={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the trusted fingerprint and offers no replacement action", async () => {
    const user = userEvent.setup();
    mockCommands.sshHostTrustState.mockResolvedValue(trusted);
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));

    await waitFor(() =>
      expect(screen.getByTestId("ssh-host-trust-fingerprint")).toHaveTextContent(
        "SHA256:current",
      ),
    );
    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      2222,
    );
    expect(
      screen.queryByRole("button", { name: /re-enroll|accept fingerprint/i }),
      "a trusted key needs no decision",
    ).not.toBeInTheDocument();
  });

  it("accepts a first-use fingerprint from the trust state", async () => {
    const user = userEvent.setup();
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    mockCommands.sshHostTrustEnroll.mockResolvedValue(trusted);
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));
    await user.click(
      await screen.findByRole("button", { name: /accept fingerprint/i }),
    );

    expect(mockCommands.sshHostTrustEnroll).toHaveBeenCalledWith(
      "db.example.com",
      2222,
      { key_type: "ssh-ed25519", fingerprint: "SHA256:abc123" },
    );
    expect(mockCommands.sshHostTrustReenroll).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before replacing stale trust", async () => {
    const user = userEvent.setup();
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    mockCommands.sshHostTrustReenroll.mockResolvedValue(rotatedTrusted);
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));

    expect(await screen.findByTestId("ssh-host-trust-expected")).toHaveTextContent(
      "SHA256:stale",
    );
    expect(screen.getByTestId("ssh-host-trust-presented")).toHaveTextContent(
      "SHA256:rotated",
    );

    const reenroll = screen.getByRole("button", { name: /re-enroll host key/i });
    expect(
      reenroll,
      "replacing trust needs an out-of-band comparison first",
    ).toBeDisabled();

    await user.click(screen.getByLabelText(/compared the fingerprint/i));
    expect(reenroll).toBeEnabled();

    await user.click(reenroll);

    await waitFor(() =>
      expect(mockCommands.sshHostTrustReenroll).toHaveBeenCalledWith(
        "db.example.com",
        2222,
        { key_type: "ssh-ed25519", fingerprint: "SHA256:rotated" },
      ),
    );
  });

  it("shows the re-enrolled key as the trusted one", async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockCommands.sshHostTrustState.mockImplementation(async () =>
      calls++ === 0 ? mismatch : rotatedTrusted,
    );
    mockCommands.sshHostTrustReenroll.mockResolvedValue(rotatedTrusted);
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));
    await user.click(await screen.findByLabelText(/compared the fingerprint/i));
    await user.click(
      screen.getByRole("button", { name: /re-enroll host key/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("ssh-host-trust-fingerprint"),
      ).toHaveTextContent("SHA256:rotated"),
    );
    expect(
      screen.queryByRole("button", { name: /re-enroll host key/i }),
      "the conflict is resolved once the new key is verified",
    ).not.toBeInTheDocument();

    // Re-checking against the endpoint now reports it as trusted.
    await user.click(screen.getByRole("button", { name: /re-check host key/i }));
    await waitFor(() =>
      expect(screen.getByTestId("ssh-host-trust-fingerprint")).toHaveTextContent(
        "SHA256:rotated",
      ),
    );
    expect(mockCommands.sshHostTrustReenroll).toHaveBeenCalledTimes(1);
  });

  it("surfaces a refused re-enrollment without pretending trust changed", async () => {
    const user = userEvent.setup();
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    mockCommands.sshHostTrustReenroll.mockRejectedValue(
      new Error("the SSH server now offers a different host key"),
    );
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));
    await user.click(await screen.findByLabelText(/compared the fingerprint/i));
    await user.click(
      screen.getByRole("button", { name: /re-enroll host key/i }),
    );

    expect(
      await screen.findByTestId("ssh-host-trust-error"),
    ).toHaveTextContent(/different host key/);
    expect(screen.getByTestId("ssh-host-trust-expected")).toHaveTextContent(
      "SHA256:stale",
    );
  });

  it("requires a new comparison when a later check finds another conflict", async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockCommands.sshHostTrustState.mockImplementation(async () => {
      calls += 1;
      // A second mismatch presents yet another key: the earlier confirmation
      // must not still count.
      return calls === 1
        ? mismatch
        : { ...mismatch, fingerprint: "SHA256:third" };
    });
    render(<SshHostTrustPanel host="db.example.com" port={2222} />);

    await user.click(screen.getByRole("button", { name: /check host key/i }));
    await user.click(await screen.findByLabelText(/compared the fingerprint/i));
    expect(
      screen.getByRole("button", { name: /re-enroll host key/i }),
    ).toBeEnabled();

    // The endpoint now presents a different key: trust it only after a fresh,
    // explicit comparison, even though the previous one was still checked.
    await user.click(screen.getByRole("button", { name: /re-check host key/i }));

    expect(
      await screen.findByTestId("ssh-host-trust-presented"),
    ).toHaveTextContent("SHA256:third");
    expect(
      screen.getByRole("button", { name: /re-enroll host key/i }),
    ).toBeDisabled();
    expect(mockCommands.sshHostTrustReenroll).not.toHaveBeenCalled();
  });
});
