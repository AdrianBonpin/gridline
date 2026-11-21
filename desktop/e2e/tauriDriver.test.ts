import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import { buildCapabilities, buildDriverCommand, startTauriDriver } from "./tauriDriver.mjs";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signals: Array<string | number | undefined> = [];
  kill(signal?: string | number) {
    this.signals.push(signal);
    // Microtask, not macrotask: the readiness/sleep loop is fully async and
    // would otherwise starve the immediate queue.
    Promise.resolve().then(() => {
      this.exitCode = 0;
      this.emit("exit", 0, signal);
    });
    return true;
  }
  exit(code = 0, signal: string | null = null) {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }
}

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

describe("buildCapabilities", () => {
  it("wraps the binary in tauri:options", () => {
    expect(buildCapabilities({ application: "/opt/gridline/gridline" })).toEqual({
      alwaysMatch: { "tauri:options": { application: "/opt/gridline/gridline", args: [] } },
    });
  });

  it("refuses to build capabilities without an application", () => {
    expect(() => buildCapabilities({ application: "" })).toThrow(/application/);
  });

  it("passes app arguments through", () => {
    expect(buildCapabilities({ application: "/a", args: ["--flag"] })).toEqual({
      alwaysMatch: { "tauri:options": { application: "/a", args: ["--flag"] } },
    });
  });
});

describe("buildDriverCommand", () => {
  it("maps both ports onto tauri-driver flags", () => {
    expect(buildDriverCommand({ port: 4444, nativePort: 4445 })).toEqual({
      command: "tauri-driver",
      args: ["--port", "4444", "--native-port", "4445"],
    });
  });
});

describe("startTauriDriver", () => {
  it("spawns tauri-driver, streams its output and waits for readiness", async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);
    const log: string[] = [];
    const clock = fakeClock();
    let probes = 0;
    const fetchImpl = vi.fn(async () => {
      probes += 1;
      return { ok: probes >= 3, status: probes >= 3 ? 200 : 500 };
    });

    const driver = await startTauriDriver({
      port: 4444,
      nativePort: 4445,
      baseUrl: "http://127.0.0.1:4444",
      spawnImpl: spawnImpl as never,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logSink: (chunk: string) => log.push(chunk),
      sleep: clock.sleep,
      now: clock.now,
    });

    child.stderr.emit("data", "tauri-driver: starting WebKitWebDriver\n");
    expect(spawnImpl).toHaveBeenCalledWith(
      "tauri-driver",
      ["--port", "4444", "--native-port", "4445"],
      expect.objectContaining({ env: expect.objectContaining({}) }),
    );
    expect(log.join("")).toContain("starting WebKitWebDriver");
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:4444/status");
    expect(driver.output()).toContain("starting WebKitWebDriver");

    await driver.stop();
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("fails fast with the captured output when tauri-driver refuses to run", async () => {
    const child = new FakeChild();
    const clock = fakeClock();
    const spawnImpl = vi.fn(() => {
      Promise.resolve().then(() => {
        child.stderr.emit("data", "tauri-driver is not supported on this platform\n");
        child.exit(1);
      });
      return child;
    });

    const failure = startTauriDriver({
      port: 4444,
      nativePort: 4445,
      baseUrl: "http://127.0.0.1:4444",
      spawnImpl: spawnImpl as never,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 5_000,
    });

    await expect(failure).rejects.toBeInstanceOf(HarnessError);
    await expect(failure).rejects.toThrow(/exited before it was ready/);
    await expect(failure).rejects.toThrow(/not supported on this platform/);
  });

  it("fails with the log tail when the driver never answers", async () => {
    const child = new FakeChild();
    const clock = fakeClock();
    const spawnImpl = vi.fn(() => {
      Promise.resolve().then(() =>
        child.stderr.emit("data", "waiting for WebKitWebDriver\n"),
      );
      return child;
    });

    const failure = startTauriDriver({
      port: 4444,
      nativePort: 4445,
      baseUrl: "http://127.0.0.1:4444",
      spawnImpl: spawnImpl as never,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
      sleep: clock.sleep,
      now: clock.now,
      timeoutMs: 500,
    });

    await expect(failure).rejects.toThrow(/did not become ready within 500ms/);
    await expect(failure).rejects.toThrow(/waiting for WebKitWebDriver/);
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("tolerates stopping a driver that already exited", async () => {
    const child = new FakeChild();
    const clock = fakeClock();
    const driver = await startTauriDriver({
      port: 4444,
      nativePort: 4445,
      baseUrl: "http://127.0.0.1:4444",
      spawnImpl: (() => child) as never,
      fetchImpl: (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch,
      sleep: clock.sleep,
      now: clock.now,
    });
    child.exit(0);
    await driver.stop();
    expect(child.signals).toEqual([]);
  });
});
