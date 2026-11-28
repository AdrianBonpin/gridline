import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DISPLAY_SIZE,
  DEFAULT_PAINT_TIMEOUT_MS,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  executeAppimageSmoke,
  parseArgs,
  planAppimageRun,
  readExpectedWindow,
  reexecCommand,
} from "./appimageSmoke.mjs";
import { blankFrame, paintedFrame, toRgbBuffer } from "./appimageTestFrames.mjs";

const APPIMAGE = "/tmp/Gridline_0.8.4_amd64.AppImage";
const LINUX = "linux";

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    argv: ["--appimage", APPIMAGE] as string[],
    platform: LINUX,
    cwd: "/repo/desktop",
    env: { DISPLAY: ":99" } as Record<string, string | undefined>,
    appimageExists: () => true,
    xvfbAvailable: () => true,
    fuseAvailable: () => true,
    expectedWindow: { title: "Gridline", width: 1200, height: 800, tolerance: 48 },
    ...overrides,
  };
}

function renderXwininfo({ id, name, width, height, mapState }) {
  return `xwininfo: Window id: 0x${id.toString(16)} "${name}"

  Absolute upper-left X:  0
  Absolute upper-left Y:  0
  Width: ${width}
  Height: ${height}
  Border width: 0
  Map State: ${mapState}
`;
}

/**
 * A fake X toolchain: `xdotool search` lists the given windows, `xwininfo`
 * describes them, and `import` returns the given RGB frame as `rgb:-`.
 */
