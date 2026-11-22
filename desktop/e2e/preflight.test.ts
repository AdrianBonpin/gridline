import { describe, expect, it } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  DEFAULT_FLOW,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  FLOWS,
  defaultBinaryPath,
  defaultArtifactsDir,
  parseArgs,
  planRun,
} from "./preflight.mjs";

const LINUX = "linux";
const MACOS = "darwin";

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    argv: [] as string[],
    platform: LINUX,
    cwd: "/repo/desktop",
    env: { DISPLAY: ":99" } as Record<string, string | undefined>,
    binaryExists: () => true,
    xvfbRunAvailable: () => true,
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("defaults to the demo smoke flow, port 4444 and the standard artifacts dir", () => {
    expect(parseArgs([])).toEqual({
      binary: null,
      artifacts: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      intervalMs: 250,
      port: DEFAULT_PORT,
      nativePort: DEFAULT_PORT + 1,
      flow: DEFAULT_FLOW,
      listFlows: false,
      help: false,
    });
  });

  it("accepts explicit overrides", () => {
    const args = parseArgs([
      "--binary",
      "/tmp/gridline",
      "--artifacts",
      "/tmp/art",
      "--timeout-ms",
      "5000",
      "--port",
      "5555",
      "--native-port",
      "5556",
      "--flow",
      "demo-smoke",
    ]);
    expect(args).toMatchObject({
      binary: "/tmp/gridline",
      artifacts: "/tmp/art",
      timeoutMs: 5_000,
      port: 5_555,
      nativePort: 5_556,
      flow: "demo-smoke",
    });
  });

  it("rejects unknown flags with the usage text", () => {
    expect(() => parseArgs(["--nope"])).toThrow(HarnessError);
    expect(() => parseArgs(["--nope"])).toThrow(/--binary/);
  });

  it("rejects a non-numeric timeout", () => {
    expect(() => parseArgs(["--timeout-ms", "soon"])).toThrow(/--timeout-ms/);
  });
});

describe("planRun", () => {
  it("fails on macOS with the supported path spelled out", () => {
    // tauri-driver itself refuses to run here: macOS has no WKWebView driver.
    expect(() => planRun(baseOptions({ platform: MACOS }))).toThrow(HarnessError);
    expect(() => planRun(baseOptions({ platform: MACOS }))).toThrow(/macOS/);
    expect(() => planRun(baseOptions({ platform: MACOS }))).toThrow(/tauri-driver/);
    expect(() => planRun(baseOptions({ platform: MACOS }))).toThrow(/Linux/);
  });

  it("fails when the binary was never built, naming the build command", () => {
    const plan = () =>
      planRun(baseOptions({ binaryExists: () => false }));
    expect(plan).toThrow(/desktop binary not found/);
    expect(plan).toThrow(/tauri build --no-bundle/);
  });

  it("resolves the release binary and artifacts directory for a Linux run", () => {
    const plan = planRun(baseOptions());
    expect(plan.binary).toBe("/repo/desktop/src-tauri/target/release/gridline");
    expect(plan.artifactsDir).toBe("/repo/desktop/e2e-artifacts");
    expect(plan.flow).toBe(DEFAULT_FLOW);
    expect(plan.display).toBe(":99");
    expect(plan.reexecUnderXvfb).toBe(false);
    expect(plan.baseUrl).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
  });

  it("isolates app data per run and disables the dma-buf renderer on Linux", () => {
    // A pristine XDG_DATA_HOME means the seeded demo database is created by the
    // app itself on every run, and a failure leaves that state as evidence.
    const plan = planRun(baseOptions());
    expect(plan.driverEnv).toEqual({
      XDG_DATA_HOME: "/repo/desktop/e2e-artifacts/app-data",
      WEBKIT_DISABLE_DMABUF_RENDERER: "1",
    });

    const overridden = planRun(
      baseOptions({ env: { DISPLAY: ":99", WEBKIT_DISABLE_DMABUF_RENDERER: "0" } }),
    );
    expect(overridden.driverEnv.WEBKIT_DISABLE_DMABUF_RENDERER).toBe("0");
  });

  it("keeps Windows app data inside the artifacts directory too", () => {
    const plan = planRun(
      baseOptions({ platform: "win32", env: {}, binaryExists: () => true }),
    );
    expect(plan.driverEnv).toEqual({
      APPDATA: "/repo/desktop/e2e-artifacts/app-data",
    });
  });

  it("uses the .exe suffix on Windows", () => {
    const plan = planRun(
      baseOptions({ platform: "win32", env: {}, binaryExists: () => true }),
    );
    expect(plan.binary.endsWith("gridline.exe")).toBe(true);
    expect(plan.reexecUnderXvfb).toBe(false);
  });

  it("wraps itself in xvfb-run when there is no display but Xvfb is installed", () => {
    const plan = planRun(baseOptions({ env: {}, xvfbRunAvailable: () => true }));
    expect(plan.reexecUnderXvfb).toBe(true);
  });

  it("fails with a headless-display instruction when neither is available", () => {
    const plan = () => planRun(baseOptions({ env: {}, xvfbRunAvailable: () => false }));
    expect(plan).toThrow(/DISPLAY/);
    expect(plan).toThrow(/xvfb/);
  });

  it("rejects an unknown flow", () => {
    expect(() => planRun(baseOptions({ argv: ["--flow", "everything"] }))).toThrow(
      /unknown flow/,
    );
    expect(Object.keys(FLOWS)).toContain(DEFAULT_FLOW);
  });

  it("prefers an explicit --binary over the default location", () => {
    const plan = planRun(baseOptions({ argv: ["--binary", "/opt/gridline/gridline"] }));
    expect(plan.binary).toBe("/opt/gridline/gridline");
  });

  it("honours GRIDLINE_E2E_BINARY from the environment", () => {
    const plan = planRun(
      baseOptions({ env: { DISPLAY: ":0", GRIDLINE_E2E_BINARY: "/ci/gridline" } }),
    );
    expect(plan.binary).toBe("/ci/gridline");
  });

  it("returns help instead of a plan when --help is passed", () => {
    const plan = planRun(baseOptions({ argv: ["--help"] }));
    expect(plan.help).toBe(true);
    expect(plan.usage).toContain("usage: bun run e2e");
    expect(plan.usage).toContain("demo-smoke");
  });

  it("lists the registered flows instead of planning a run", () => {
    // CI learns which flows exist from this command, so a newly registered flow
    // cannot be left out of the lane by a hand-maintained list.
    const plan = planRun(baseOptions({ argv: ["--list-flows"] }));
    expect(plan).toEqual({ listFlows: true, flows: Object.keys(FLOWS) });
    expect(plan.flows).toContain("sqlite-rebuild");
    // Listing works everywhere: no display, no binary, no Linux requirement.
    expect(
      planRun(
        baseOptions({
          argv: ["--list-flows"],
          platform: MACOS,
          env: {},
          binaryExists: () => false,
        }),
      ),
    ).toEqual({ listFlows: true, flows: Object.keys(FLOWS) });
    expect(parseArgs(["--list-flows"]).listFlows).toBe(true);
    expect(parseArgs([]).listFlows).toBe(false);
  });

  it("keeps default path helpers platform-aware", () => {
    expect(defaultBinaryPath({ platform: "linux", cwd: "/x" })).toBe(
      "/x/src-tauri/target/release/gridline",
    );
    expect(defaultBinaryPath({ platform: "win32", cwd: "/x" })).toBe(
      "/x/src-tauri/target/release/gridline.exe",
    );
    expect(defaultArtifactsDir({ cwd: "/x" })).toBe("/x/e2e-artifacts");
  });
});
