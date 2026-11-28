import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunArtifacts } from "./artifacts.mjs";
import { HarnessError, errorMessage } from "./errors.mjs";
import { executeRun, main, reexecCommand } from "./run.mjs";

const tempDirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridline-e2e-run-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function plan(overrides: Record<string, unknown> = {}) {
  return {
    help: false,
    platform: "linux",
    binary: "/repo/desktop/src-tauri/target/release/gridline",
    artifactsDir: "/repo/desktop/e2e-artifacts",
    flow: "demo-smoke",
    timeoutMs: 1_000,
    intervalMs: 50,
    port: 4444,
    nativePort: 4445,
    baseUrl: "http://127.0.0.1:4444",
    display: ":99",
    reexecUnderXvfb: false,
    driverEnv: { XDG_DATA_HOME: "/repo/desktop/e2e-artifacts/app-data" },
    ...overrides,
  };
}

function fakeArtifacts() {
  return {
    dir: "/repo/desktop/e2e-artifacts",
    launchLogPath: "/repo/desktop/e2e-artifacts/launch.log",
    appended: [] as string[],
    summary: null as string[] | null,
    appendLaunchLog(chunk: string) {
      this.appended.push(chunk);
    },
    writeSummary(lines: string[]) {
      this.summary = lines;
    },
    captureFailure: vi.fn(async () => ({ failurePath: "/repo/desktop/e2e-artifacts/failure.txt" })),
  };
}

function fakeDriver() {
  return {
    baseUrl: "http://127.0.0.1:4444",
    output: () => "",
    stop: vi.fn(async () => {}),
  };
}

function fakeClient() {
  return {
    sessionId: null as string | null,
    createSession: vi.fn(async () => {
      return "session-1";
    }),
    deleteSession: vi.fn(async () => {}),
    findElement: vi.fn(async () => null),
    findElements: vi.fn(async () => []),
    getAttribute: vi.fn(async () => null),
    click: vi.fn(async () => {}),
    elementText: vi.fn(async () => ""),
    screenshot: vi.fn(async () => "iVBORw0KGgo="),
    pageSource: vi.fn(async () => "<html></html>"),
  };
}