function fakeTools({ windows = [], frame = null } = {}) {
  const calls = [];
  const runCommand = (command, args = []) => {
    calls.push([command, ...args]);
    if (command === "xdotool") {
      return { status: 0, stdout: windows.map((window) => `${window.id}\n`).join(""), stderr: "", error: null };
    }
    if (command === "xwininfo") {
      const id = Number(args[1]);
      const window = windows.find((candidate) => candidate.id === id);
      if (!window) return { status: 1, stdout: "", stderr: "no such window", error: null };
      return { status: 0, stdout: renderXwininfo(window), stderr: "", error: null };
    }
    if (command === "import") {
      if (args.includes("rgb:-")) {
        return { status: frame ? 0 : 1, stdout: frame ?? Buffer.alloc(0), stderr: frame ? "" : "capture failed", error: null };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    return { status: 1, stdout: "", stderr: `unexpected command ${command}`, error: null };
  };
  return { runCommand, calls };
}

function windowAt(width = 1200, height = 800, overrides = {}) {
  return { id: 2097155, name: "Gridline", width, height, mapState: "IsViewable", ...overrides };
}

function fakeApp({ log = "", exited = false, exitCode = null } = {}) {
  const state = { stopped: false, launched: null };
  const spawnApp = ({ command, args, env, onOutput }) => {
    state.launched = { command, args, env };
    if (log) onOutput(log);
    return {
      pid: 4242,
      get exited() {
        return exited;
      },
      get exitCode() {
        return exitCode;
      },
      async stop() {
        state.stopped = true;
      },
    };
  };
  return { spawnApp, state };
}

function plan(overrides: Record<string, unknown> = {}) {
  const merged = {
    help: false,
    platform: LINUX,
    appimage: APPIMAGE,
    artifactsDir: "/tmp/artifacts",
    launch: { mode: "direct", args: [], note: "FUSE is available" },
    pristine: false,
    expectedWindow: { title: "Gridline", width: 1200, height: 800, tolerance: 48 },
    timeoutMs: 40,
    paintTimeoutMs: 40,
    intervalMs: 5,
    display: ":99",
    displaySize: DEFAULT_DISPLAY_SIZE,
    reexecUnderXvfb: false,
    ...overrides,
  };
  // The env follows the plan, exactly as `planAppimageRun` derives it, so a test
  // that redirects the artifacts dir redirects the app's state with it.
  return (
    "appEnv" in overrides
      ? merged
      : {
          ...merged,
          appEnv: {
            XDG_DATA_HOME: join(String(merged.artifactsDir), "app-data"),
            HOME: join(String(merged.artifactsDir), "home"),
          },
        }
  );
}

let artifactsDir: string;

beforeEach(() => {
  artifactsDir = mkdtempSync(join(tmpdir(), "gridline-appimage-smoke-"));
});

afterEach(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("defaults to a bounded software-rendered run with no AppImage", () => {
    expect(parseArgs([])).toEqual({
      appimage: null,
      artifacts: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      paintTimeoutMs: DEFAULT_PAINT_TIMEOUT_MS,
      intervalMs: DEFAULT_POLL_MS,
      extractAndRun: false,
      pristine: false,
      help: false,
    });
  });

  it("accepts explicit flags", () => {
    expect(
      parseArgs([
        "--appimage",
        APPIMAGE,
        "--artifacts",
        "/tmp/out",
        "--timeout-ms",
        "5000",
        "--paint-timeout-ms",
        "6000",
        "--interval-ms",
        "100",
        "--extract-and-run",
        "--pristine",
      ]),
    ).toMatchObject({
      appimage: APPIMAGE,
      artifacts: "/tmp/out",
      timeoutMs: 5000,
      paintTimeoutMs: 6000,
      intervalMs: 100,
      extractAndRun: true,
      pristine: true,
    });
  });

  it("rejects unknown flags and non-positive budgets", () => {
    expect(() => parseArgs(["--nope"])).toThrowError(/unknown argument/);
    expect(() => parseArgs(["--timeout-ms", "0"])).toThrowError(/positive integer/);
    expect(() => parseArgs(["--paint-timeout-ms"])).toThrowError(/requires a value/);
  });
});

describe("readExpectedWindow", () => {
  it("follows the packaged app's own window config", () => {
    const expected = readExpectedWindow({
      cwd: "/repo/desktop",
      readFile: () =>
        JSON.stringify({ app: { windows: [{ title: "Gridline", width: 1000, height: 700 }] } }),
    });
    expect(expected).toMatchObject({ title: "Gridline", width: 1000, height: 700 });
  });

  it("falls back to the documented defaults when the config is unreadable", () => {
    expect(
      readExpectedWindow({
        cwd: "/repo/desktop",
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toMatchObject({ title: "Gridline", width: 1200, height: 800 });
  });
});

describe("planAppimageRun", () => {
  it("refuses to run off Linux", () => {
    expect(() => planAppimageRun(baseOptions({ platform: "darwin" }))).toThrowError(
      /only runs on Linux/,
    );
  });

  it("requires a packaged AppImage path", () => {
    expect(() => planAppimageRun(baseOptions({ argv: [] }))).toThrowError(/no AppImage given/);
    expect(() =>
      planAppimageRun(
        baseOptions({ argv: [], env: { DISPLAY: ":99", GRIDLINE_APPIMAGE: APPIMAGE } }),
      ),
    ).not.toThrow();
  });

  it("refuses an inner binary even when it exists", () => {
    expect(() =>
      planAppimageRun(baseOptions({ argv: ["--appimage", "/tmp/squashfs-root/usr/bin/gridline"] })),
    ).toThrowError(/extracted inner binary/);
  });

  it("fails when the AppImage is missing", () => {
    expect(() => planAppimageRun(baseOptions({ appimageExists: () => false }))).toThrowError(
      /AppImage not found/,
    );
  });

  it("launches directly when FUSE is available", () => {
    const planned = planAppimageRun(baseOptions());
    expect(planned.launch).toMatchObject({ mode: "direct", args: [] });
    expect(planned.appimage).toBe(APPIMAGE);
  });

  it("uses the documented extract-and-run path when FUSE is unavailable", () => {
    const planned = planAppimageRun(baseOptions({ fuseAvailable: () => false }));
    expect(planned.launch.mode).toBe("extract-and-run");
    expect(planned.launch.args).toEqual(["--appimage-extract-and-run"]);
  });

  it("keeps the run hermetic: app data and home live in the artifacts dir", () => {
    const planned = planAppimageRun(baseOptions({ cwd: "/repo/desktop" }));
    expect(planned.artifactsDir).toBe("/repo/desktop/e2e-artifacts/appimage");
    expect(planned.appEnv.XDG_DATA_HOME).toBe("/repo/desktop/e2e-artifacts/appimage/app-data");
    expect(planned.appEnv.HOME).toBe("/repo/desktop/e2e-artifacts/appimage/home");
  });

  it("adds the software-rendering flags for the blocking compatibility run", () => {
    const planned = planAppimageRun(baseOptions());
    expect(planned.pristine).toBe(false);
    expect(planned.appEnv.WEBKIT_DISABLE_DMABUF_RENDERER).toBe("1");
    expect(planned.appEnv.LIBGL_ALWAYS_SOFTWARE).toBe("1");
  });

  it("adds no graphics flags at all in the pristine informational run", () => {
    const planned = planAppimageRun(baseOptions({ argv: ["--appimage", APPIMAGE, "--pristine"] }));
    expect(planned.pristine).toBe(true);
    expect(planned.appEnv.WEBKIT_DISABLE_DMABUF_RENDERER).toBeUndefined();
    expect(planned.appEnv.LIBGL_ALWAYS_SOFTWARE).toBeUndefined();
  });

  it("re-executes under xvfb-run when there is no display", () => {
    const planned = planAppimageRun(baseOptions({ env: {} }));
    expect(planned.reexecUnderXvfb).toBe(true);
    expect(planned.display).toBeNull();
  });

  it("fails clearly when there is no display and no xvfb", () => {
    expect(() => planAppimageRun(baseOptions({ env: {}, xvfbAvailable: () => false }))).toThrowError(
      /xvfb-run is not installed/,
    );
  });

  it("honours --help", () => {
    expect(planAppimageRun(baseOptions({ argv: ["--help"] }))).toMatchObject({ help: true });
  });
});

describe("reexecCommand", () => {
  it("bounds the headless screen so the 1200x800 window fits", () => {
    const { command, args } = reexecCommand({
      argv: ["--appimage", APPIMAGE],
      execPath: "/usr/local/bin/bun",
      scriptPath: "/repo/desktop/e2e/appimageSmoke.mjs",
    });
    expect(command).toBe("xvfb-run");
    expect(args).toEqual([
      "-a",
      "-s",
      `-screen 0 ${DEFAULT_DISPLAY_SIZE}`,
      "/usr/local/bin/bun",
      "/repo/desktop/e2e/appimageSmoke.mjs",
      "--appimage",
      APPIMAGE,
    ]);
  });
});

describe("executeAppimageSmoke", () => {
  it("passes a mapped, correctly sized, painted window", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt()], frame: toRgbBuffer(paintedFrame()) });
    const { spawnApp, state } = fakeApp({ log: "Gridline started\n" });
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.outcome.status).toBe("pass");
    // The packaged artifact is what launched — never an inner binary.
    expect(state.launched.command).toBe(APPIMAGE);
    expect(state.launched.args).toEqual([]);
    expect(state.launched.env.XDG_DATA_HOME).toBe(join(artifactsDir, "app-data"));
    expect(state.stopped).toBe(true);
    expect(readFileSync(join(artifactsDir, "summary.txt"), "utf8")).toMatch(/PASS/);
    expect(readFileSync(join(artifactsDir, "launch.log"), "utf8")).toContain("Gridline started");
  });

  it("fails a mapped window whose content never painted", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt()], frame: toRgbBuffer(blankFrame()) });
    const { spawnApp } = fakeApp({ log: "Gridline started\n" });
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("paint");
    const failure = readFileSync(join(artifactsDir, "failure.txt"), "utf8");
    expect(failure).toMatch(/not painted|distinct colour/);
    expect(failure).not.toMatch(/mount/i);
  });

  it("reports a FUSE mount problem separately from rendering", async () => {
    const { runCommand } = fakeTools({ windows: [] });
    const { spawnApp } = fakeApp({
      log: "dlopen(): error loading libfuse.so.2\nAppImages require FUSE to run.\n",
      exited: true,
      exitCode: 1,
    });
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(2);
    expect(result.outcome.status).toBe("mount");
    expect(result.outcome.headline).toMatch(/not a rendering problem/);
    const failure = readFileSync(join(artifactsDir, "failure.txt"), "utf8");
    expect(failure).toMatch(/libfuse missing/);
  });

  it("fails a window that is mapped at the wrong size", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt(640, 480)], frame: toRgbBuffer(paintedFrame()) });
    const { spawnApp } = fakeApp({});
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("geometry");
    expect(result.outcome.details.join("\n")).toMatch(/expected 1200px/);
  });

  it("fails when no window ever appears", async () => {
    const { runCommand } = fakeTools({ windows: [] });
    const { spawnApp } = fakeApp({});
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("window");
    expect(result.outcome.headline).toMatch(/no application window appeared/);
  });

  it("fails a window that exists but is not mapped", async () => {
    const { runCommand } = fakeTools({
      windows: [windowAt(1200, 800, { mapState: "IsUnmapped" })],
    });
    const { spawnApp } = fakeApp({});
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("window");
    expect(result.outcome.headline).toMatch(/not mapped/);
  });

  it("fails on a crashed web process even when the window painted", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt()], frame: toRgbBuffer(paintedFrame()) });
    const { spawnApp } = fakeApp({ log: "WebKitWebProcess crashed with signal 11\n" });
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("fatal");
    expect(result.outcome.details.join("\n")).toMatch(/web process crashed/);
  });

  it("launches through --appimage-extract-and-run when FUSE is unavailable", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt()], frame: toRgbBuffer(paintedFrame()) });
    const { spawnApp, state } = fakeApp({});
    const result = await executeAppimageSmoke(
      plan({
        artifactsDir,
        launch: { mode: "extract-and-run", args: ["--appimage-extract-and-run"], note: "no FUSE" },
      }),
      { runCommand, spawnApp, log: () => {} },
    );

    expect(result.exitCode).toBe(0);
    expect(state.launched.args).toEqual(["--appimage-extract-and-run"]);
  });

  it("fails closed when frames cannot be captured at all", async () => {
    const { runCommand } = fakeTools({ windows: [windowAt()], frame: null });
    const { spawnApp } = fakeApp({});
    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.outcome.status).toBe("paint");
    expect(result.outcome.details.join("\n")).toMatch(/no frame could be captured/);
  });
});

