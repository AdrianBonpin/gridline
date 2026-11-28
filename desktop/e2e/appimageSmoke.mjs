#!/usr/bin/env bun
/**
 * Packaged AppImage startup and paint smoke.
 *
 * Distinct from the WebDriver harness in this folder (`run.mjs`): a packaged
 * AppImage is not a WebDriver target, so this lane launches the real
 * `Gridline_*.AppImage` through its normal launcher (`./Gridline_*.AppImage`,
 * or AppImage's documented `--appimage-extract-and-run` path on hosts without
 * FUSE), waits for a mapped window at the configured size, samples the frame
 * and requires painted content, and fails on known-fatal renderer/web-process
 * diagnostics. A FUSE/container mount problem is reported separately from a
 * rendering problem.
 *
 * Coverage note (do not reword into a fix claim): this lane can never close
 * https://github.com/AdrianBonpin/gridline/issues/62. It sees a headless
 * software-rendered X display, not the reporter's Fedora session, compositor,
 * GPU or driver. A green Fedora run is cross-distribution compatibility
 * coverage only.
 */
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EXPECTED_WINDOW,
  DEFAULT_SIZE_TOLERANCE,
  analyseFrame,
  assertPackagedLauncher,
  classifyDiagnostics,
  classifyOutcome,
  decideLaunchMode,
  describeFrame,
  exitCodeForOutcome,
  judgePaint,
  outcomeLabel,
} from "./appimageAnalysis.mjs";
import {
  describeWindow,
  judgeWindowSize,
  parseXdotoolSearchIds,
  parseXwininfo,
  selectWindow,
} from "./appimageWindow.mjs";
import { removeHarnessState } from "./artifacts.mjs";
import { HarnessError, errorMessage } from "./errors.mjs";

export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_PAINT_TIMEOUT_MS = 30_000;
export const DEFAULT_POLL_MS = 500;
/** Generous Xvfb screen: the app window is 1200x800, so leave headroom. */
export const DEFAULT_DISPLAY_SIZE = "1440x900x24";
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
/** Per-command budget for the X tools; a hung capture fails instead of wedging. */
const COMMAND_TIMEOUT_MS = 20_000;

const USAGE = `usage: bun run e2e:appimage --appimage <path> [options]

Launches the packaged Gridline AppImage through its normal launcher on a
headless X display and asserts a mapped, painted window at the configured size.

options:
  --appimage <path>        the packaged .AppImage to launch (or GRIDLINE_APPIMAGE)
  --artifacts <dir>        where logs/screenshots are written (default: e2e-artifacts/appimage)
  --timeout-ms <ms>        budget for the window to appear (default: ${DEFAULT_TIMEOUT_MS})
  --paint-timeout-ms <ms>  extra budget for the window to paint (default: ${DEFAULT_PAINT_TIMEOUT_MS})
  --interval-ms <ms>       poll interval (default: ${DEFAULT_POLL_MS})
  --extract-and-run        force AppImage's --appimage-extract-and-run path
  --pristine               launch with no graphics environment flags (informational lane)
  -h, --help               show this help

environment:
  DISPLAY                  existing X display to use; when unset the smoke
                           re-executes itself under xvfb-run
  GRIDLINE_APPIMAGE        alternative to --appimage

exit codes: 0 = painted window, 1 = window/geometry/paint/fatal failure,
            2 = the AppImage could not mount (FUSE/container; not a rendering
            problem)
`;

export function usageText() {
  return USAGE;
}

function positiveInteger(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HarnessError(`${flag} must be a positive integer, got ${JSON.stringify(value)}\n\n${USAGE}`);
  }
  return parsed;
}

/** Parse the smoke's CLI flags; unknown or malformed input fails with usage. */
export function parseArgs(argv) {
  const args = {
    appimage: null,
    artifacts: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    paintTimeoutMs: DEFAULT_PAINT_TIMEOUT_MS,
    intervalMs: DEFAULT_POLL_MS,
    extractAndRun: false,
    pristine: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new HarnessError(`${flag} requires a value\n\n${USAGE}`);
      index += 1;
      return value;
    };
    switch (flag) {
      case "--appimage":
        args.appimage = nextValue();
        break;
      case "--artifacts":
        args.artifacts = nextValue();
        break;
      case "--timeout-ms":
        args.timeoutMs = positiveInteger(flag, nextValue());
        break;
      case "--paint-timeout-ms":
        args.paintTimeoutMs = positiveInteger(flag, nextValue());
        break;
      case "--interval-ms":
        args.intervalMs = positiveInteger(flag, nextValue());
        break;
      case "--extract-and-run":
        args.extractAndRun = true;
        break;
      case "--pristine":
        args.pristine = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new HarnessError(`unknown argument ${JSON.stringify(flag)}\n\n${USAGE}`);
    }
  }

  return args;
}