describe("executeRun", () => {
  it("drives the built binary, records the steps and passes", async () => {
    const artifacts = fakeArtifacts();
    const driver = fakeDriver();
    const client = fakeClient();
    const flow = vi.fn(async () => ({
      steps: [
        { name: "home: Gridline Demo (SQLite) card visible", durationMs: 5 },
        { name: "grid: seeded products rows visible", durationMs: 7 },
      ],
      renderedCells: ["GL-MSE-001", "Gridline Wireless Mouse", "GL-KBD-001"],
      matchedCells: ["GL-MSE-001", "Gridline Wireless Mouse"],
    }));
    const log: string[] = [];

    const result = await executeRun(plan(), {
      createArtifacts: () => artifacts,
      spawnDriver: async () => driver,
      clientFor: () => client,
      flows: { "demo-smoke": flow },
      log: (line: string) => log.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(client.createSession).toHaveBeenCalledWith({
      alwaysMatch: {
        "tauri:options": {
          application: "/repo/desktop/src-tauri/target/release/gridline",
          args: [],
        },
      },
    });
    expect(flow).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ timeoutMs: 1_000, intervalMs: 50 }),
    );
    expect(artifacts.summary).toEqual([
      "home: Gridline Demo (SQLite) card visible (5ms)",
      "grid: seeded products rows visible (7ms)",
      'grid observed 3 rendered cell(s), e.g. "GL-MSE-001", "Gridline Wireless Mouse", "GL-KBD-001"',
      'fixture values rendered in the grid: "GL-MSE-001", "Gridline Wireless Mouse"',
      "PASS",
    ]);
    expect(log.join("\n")).toContain("PASS");
    // The pass line states what the grid showed, so a log is evidence on its own.
    expect(log.join("\n")).toContain(
      'fixture values rendered in the grid: "GL-MSE-001", "Gridline Wireless Mouse"',
    );
    expect(artifacts.captureFailure).not.toHaveBeenCalled();
    expect(client.deleteSession).toHaveBeenCalled();
    expect(driver.stop).toHaveBeenCalled();
  });

  it("prints a flow's own evidence and pass message", async () => {
    const artifacts = fakeArtifacts();
    const driver = fakeDriver();
    const client = fakeClient();
    const log: string[] = [];

    const result = await executeRun(plan({ flow: "destructive-rerun" }), {
      createArtifacts: () => artifacts,
      spawnDriver: async () => driver,
      clientFor: () => client,
      flows: {
        "destructive-rerun": async () => ({
          steps: [{ name: "rerun: toolbar re-run requires confirmation again", durationMs: 4 }],
          confirmedEntryPoints: ["initial Run", "toolbar re-run"],
          evidence: ['confirmed from: "initial Run", "toolbar re-run"'],
          passMessage: "both execution entry points required confirmation",
        }),
      },
      log: (line: string) => log.push(line),
    });

    expect(result.exitCode).toBe(0);
    expect(log).toContain('e2e: confirmed from: "initial Run", "toolbar re-run"');
    expect(log).toContain("e2e: PASS both execution entry points required confirmation");
    expect(artifacts.summary).toEqual([
      "rerun: toolbar re-run requires confirmation again (4ms)",
      'confirmed from: "initial Run", "toolbar re-run"',
      "PASS",
    ]);
  });

  it("captures artifacts, stops the driver and fails when the flow fails", async () => {
    const artifacts = fakeArtifacts();
    const driver = fakeDriver();
    driver.stop.mockRejectedValueOnce(new Error("already gone"));
    const client = fakeClient();
    const failure = new HarnessError('grid never showed "GL-MSE-001"');
    failure.steps = [{ name: "explorer: open products", durationMs: 3 }];
    const log: string[] = [];

    const result = await executeRun(plan(), {
      createArtifacts: () => artifacts,
      spawnDriver: async () => driver,
      clientFor: () => client,
      flows: {
        "demo-smoke": async () => {
          throw failure;
        },
      },
      log: (line: string) => log.push(line),
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toBe(failure);
    expect(artifacts.captureFailure).toHaveBeenCalledWith(
      expect.objectContaining({ error: failure, client, display: ":99" }),
    );
    expect(client.deleteSession).toHaveBeenCalled();
    expect(driver.stop).toHaveBeenCalled();
    expect(log.join("\n")).toMatch(/FAIL.*grid never showed/);
  });

  it("fails with artifacts when the session cannot be created", async () => {
    const artifacts = fakeArtifacts();
    const driver = fakeDriver();
    const client = fakeClient();
    client.createSession.mockRejectedValueOnce(
      new Error("failed to start browser: no such file"),
    );
    const log: string[] = [];

    const result = await executeRun(plan(), {
      createArtifacts: () => artifacts,
      spawnDriver: async () => driver,
      clientFor: () => client,
      flows: { "demo-smoke": vi.fn() },
      log: (line: string) => log.push(line),
    });

    expect(result.exitCode).toBe(1);
    await expect(Promise.resolve(result.error)).resolves.toBeInstanceOf(Error);
    expect(artifacts.captureFailure).toHaveBeenCalledWith(
      expect.objectContaining({ client }),
    );
    expect(driver.stop).toHaveBeenCalled();
  });

  it("fails without a driver when tauri-driver never starts", async () => {
    const artifacts = fakeArtifacts();

    const result = await executeRun(plan(), {
      createArtifacts: () => artifacts,
      spawnDriver: async () => {
        throw new HarnessError("tauri-driver exited before it was ready");
      },
      clientFor: () => fakeClient(),
      flows: { "demo-smoke": vi.fn() },
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(artifacts.captureFailure).toHaveBeenCalledWith(
      expect.objectContaining({ client: null }),
    );
  });
});

describe("executeRun pristine app data", () => {
  it("starts every run into the same artifacts directory from a pristine app-data directory", async () => {
    const artifactsDir = tempDir();
    const appData = join(artifactsDir, "app-data");
    const inherited: boolean[] = [];
    const spawnDriver = async () => {
      inherited.push(existsSync(appData));
      return fakeDriver();
    };
    // What the real app does on launch: seed the demo database and local store.
    const flow = async () => {
      mkdirSync(appData, { recursive: true });
      writeFileSync(join(appData, "gridline-demo.sqlite"), "seeded by the app");
      return { steps: [{ name: "home: demo card visible", durationMs: 1 }] };
    };
    const runPlan = plan({ artifactsDir, driverEnv: { XDG_DATA_HOME: appData } });
    const dependencies = {
      spawnDriver,
      clientFor: () => fakeClient(),
      flows: { "demo-smoke": flow },
      log: () => {},
    };

    for (let run = 0; run < 2; run += 1) {
      const result = await executeRun(runPlan, dependencies);
      expect(result.exitCode).toBe(0);
      // The app's own state remains after the run, as evidence...
      expect(readFileSync(join(appData, "gridline-demo.sqlite"), "utf8")).toBe(
        "seeded by the app",
      );
      // ...and a leftover from it is not what the next run starts from.
      writeFileSync(join(appData, "leftover-from-a-killed-run.sqlite"), "stale");
    }

    // Neither launch saw an app-data directory at all.
    expect(inherited).toEqual([false, false]);
  });

  it("refuses to launch when a configured location escapes the artifacts directory", async () => {
    const artifactsDir = tempDir();
    const outside = join(tempDir(), "app-data");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.sqlite"), "not the harness's to delete");
    const spawnDriver = vi.fn(async () => fakeDriver());

    const result = await executeRun(
      plan({ artifactsDir, driverEnv: { XDG_DATA_HOME: outside } }),
      {
        createArtifacts: ({ dir }: { dir: string }) =>
          createRunArtifacts({ dir, spawnSyncImpl: (() => ({ status: 1 })) as never }),
        spawnDriver,
        clientFor: () => fakeClient(),
        flows: { "demo-smoke": vi.fn() },
        log: () => {},
      },
    );

    expect(result.exitCode).toBe(1);
    expect(errorMessage(result.error)).toMatch(/does not resolve beneath the artifacts directory/);
    expect(spawnDriver).not.toHaveBeenCalled();
    expect(readFileSync(join(outside, "keep.sqlite"), "utf8")).toBe(
      "not the harness's to delete",
    );
    // The refusal is reported like any other harness failure, not swallowed.
    expect(readFileSync(join(artifactsDir, "failure.txt"), "utf8")).toMatch(
      /does not resolve beneath the artifacts directory/,
    );
  });
});

describe("main --list-flows", () => {
  it("prints the registry one flow per line and runs nothing", async () => {
    const lines: string[] = [];
    const execute = vi.fn();
    const code = await main({
      argv: ["--list-flows"],
      cwd: "/repo/desktop",
      env: {},
      platform: "darwin",
      execute,
      log: (line: string) => lines.push(line),
    });
    // No driver, no binary, no display: CI asks this before it builds anything.
    expect(execute).not.toHaveBeenCalled();
    expect(code).toBe(0);
    expect(lines).toEqual(["demo-smoke", "destructive-rerun", "composite-edit", "sqlite-rebuild"]);
  });
});

describe("reexecCommand", () => {
  it("re-runs the harness under xvfb-run", () => {
    expect(
      reexecCommand({
        argv: ["--timeout-ms", "1000"],
        execPath: "/usr/local/bin/bun",
        scriptPath: "/repo/desktop/e2e/run.mjs",
      }),
    ).toEqual({
      command: "xvfb-run",
      args: ["-a", "/usr/local/bin/bun", "/repo/desktop/e2e/run.mjs", "--timeout-ms", "1000"],
    });
  });
});
