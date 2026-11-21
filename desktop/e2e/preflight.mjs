import { spawnSync as nodeSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "./errors.mjs";

export const DEFAULT_PORT = 4444;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_INTERVAL_MS = 250;
export const DEFAULT_FLOW = "demo-smoke";

/** Flows the harness can drive. Later tickets add their critical flows here. */
export const FLOWS = {
  "demo-smoke":
    "open the seeded demo SQLite database and assert that a demo table's rows are rendered",
};

const USAGE = `usage: bun run e2e [options]

Launches the built, non-AppImage desktop binary through tauri-driver and runs
one end-to-end flow against it.

options:
  --binary <path>       desktop binary to launch (default: src-tauri/target/release/gridline)
  --artifacts <dir>     where launch logs/screenshots are written (default: e2e-artifacts)
  --flow <name>         flow to run (default: ${DEFAULT_FLOW})
  --timeout-ms <ms>     per-step budget (default: ${DEFAULT_TIMEOUT_MS})
  --interval-ms <ms>    poll interval (default: ${DEFAULT_INTERVAL_MS})
  --port <n>            tauri-driver port (default: ${DEFAULT_PORT})
  --native-port <n>     underlying WebKitWebDriver port (default: ${DEFAULT_PORT + 1})
  -h, --help            show this help

flows:
${Object.entries(FLOWS)
  .map(([name, description]) => `  ${name} — ${description}`)
  .join("\n")}

environment:
  DISPLAY                 existing X display to drive; when unset on Linux the
                          harness re-executes itself under xvfb-run
  GRIDLINE_E2E_BINARY     alternative to --binary
`;

export function defaultBinaryPath({ platform, cwd }) {
  const name = platform === "win32" ? "gridline.exe" : "gridline";
  return join(cwd, "src-tauri", "target", "release", name);
}

export function defaultArtifactsDir({ cwd }) {
  return join(cwd, "e2e-artifacts");
}

export function usageText() {
  return USAGE;
}

function positiveInteger(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HarnessError(
      `${flag} must be a positive integer, got ${JSON.stringify(value)}\n\n${USAGE}`,
    );
  }
  return parsed;
}

/** Parse harness CLI flags. Unknown or malformed input fails with the usage text. */
export function parseArgs(argv) {
  const args = {
    binary: null,
    artifacts: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    port: DEFAULT_PORT,
    nativePort: DEFAULT_PORT + 1,
    flow: DEFAULT_FLOW,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new HarnessError(`${flag} requires a value\n\n${USAGE}`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case "--binary":
        args.binary = nextValue();
        break;
      case "--artifacts":
        args.artifacts = nextValue();
        break;
      case "--flow":
        args.flow = nextValue();
        break;
      case "--timeout-ms":
        args.timeoutMs = positiveInteger(flag, nextValue());
        break;
      case "--interval-ms":
        args.intervalMs = positiveInteger(flag, nextValue());
        break;
      case "--port":
        args.port = positiveInteger(flag, nextValue());
        break;
      case "--native-port":
        args.nativePort = positiveInteger(flag, nextValue());
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

function commandExists(command, platform) {
  const probe = nodeSpawnSync(platform === "win32" ? "where" : "which", [command], {
    stdio: "ignore",
  });
  return probe?.status === 0;
}

/**
 * Decide everything the run needs before touching the app: platform support,
 * the binary to launch, artifacts location and the headless display.
 *
 * Pure apart from cheap existence probes, so the whole preflight contract is
 * unit-tested without a driver, a display, or a build.
 */
export function planRun({
  argv = [],
  platform = process.platform,
  cwd = process.cwd(),
  env = process.env,
  binaryExists = existsSync,
  xvfbRunAvailable = () => commandExists("xvfb-run", platform),
}) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, usage: USAGE };

  if (platform !== "linux" && platform !== "win32") {
    const name = platform === "darwin" ? "macOS" : platform;
    throw new HarnessError(
      `tauri-driver, the supported Tauri WebDriver path, does not run on ${name}: ` +
        "there is no WKWebView WebDriver to drive. Run this harness on Linux " +
        "(xvfb + WebKitWebDriver, as CI does) or Windows. macOS coverage comes from " +
        "the packaged artifact smoke lane instead.",
    );
  }

  if (!FLOWS[args.flow]) {
    throw new HarnessError(
      `unknown flow ${JSON.stringify(args.flow)}; available: ${Object.keys(FLOWS).join(", ")}`,
    );
  }

  const binary = args.binary ?? env.GRIDLINE_E2E_BINARY ?? defaultBinaryPath({ platform, cwd });
  if (!binaryExists(binary)) {
    throw new HarnessError(
      `desktop binary not found at ${binary}. Build it first: ` +
        "`bun run --filter gridline-desktop e2e:build` (tauri build --no-bundle).",
    );
  }

  const artifactsDir = args.artifacts ? resolve(cwd, args.artifacts) : defaultArtifactsDir({ cwd });

  // Give every run a pristine app-data directory (the demo database and local
  // store are seeded on first launch) and keep the seeded files inside the
  // artifacts folder, so a failing run carries its own app state. The
  // dma-buf renderer is disabled by default in this harness only: the CI
  // runner has no GPU, and WebKitGTK otherwise paints nothing under Xvfb.
  const driverEnv = {};
  if (platform === "linux") {
    driverEnv.XDG_DATA_HOME = join(artifactsDir, "app-data");
    driverEnv.WEBKIT_DISABLE_DMABUF_RENDERER = env.WEBKIT_DISABLE_DMABUF_RENDERER ?? "1";
  } else if (platform === "win32") {
    driverEnv.APPDATA = join(artifactsDir, "app-data");
  }

  const display = env.DISPLAY ?? null;
  let reexecUnderXvfb = false;
  if (platform === "linux" && !display) {
    if (!xvfbRunAvailable()) {
      throw new HarnessError(
        "no display to launch the app on: DISPLAY is unset and xvfb-run is not " +
          "installed. Install xvfb (e.g. `apt-get install -y xvfb`) or set DISPLAY.",
      );
    }
    reexecUnderXvfb = true;
  }

  return {
    help: false,
    platform,
    binary,
    artifactsDir,
    flow: args.flow,
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
    port: args.port,
    nativePort: args.nativePort,
    baseUrl: `http://127.0.0.1:${args.port}`,
    display,
    reexecUnderXvfb,
    driverEnv,
  };
}
