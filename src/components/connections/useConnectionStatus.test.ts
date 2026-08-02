import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionStatus } from "./useConnectionStatus";
import * as commands from "../../lib/commands";

describe("useConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle and becomes online with server_version/latency info after a successful check", async () => {
    vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
    vi.spyOn(commands, "testConnection").mockResolvedValue({
      ok: true,
      server_version: "15.2",
      latency_ms: 12,
    } as any);
    const { result } = renderHook(() =>
      useConnectionStatus("c1", () => ({
        name: "P",
        db_type: "postgresql",
        host: "h",
        port: 5432,
        username: "u",
        password: "pw",
      } as any)),
    );
    expect(result.current.state).toBe("idle");
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.state).toBe("online");
    expect(result.current.info).toContain("15.2");
    expect(result.current.info).toContain("12ms");
  });

  it("becomes offline with error info when testConnection fails", async () => {
    vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
    vi.spyOn(commands, "testConnection").mockResolvedValue({
      ok: false,
      error: "timeout",
    } as any);
    const { result } = renderHook(() =>
      useConnectionStatus("c1", () => ({
        name: "P",
        db_type: "postgresql",
        host: "h",
        port: 5432,
        username: "u",
      } as any)),
    );
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.state).toBe("offline");
    expect(result.current.info).toContain("timeout");
  });

  it("debounces: rapid check() calls run one check; a re-check is allowed after 2s", async () => {
    vi.useFakeTimers({ now: 100_000 });
    try {
      const pw = vi.spyOn(commands, "getConnectionPassword").mockResolvedValue("pw");
      vi.spyOn(commands, "testConnection").mockResolvedValue({ ok: true } as any);
      const { result } = renderHook(() =>
        useConnectionStatus("c1", () => ({
          name: "P",
          db_type: "postgresql",
          host: "h",
          port: 5432,
        } as any)),
      );
      await act(async () => {
        const p1 = result.current.check();
        const p2 = result.current.check();
        await Promise.all([p1, p2]);
      });
      expect(pw).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      await act(async () => {
        await result.current.check();
      });
      expect(pw).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});