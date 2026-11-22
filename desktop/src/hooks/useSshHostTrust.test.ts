import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSshHostTrust } from "./useSshHostTrust";
import * as commands from "../lib/commands";
import type { SshHostTrustState } from "../lib/types";

vi.mock("../lib/commands", () => ({
  sshHostTrustState: vi.fn(),
  sshHostTrustEnroll: vi.fn(),
  sshHostTrustReenroll: vi.fn(),
}));

const mockCommands = vi.mocked(commands);

const unknown: SshHostTrustState = {
  state: "unknown",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
};

const trusted: SshHostTrustState = {
  state: "trusted",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
  source: "known_hosts",
};

const mismatch: SshHostTrustState = {
  state: "mismatch",
  host: "db.example.com",
  port: 2222,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:presented",
  expected_key_type: "ssh-ed25519",
  expected_fingerprint: "SHA256:expected",
  source: "enrolled",
};

describe("useSshHostTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces an unknown host after a failed attempt", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });

    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      2222,
    );
    expect(result.current.trustState).toEqual(unknown);
  });

  it("defaults to port 22 and ignores non-SSH connections", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", null);
    });
    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      22,
    );

    vi.clearAllMocks();
    await act(async () => {
      await result.current.check(null, 22);
    });
    expect(mockCommands.sshHostTrustState).not.toHaveBeenCalled();
  });

  it("does not prompt when the host is already trusted", async () => {
    // A trusted host means the failure was something else: leave it alone.
    mockCommands.sshHostTrustState.mockResolvedValue(trusted);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });

    expect(result.current.trustState).toBeNull();
  });

  it("enrolls the accepted fingerprint and reports that a retry is due", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    mockCommands.sshHostTrustEnroll.mockResolvedValue(trusted);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let retry = false;
    await act(async () => {
      retry = await result.current.accept();
    });

    expect(mockCommands.sshHostTrustEnroll).toHaveBeenCalledWith(
      "db.example.com",
      2222,
      { key_type: "ssh-ed25519", fingerprint: "SHA256:abc123" },
    );
    expect(retry).toBe(true);
    expect(result.current.trustState).toBeNull();
  });

  it("keeps the state and shows the error when enrollment fails", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    mockCommands.sshHostTrustEnroll.mockRejectedValue(
      new Error("the SSH server now offers a different host key"),
    );
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let retry = true;
    await act(async () => {
      retry = await result.current.accept();
    });

    expect(retry).toBe(false);
    expect(result.current.trustState).toEqual(unknown);
    expect(result.current.error).toMatch(/different host key/);
  });

  it("never enrolls a conflicting key during an attempt", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let retry = true;
    await act(async () => {
      retry = await result.current.accept();
    });

    expect(retry).toBe(false);
    expect(mockCommands.sshHostTrustEnroll).not.toHaveBeenCalled();
  });

  it("offers the connect path no way to replace a trusted host key", async () => {
    // The boundary of ticket 22: replacing trust belongs to the connection's
    // trust state (`useSshHostTrustState`), so the authentication path has no
    // re-enrollment capability at all — a mismatch here stays a dead end.
    //
    // Every command is wired and the whole check → accept cycle is exercised, so
    // the negative assertions below observe the same spies the hook really calls
    // (`sshHostTrustState` firing is the positive control). A bare
    // `expect(spy).not.toHaveBeenCalled()` on a spy nothing is wired to passes
    // no matter what the hook does.
    mockCommands.sshHostTrustState.mockResolvedValue(trusted);
    mockCommands.sshHostTrustEnroll.mockResolvedValue(trusted);
    mockCommands.sshHostTrustReenroll.mockResolvedValue(trusted);
    const { result } = renderHook(() => useSshHostTrust());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let retry = true;
    await act(async () => {
      retry = await result.current.accept();
    });

    // Positive control: these spies ARE the module the hook talks to.
    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      2222,
    );
    // An already-trusted host needs no enrollment, and nothing may replace it.
    expect(retry).toBe(false);
    expect(mockCommands.sshHostTrustEnroll).not.toHaveBeenCalled();
    expect(mockCommands.sshHostTrustReenroll).not.toHaveBeenCalled();
    expect(Object.keys(result.current).sort()).toEqual([
      "accept",
      "busy",
      "check",
      "dismiss",
      "error",
      "trustState",
    ]);
  });
});