/**
 * Window expectations come from the packaged app's own config, so the
 * assertion follows `tauri.conf.json` instead of a hard-coded copy.
 */
export function readExpectedWindow({ cwd, readFile = readFileSync } = {}) {
  const confPath = join(cwd ?? process.cwd(), "src-tauri", "tauri.conf.json");
  try {
    const conf = JSON.parse(String(readFile(confPath, "utf8")));
    const window = conf?.app?.windows?.[0] ?? {};
    return {
      title: typeof window.title === "string" && window.title ? window.title : DEFAULT_EXPECTED_WINDOW.title,
      width: Number.isInteger(window.width) ? window.width : DEFAULT_EXPECTED_WINDOW.width,
      height: Number.isInteger(window.height) ? window.height : DEFAULT_EXPECTED_WINDOW.height,
      tolerance: DEFAULT_SIZE_TOLERANCE,
    };
  } catch {
    return { ...DEFAULT_EXPECTED_WINDOW, tolerance: DEFAULT_SIZE_TOLERANCE };
  }
}

function commandExists(command) {
  const probe = nodeSpawnSync("which", [command], { stdio: "ignore" });
  return probe?.status === 0;
}

/** FUSE availability decides the documented launch path, never the assertion. */
export function detectFuseAvailable({ fileExists = existsSync, hasCommand = commandExists } = {}) {
  if (!fileExists("/dev/fuse")) return false;
  return hasCommand("fusermount") || hasCommand("fusermount3");
}

/**
 * Decide everything before touching the app. Pure apart from cheap existence
 * probes, so the whole contract is unit tested without a display or a package.
 */
export function planAppimageRun({
  argv = [],
  platform = process.platform,
  cwd = process.cwd(),
  env = process.env,
  appimageExists = existsSync,
  xvfbAvailable = () => commandExists("xvfb-run"),
  fuseAvailable = () => detectFuseAvailable(),
  expectedWindow = readExpectedWindow({ cwd }),
} = {}) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, usage: USAGE };

  if (platform !== "linux") {
    throw new HarnessError(
      `the packaged AppImage smoke only runs on Linux (the artifact is a Linux AppImage); ` +
        `this host is ${platform}. Run it on the release/scheduled Linux lane.`,
    );
  }

  if (!args.appimage && !env.GRIDLINE_APPIMAGE) {
    throw new HarnessError(`no AppImage given: pass --appimage <path> or set GRIDLINE_APPIMAGE\n\n${USAGE}`);
  }
  const appimage = resolve(cwd, args.appimage ?? env.GRIDLINE_APPIMAGE);
  assertPackagedLauncher(appimage);
  if (!appimageExists(appimage)) {
    throw new HarnessError(`AppImage not found at ${appimage}`);
  }

  const launch = decideLaunchMode({
    fuseAvailable: fuseAvailable(),
    forceExtractAndRun: args.extractAndRun,
  });

  const artifactsDir = resolve(cwd, args.artifacts ?? join("e2e-artifacts", "appimage"));

  // A pristine run adds no graphics flags at all (informational: it is what a
  // default user session looks like). The default run is the bounded
  // software-rendered compatibility run: a CI runner has no GPU, and WebKitGTK
  // otherwise paints nothing under Xvfb. Both are harness-only environment
  // variables — nothing is baked into the package.
  const appEnv = {
    XDG_DATA_HOME: join(artifactsDir, "app-data"),
    HOME: join(artifactsDir, "home"),
    NO_AT_BRIDGE: "1",
  };
  if (!args.pristine) {
    appEnv.WEBKIT_DISABLE_DMABUF_RENDERER = env.WEBKIT_DISABLE_DMABUF_RENDERER ?? "1";
    appEnv.LIBGL_ALWAYS_SOFTWARE = env.LIBGL_ALWAYS_SOFTWARE ?? "1";
    appEnv.GDK_BACKEND = env.GDK_BACKEND ?? "x11";
  }

  const display = env.DISPLAY ?? null;
  let reexecUnderXvfb = false;
  if (!display) {
    if (!xvfbAvailable()) {
      throw new HarnessError(
        "no display to launch the AppImage on: DISPLAY is unset and xvfb-run is not " +
          "installed. Install xvfb (`apt-get install -y xvfb`) or set DISPLAY.",
      );
    }
    reexecUnderXvfb = true;
  }

  return {
    help: false,
    platform,
    appimage,
    artifactsDir,
    launch,
    pristine: args.pristine,
    expectedWindow,
    timeoutMs: args.timeoutMs,
    paintTimeoutMs: args.paintTimeoutMs,
    intervalMs: args.intervalMs,
    display,
    displaySize: env.GRIDLINE_SMOKE_DISPLAY_SIZE ?? DEFAULT_DISPLAY_SIZE,
    reexecUnderXvfb,
    appEnv,
  };
}