describe("executeAppimageSmoke pristine app data", () => {
  it("removes the app-data and home directories it configures before launch", async () => {
    const appData = join(artifactsDir, "app-data");
    const home = join(artifactsDir, "home");
    mkdirSync(appData, { recursive: true });
    writeFileSync(join(appData, "gridline-demo.sqlite"), "a previous run's demo database");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".cache"), "a previous run's home");

    const { runCommand } = fakeTools({
      windows: [windowAt()],
      frame: toRgbBuffer(paintedFrame()),
    });
    const { spawnApp: spawn, state } = fakeApp({ log: "Gridline started\n" });
    const launchedFrom: Array<{ appData: boolean; home: boolean }> = [];
    const spawnApp = (options) => {
      launchedFrom.push({ appData: existsSync(appData), home: existsSync(home) });
      return spawn(options);
    };

    const result = await executeAppimageSmoke(plan({ artifactsDir }), {
      runCommand,
      spawnApp,
      log: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(state.launched.command).toBe(APPIMAGE);
    expect(launchedFrom).toEqual([{ appData: false, home: false }]);
  });

  it("refuses to launch when a configured location escapes the artifacts directory", async () => {
    const outside = join(mkdtempSync(join(tmpdir(), "gridline-appimage-outside-")), "app-data");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.sqlite"), "not the harness's to delete");

    const { runCommand } = fakeTools({ windows: [windowAt()], frame: toRgbBuffer(paintedFrame()) });
    const spawnApp = vi.fn(() => fakeApp({}).spawnApp);
    const result = await executeAppimageSmoke(
      plan({ artifactsDir, appEnv: { XDG_DATA_HOME: outside } }),
      { runCommand, spawnApp, log: () => {} },
    );

    expect(result.exitCode).toBe(1);
    expect(spawnApp).not.toHaveBeenCalled();
    expect(readFileSync(join(outside, "keep.sqlite"), "utf8")).toBe(
      "not the harness's to delete",
    );
    expect(readFileSync(join(artifactsDir, "failure.txt"), "utf8")).toMatch(
      /does not resolve beneath the artifacts directory/,
    );
    rmSync(join(outside, ".."), { recursive: true, force: true });
  });
});
