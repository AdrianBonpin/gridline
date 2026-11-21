#!/usr/bin/env bun
/**
 * Desktop end-to-end harness entry point.
 *
 * Launches the built (non-AppImage) desktop binary through tauri-driver — the
 * supported Tauri WebDriver path — and drives one critical flow against the
 * real application: no mocked renderer, no browser-only stand-in. Runs headless
 * on Linux (Xvfb) and on Windows; macOS has no WKWebView WebDriver, so the
 * preflight explains that instead of pretending to pass.
 */
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRunArtifacts } from "./artifacts.mjs";
import { errorMessage } from "./errors.mjs";
import { describeMatchedValues, describeRenderedCells } from "./gridContent.mjs";
import { FLOWS, planRun } from "./preflight.mjs";
import { runCompositeEditFlow } from "./compositeEditFlow.mjs";
import { runDemoSmokeFlow } from "./smokeFlow.mjs";
import { runDestructiveRerunFlow } from "./destructiveFlow.mjs";
import { runSqliteRebuildFlow } from "./sqliteRebuildFlow.mjs";
import { buildCapabilities, startTauriDriver } from "./tauriDriver.mjs";
import { WebDriverClient } from "./webdriverClient.mjs";

/** Flow registry: later tickets register their critical flows here. */
export const FLOW_RUNNERS = {
  "demo-smoke": runDemoSmokeFlow,
  "destructive-rerun": runDestructiveRerunFlow,
  "composite-edit": runCompositeEditFlow,
  "sqlite-rebuild": runSqliteRebuildFlow,
};

export function reexecCommand({ argv, execPath, scriptPath }) {
  return { command: "xvfb-run", args: ["-a", execPath, scriptPath, ...argv] };
}

/**
 * Execute a planned run. Returns the process exit code; artifacts (launch log
 * always, failure report + screenshot on failure) are written under
 * `plan.artifactsDir`.
 */
export async function executeRun(plan, dependencies = {}) {
  const {
    createArtifacts = createRunArtifacts,
    spawnDriver = startTauriDriver,
    clientFor = (baseUrl) => new WebDriverClient({ baseUrl }),
    flows = FLOW_RUNNERS,
    log = (line) => console.log(line),
  } = dependencies;

  const runFlow = flows[plan.flow];
  if (!runFlow) {
    throw new Error(`no runner registered for flow ${JSON.stringify(plan.flow)} (${Object.keys(FLOWS)})`);
  }

  const artifacts = createArtifacts({ dir: plan.artifactsDir });
  log(`e2e: flow ${plan.flow} against ${plan.binary}`);
  log(`e2e: artifacts -> ${plan.artifactsDir}`);

  let driver = null;
  let client = null;
  try {
    driver = await spawnDriver({
      port: plan.port,
      nativePort: plan.nativePort,
      baseUrl: plan.baseUrl,
      env: plan.driverEnv,
      logSink: (chunk) => artifacts.appendLaunchLog(chunk),
    });
    log(`e2e: tauri-driver listening on ${plan.baseUrl}`);

    client = clientFor(plan.baseUrl);
    await client.createSession(buildCapabilities({ application: plan.binary }));
    log("e2e: webview session created; running the smoke flow");

    const result = await runFlow(client, {
      timeoutMs: plan.timeoutMs,
      intervalMs: plan.intervalMs,
    });
    for (const step of result.steps) log(`e2e: ok ${step.name} (${step.durationMs}ms)`);
    // Record what was actually observed, not just that the flow returned: the
    // job log has to show the rendered values that satisfied the assertion.
    const observed = describeRenderedCells(result.renderedCells);
    const matched = describeMatchedValues(result.matchedCells);
    if (observed) log(`e2e: grid observed ${observed}`);
    if (matched) log(`e2e: fixture values rendered in the grid: ${matched}`);
    // A flow may report evidence of its own (what it actually observed); the
    // pass line names that flow's claim instead of one hard-coded message.
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    for (const line of evidence) log(`e2e: ${line}`);
    artifacts.writeSummary([
      ...result.steps.map((step) => `${step.name} (${step.durationMs}ms)`),
      ...(observed ? [`grid observed ${observed}`] : []),
      ...(matched ? [`fixture values rendered in the grid: ${matched}`] : []),
      ...evidence,
      "PASS",
    ]);
    if (result.edited) {
      // The observation the composite-key assertion rests on.
      log(
        `e2e: edited ${result.edited.column} ${JSON.stringify(result.edited.from)} -> ` +
          `${JSON.stringify(result.edited.to)} and only that rendered cell changed`,
      );
    }
    log(`e2e: PASS ${result.passMessage ?? FLOWS[plan.flow] ?? plan.flow}`);
    return { exitCode: 0, steps: result.steps };
  } catch (error) {
    await artifacts.captureFailure({ error, client, display: plan.display });
    log(`e2e: FAIL ${errorMessage(error)}`);
    log(`e2e: failure artifacts -> ${plan.artifactsDir}`);
    return { exitCode: 1, error };
  } finally {
    if (client) await client.deleteSession().catch(() => {});
    if (driver) await driver.stop().catch(() => {});
  }
}

export async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  spawnSyncImpl = nodeSpawnSync,
  execute = executeRun,
  log = (line) => console.log(line),
  logError = (line) => console.error(line),
} = {}) {
  let plan;
  try {
    plan = planRun({ argv, cwd, env, platform });
  } catch (error) {
    logError(`e2e: ${errorMessage(error)}`);
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
    });
    log("e2e: no DISPLAY set; re-running under xvfb-run");
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
      console.error(`e2e: ${errorMessage(error)}`);
      process.exitCode = 1;
    },
  );
}