export function reexecCommand({ argv, execPath, scriptPath, displaySize = DEFAULT_DISPLAY_SIZE }) {
  return {
    command: "xvfb-run",
    args: ["-a", "-s", `-screen 0 ${displaySize}`, execPath, scriptPath, ...argv],
  };
}

/** Run artifacts for the smoke: launch log always, summary/failure/screenshot after. */
export function createSmokeArtifacts({ dir, now = () => new Date() }) {
  mkdirSync(dir, { recursive: true });
  const launchLogPath = join(dir, "launch.log");
  appendFileSync(launchLogPath, "");
  let logText = "";

  return {
    dir,
    launchLogPath,
    screenshotPath: join(dir, "window.png"),
    get logText() {
      return logText;
    },
    appendLaunchLog(chunk) {
      const text = String(chunk);
      logText += text;
      appendFileSync(launchLogPath, text);
    },
    writeSummary(lines) {
      const body = Array.isArray(lines) ? lines : [String(lines)];
      writeFileSync(join(dir, "summary.txt"), `${body.join("\n")}\n`);
    },
    writeFailure(lines) {
      const body = [ `Gridline AppImage smoke failure`, `time: ${now().toISOString()}`, ...lines ];
      writeFileSync(join(dir, "failure.txt"), `${body.join("\n")}\n`);
    },
  };
}

export function defaultRunCommand(command, args = [], options = {}) {
  const result = nodeSpawnSync(command, args, {
    maxBuffer: MAX_CAPTURE_BYTES,
    // Bounded: `import`/`xdotool` fall back to interactive behaviour on a bad
    // argument, and a smoke must fail with a reason instead of wedging the job.
    timeout: COMMAND_TIMEOUT_MS,
    ...options,
  });
  return {
    command,
    status: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    error: result.error ?? null,
  };
}

function textOf(result) {
  const stdout = result?.stdout;
  if (stdout === undefined || stdout === null) return "";
  return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
}

function errorTextOf(result) {
  const stderr = result?.stderr;
  const text = stderr === undefined || stderr === null
    ? ""
    : Buffer.isBuffer(stderr)
      ? stderr.toString("utf8")
      : String(stderr);
  return text.trim() || errorMessage(result?.error ?? `exit ${result?.status}`);
}

/**
 * Launch the AppImage. `detached` puts the app and its WebKit children in one
 * process group so the smoke can shut the whole tree down instead of leaking a
 * renderer process into the next run.
 */
export function defaultSpawnApp({ command, args = [], env, onOutput = () => {} }) {
  const child = nodeSpawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let exited = false;
  let exitCode = null;

  child.stdout?.on("data", (chunk) => onOutput(chunk));
  child.stderr?.on("data", (chunk) => onOutput(chunk));
  child.on("error", (error) => {
    exited = true;
    exitCode = -1;
    onOutput(`spawn error: ${errorMessage(error)}\n`);
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code === null ? (signal ? -1 : null) : code;
  });

  const signalTree = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The process is already gone; nothing to clean up.
      }
    }
  };

  return {
    pid: child.pid,
    get exited() {
      return exited;
    },
    get exitCode() {
      return exitCode;
    },
    async stop({ graceMs = 5_000, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
      if (exited) return;
      signalTree("SIGTERM");
      const deadline = Date.now() + graceMs;
      while (!exited && Date.now() < deadline) await sleep(100);
      if (!exited) signalTree("SIGKILL");
    },
  };
}

