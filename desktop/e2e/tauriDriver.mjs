import { spawn as nodeSpawn } from "node:child_process";
import { HarnessError } from "./errors.mjs";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(text, limit = 40) {
  const lines = String(text).trimEnd().split("\n");
  return lines.slice(-limit).join("\n");
}

/** W3C capabilities that tell tauri-driver which binary to launch. */
export function buildCapabilities({ application, args = [] }) {
  if (!application) {
    throw new HarnessError("tauri-driver capabilities require an application path");
  }
  return { alwaysMatch: { "tauri:options": { application, args } } };
}

export function buildDriverCommand({ port, nativePort }) {
  return {
    command: "tauri-driver",
    args: ["--port", String(port), "--native-port", String(nativePort)],
  };
}

/**
 * Start `tauri-driver` and wait until it answers W3C `/status`.
 *
 * Every byte the driver (and, through it, the app) prints is forwarded to
 * `logSink`, so a failed launch always leaves evidence behind. An early exit
 * fails immediately with the captured output instead of waiting out the
 * timeout, which is what makes a missing WebKitWebDriver debuggable.
 */
export async function startTauriDriver({
  port,
  nativePort,
  baseUrl,
  logSink = () => {},
  spawnImpl = nodeSpawn,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  intervalMs = 150,
  sleep = defaultSleep,
  now = () => Date.now(),
  env = {},
}) {
  const { command, args } = buildDriverCommand({ port, nativePort });
  const child = spawnImpl(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const record = (chunk) => {
    const text = String(chunk);
    output += text;
    logSink(text);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  let exit = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  const deadline = now() + timeoutMs;
  for (;;) {
    if (exit) {
      throw new HarnessError(
        `tauri-driver exited before it was ready (code ${exit.code}${exit.signal ? `, signal ${exit.signal}` : ""}):\n${tail(output) || "<no output>"}`,
      );
    }
    try {
      const response = await fetchImpl(`${baseUrl}/status`);
      if (response?.ok) break;
    } catch {
      // Driver not listening yet.
    }
    if (now() >= deadline) {
      child.kill("SIGTERM");
      throw new HarnessError(
        `tauri-driver did not become ready within ${timeoutMs}ms:\n${tail(output) || "<no output>"}`,
      );
    }
    await sleep(intervalMs);
  }

  return {
    baseUrl,
    output: () => output,
    async stop({ killTimeoutMs = 5_000 } = {}) {
      if (exit) return;
      let timer;
      const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), killTimeoutMs);
      });
      child.kill("SIGTERM");
      const stopped = await Promise.race([exited, timedOut]);
      clearTimeout(timer);
      if (!stopped && !exit) child.kill("SIGKILL");
    },
  };
}
