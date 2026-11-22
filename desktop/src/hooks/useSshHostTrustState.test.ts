import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSshHostTrustState } from "./useSshHostTrustState";
import * as commands from "../lib/commands";
import type { SshHostTrustState } from "../lib/types";

vi.mock("../lib/commands", () => ({
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

describe("useSshHostTrustState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the endpoint's trust state, including a trusted one", async () => {
    // Unlike the connect path, the trust panel must show that all is well.
    mockCommands.sshHostTrustState.mockResolvedValue(trusted);
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });

    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      2222,
    );
    expect(result.current.state).toEqual(trusted);
  });

  it("defaults the port and ignores a missing host", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", null);
    });
    expect(mockCommands.sshHostTrustState).toHaveBeenCalledWith(
      "db.example.com",
      22,
    );

    vi.clearAllMocks();
    await act(async () => {
      await result.current.check("", 22);
    });
    expect(mockCommands.sshHostTrustState).not.toHaveBeenCalled();
  });

  it("reports a probe failure instead of showing stale trust", async () => {
    mockCommands.sshHostTrustState.mockRejectedValue(
      new Error("ssh handshake: connection refused"),
    );
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });

    expect(result.current.state).toBeNull();
    expect(result.current.error).toMatch(/connection refused/);
  });

  it("re-enrolls a mismatched key with the fingerprint that was presented", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    mockCommands.sshHostTrustReenroll.mockResolvedValue({
      ...trusted,
      fingerprint: "SHA256:rotated",
    });
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let replaced = false;
    await act(async () => {
      replaced = await result.current.reenroll();
    });

    expect(replaced).toBe(true);
    expect(mockCommands.sshHostTrustReenroll).toHaveBeenCalledWith(
      "db.example.com",
      2222,
      { key_type: "ssh-ed25519", fingerprint: "SHA256:rotated" },
    );
    // The new key is now the trusted one: nothing is left pending.
    expect(result.current.state).toMatchObject({
      state: "trusted",
      fingerprint: "SHA256:rotated",
    });
    expect(mockCommands.sshHostTrustEnroll).not.toHaveBeenCalled();
  });

  it("re-enrolls nothing unless the state is a mismatch", async () => {
    const { result } = renderHook(() => useSshHostTrustState());

    // Nothing probed yet.
    let replaced = true;
    await act(async () => {
      replaced = await result.current.reenroll();
    });
    expect(replaced).toBe(false);

    // A trusted endpoint has no stale trust to replace.
    mockCommands.sshHostTrustState.mockResolvedValue(trusted);
    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    await act(async () => {
      replaced = await result.current.reenroll();
    });
    expect(replaced).toBe(false);

    // An unknown endpoint is a first-use acceptance, not a replacement.
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    await act(async () => {
      replaced = await result.current.reenroll();
    });
    expect(replaced).toBe(false);

    expect(mockCommands.sshHostTrustReenroll).not.toHaveBeenCalled();
  });

  it("accepts only an unknown endpoint as first use", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let accepted = true;
    await act(async () => {
      accepted = await result.current.enroll();
    });
    expect(accepted).toBe(false);
    expect(mockCommands.sshHostTrustEnroll).not.toHaveBeenCalled();

    mockCommands.sshHostTrustEnroll.mockResolvedValue(trusted);
    mockCommands.sshHostTrustState.mockResolvedValue(unknown);
    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    await act(async () => {
      accepted = await result.current.enroll();
    });
    expect(accepted).toBe(true);
    expect(mockCommands.sshHostTrustEnroll).toHaveBeenCalledWith(
      "db.example.com",
      2222,
      { key_type: "ssh-ed25519", fingerprint: "SHA256:abc123" },
    );
  });

  it("keeps the mismatch and shows the error when re-enrollment is refused", async () => {
    mockCommands.sshHostTrustState.mockResolvedValue(mismatch);
    mockCommands.sshHostTrustReenroll.mockRejectedValue(
      new Error("the SSH server now offers a different host key"),
    );
    const { result } = renderHook(() => useSshHostTrustState());

    await act(async () => {
      await result.current.check("db.example.com", 2222);
    });
    let replaced = true;
    await act(async () => {
      replaced = await result.current.reenroll();
    });

    expect(replaced).toBe(false);
    expect(result.current.state).toEqual(mismatch);
    expect(result.current.error).toMatch(/different host key/);
  });
});