function sleepFor(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Find the app window and measure it. Returns `{window, candidates}`; a window
 * record with `mapped === false` still comes back so the failure can name why.
 */
async function findWindow({ plan, runCommand, app, env, sleep }) {
  const deadline = Date.now() + plan.timeoutMs;
  const { title, tolerance } = plan.expectedWindow;
  let candidates = [];

  while (Date.now() <= deadline) {
    const search = runCommand("xdotool", ["search", "--name", title], { env });
    const ids = search?.status === 0 ? parseXdotoolSearchIds(textOf(search)) : [];
    candidates = [];
    for (const id of ids) {
      const info = runCommand("xwininfo", ["-id", String(id)], { env });
      if (info?.status !== 0) continue;
      const parsed = parseXwininfo(textOf(info));
      if (parsed) candidates.push(parsed);
    }
    const selected = selectWindow(candidates, { ...plan.expectedWindow, tolerance });
    if (selected?.mapped) return { window: selected, candidates };
    if (app?.exited) return { window: selected ?? null, candidates };
    await sleep(plan.intervalMs);
  }

  return { window: selectWindow(candidates, { ...plan.expectedWindow, tolerance }), candidates };
}

/**
 * Poll frames until the window paints. The last frame's analysis is returned so
 * a failure reports the real numbers (distinct colours, bright ratio) instead
 * of just "not painted".
 */
async function waitForPaint({ plan, runCommand, env, window, sleep }) {
  const deadline = Date.now() + plan.paintTimeoutMs;
  let last = null;
  let lastCaptureError = null;

  while (Date.now() <= deadline) {
    const capture = runCommand(
      "import",
      ["-display", env.DISPLAY ?? ":0", "-window", String(window.id), "-depth", "8", "rgb:-"],
      { env },
    );
    if (capture?.status !== 0) {
      lastCaptureError = errorTextOf(capture);
    } else {
      const pixels = Buffer.isBuffer(capture.stdout) ? capture.stdout : Buffer.from(capture.stdout ?? []);
      const availablePixels = Math.floor(pixels.length / 3);
      const width = window.width;
      const height = Math.min(window.height, Math.floor(availablePixels / Math.max(width, 1)));
      if (availablePixels > 0 && height > 0) {
        try {
          const frame = analyseFrame({ pixels, width, height });
          const verdict = judgePaint(frame);
          last = { ...verdict, capturedAt: new Date().toISOString() };
          if (verdict.painted) return { paint: verdict, lastCaptureError };
        } catch (error) {
          lastCaptureError = errorMessage(error);
        }
      } else {
        lastCaptureError = `capture returned ${pixels.length} bytes for a ${window.width}x${window.height} window`;
      }
    }
    await sleep(plan.intervalMs);
  }

  if (last) return { paint: { painted: last.painted, reasons: last.reasons, frame: last.frame }, lastCaptureError };
  const reason = lastCaptureError
    ? `no frame could be captured for analysis (${lastCaptureError})`
    : "no frame could be captured for analysis";
  return { paint: { painted: false, reasons: [reason], frame: null }, lastCaptureError };
}

/**
 * Execute a planned smoke. Returns `{exitCode, outcome}`; artifacts always
 * include the launch log, plus a summary or failure report.
 */
export async function executeAppimageSmoke(plan, dependencies = {}) {
  const {
    runCommand = defaultRunCommand,
    spawnApp = defaultSpawnApp,
    createArtifacts = createSmokeArtifacts,
    sleep = sleepFor,
    log = (line) => console.log(line),
  } = dependencies;

  const artifacts = createArtifacts({ dir: plan.artifactsDir });
  const env = { ...process.env, ...plan.appEnv };
  if (plan.display) env.DISPLAY = plan.display;

  log(`appimage: ${plan.appimage}`);
  log(`appimage: launch mode ${plan.launch.mode} — ${plan.launch.note}`);
  log(
    `appimage: expecting a ${plan.expectedWindow.width}x${plan.expectedWindow.height} window titled ` +
      `"${plan.expectedWindow.title}" (±${plan.expectedWindow.tolerance}px)`,
  );
  log(`appimage: artifacts -> ${plan.artifactsDir}`);

  let app = null;
  let window = null;
  let geometry = null;
  let paint = null;
  let captureNote = null;

  try {
    // Same guarantee as the WebDriver lane: a reused artifacts directory starts
    // with no application state from an earlier run, so the app creates the demo
    // database and store itself. `appEnv` is what this lane configures (app-data
    // and home), and each location must resolve strictly beneath the artifacts
    // directory — otherwise nothing is deleted and the smoke refuses to run.
    const pruned = removeHarnessState({ artifactsDir: plan.artifactsDir, env: plan.appEnv });
    for (const location of pruned) {
      log(`appimage: pristine ${location.key} (removed ${location.path})`);
    }

    app = spawnApp({
      command: plan.appimage,
      args: plan.launch.args,
      env,
      onOutput: (chunk) => artifacts.appendLaunchLog(chunk),
    });
    log(`appimage: launched pid ${app?.pid ?? "unknown"}`);

    const found = await findWindow({ plan, runCommand, app, env, sleep });
    window = found.window;
    if (window) {
      log(`appimage: ${describeWindow(window)}`);
      geometry = judgeWindowSize(window, plan.expectedWindow);
    }

    if (window?.mapped && geometry?.ok) {
      if (!Number.isInteger(window.id)) {
        // Without an id there is nothing to capture: fail closed rather than
        // leaving the paint assertion unmeasured.
        paint = {
          painted: false,
          reasons: [`the window has no usable X id (${window.id}), so no frame could be captured`],
        };
      } else {
        log("appimage: window is mapped; waiting for painted content");
        const painted = await waitForPaint({ plan, runCommand, env, window, sleep });
        paint = painted.paint;
        captureNote = painted.lastCaptureError;
        if (paint.frame) log(`appimage: frame ${describeFrame(paint.frame)}`);
        // Keep a screenshot next to the raw analysis: the numbers are the
        // assertion, the image is the evidence a human can look at.
        const shot = runCommand("import", ["-display", env.DISPLAY ?? ":0", "-window", String(window.id), artifacts.screenshotPath], { env });
        if (shot?.status !== 0) log(`appimage: screenshot capture failed (${errorTextOf(shot)})`);
      }
    }

    const diagnostics = classifyDiagnostics(artifacts.logText);
    const outcome = classifyOutcome({
      window,
      geometry,
      paint,
      diagnostics,
      exited: Boolean(app?.exited),
      exitCode: app?.exitCode ?? null,
    });

    log(`appimage: ${outcomeLabel(outcome.status)} ${outcome.headline}`);
    for (const detail of outcome.details) log(`appimage:   ${detail}`);
    if (captureNote) log(`appimage:   capture note: ${captureNote}`);

    const lines = [
      `appimage: ${plan.appimage}`,
      `launch mode: ${plan.launch.mode}`,
      `expected window: ${plan.expectedWindow.width}x${plan.expectedWindow.height} "${plan.expectedWindow.title}"`,
      `window: ${describeWindow(window)}`,
      ...(geometry ? [`geometry: ${geometry.ok ? "ok" : geometry.reasons.join("; ")}`] : []),
      ...(paint
        ? [`paint: ${paint.painted ? "painted" : "not painted"}`, ...(paint.reasons ?? []).map((r) => `paint reason: ${r}`)]
        : []),
      ...(paint?.frame ? [`frame: ${describeFrame(paint.frame)}`] : []),
      `outcome: ${outcome.status} — ${outcome.headline}`,
      ...outcome.details.map((detail) => `detail: ${detail}`),
    ];

    if (outcome.status === "pass") {
      artifacts.writeSummary([...lines, "PASS"]);
      log("appimage: PASS packaged AppImage opened a mapped, painted window at the expected size");
    } else {
      artifacts.writeFailure(lines);
      log(`appimage: failure artifacts -> ${plan.artifactsDir}`);
    }

    return { exitCode: exitCodeForOutcome(outcome.status), outcome, artifacts };
  } catch (error) {
    artifacts.writeFailure([`error: ${errorMessage(error)}`]);
    log(`appimage: FAIL ${errorMessage(error)}`);
    return {
      exitCode: 1,
      outcome: { status: "error", headline: errorMessage(error), details: [] },
      artifacts,
    };
  } finally {
    if (app?.stop) await app.stop().catch(() => {});
  }
}

export async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  spawnSyncImpl = nodeSpawnSync,
  execute = executeAppimageSmoke,
  log = (line) => console.log(line),
  logError = (line) => console.error(line),
} = {}) {
  let plan;
  try {
    plan = planAppimageRun({ argv, cwd, env, platform });
  } catch (error) {
    logError(`appimage: ${errorMessage(error)}`);
    return 1;
  }

  if (plan.help) {
    log(plan.usage);
    return 0;
  }

  if (plan.reexecUnderXvfb) {
    const { command, args } = reexecCommand({
      argv,
      execPath: process.execPath,
      scriptPath: fileURLToPath(import.meta.url),
      displaySize: plan.displaySize,
    });
    log(`appimage: no DISPLAY set; re-running under xvfb-run (${plan.displaySize})`);
    const child = spawnSyncImpl(command, args, { stdio: "inherit" });
    return child?.status ?? 1;
  }

  const { exitCode } = await execute(plan);
  return exitCode;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(`appimage: ${errorMessage(error)}`);
      process.exitCode = 1;
    },
  );
}
