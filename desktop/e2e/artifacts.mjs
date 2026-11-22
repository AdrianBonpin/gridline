import { spawnSync as nodeSpawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError, errorMessage } from "./errors.mjs";

/**
 * Decode a WebDriver `/screenshot` payload (base64, optionally a data URI)
 * into PNG bytes. An empty payload is a harness failure, not a silent skip.
 */
export function decodePngBase64(payload) {
  const raw = String(payload ?? "");
  const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!base64) throw new HarnessError("screenshot payload was empty");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new HarnessError("screenshot payload was empty");
  return buffer;
}

function captureDisplayScreenshot({ dir, display, spawnSyncImpl, notes }) {
  const target = join(dir, "display.png");
  const screen = display ?? process.env.DISPLAY;
  if (!screen) {
    notes.push("display screenshot unavailable: DISPLAY is not set");
    return null;
  }
  // ImageMagick's `import` ships on the GitHub Linux runners and captures the
  // X display directly, which is the only evidence available when the app
  // died before a WebDriver session (and therefore a window) existed.
  const result = spawnSyncImpl("import", ["-display", screen, "-window", "root", target]);
  if (result?.status !== 0) {
    notes.push(
      `display screenshot unavailable: ImageMagick \`import\` failed (${errorMessage(
        result?.error ?? `exit ${result?.status}`,
      )})`,
    );
    return null;
  }
  return target;
}

/**
 * Run artifacts for the desktop end-to-end harness.
 *
 * Everything a failed job needs to be diagnosable is retained here: the
 * driver/launch log is streamed while the run happens, and a failure adds the
 * failure report, the live webview screenshot, the DOM source, and — when no
 * session ever existed — a screenshot of the display.
 *
 * @param {{dir: string, spawnSyncImpl?: typeof import("node:child_process").spawnSync,
 *          now?: () => Date}} options
 */
export function createRunArtifacts({ dir, spawnSyncImpl = nodeSpawnSync, now = () => new Date() }) {
  mkdirSync(dir, { recursive: true });
  const launchLogPath = join(dir, "launch.log");
  // Create the log up front: a run that dies before producing output must still
  // leave an (empty) launch log behind rather than no artifact at all.
  appendFileSync(launchLogPath, "");

  return {
    dir,
    launchLogPath,

    appendLaunchLog(chunk) {
      appendFileSync(launchLogPath, String(chunk));
    },

    writeSummary(lines) {
      writeFileSync(join(dir, "summary.txt"), `${lines.join("\n")}\n`);
    },

    /**
     * @param {{error: unknown, client?: {sessionId?: string | null,
     *          screenshot?: () => Promise<string>, pageSource?: () => Promise<string>} | null,
     *          display?: string}} failure
     */
    async captureFailure({ error, client = null, display }) {
      const notes = [];
      let screenshotPath = null;
      let pageSourcePath = null;
      let displayScreenshotPath = null;

      if (client?.sessionId) {
        try {
          screenshotPath = join(dir, "screenshot.png");
          writeFileSync(screenshotPath, decodePngBase64(await client.screenshot()));
        } catch (captureError) {
          screenshotPath = null;
          notes.push(`WebDriver screenshot failed: ${errorMessage(captureError)}`);
        }
        try {
          pageSourcePath = join(dir, "page-source.html");
          writeFileSync(pageSourcePath, await client.pageSource());
        } catch (captureError) {
          pageSourcePath = null;
          notes.push(`page source capture failed: ${errorMessage(captureError)}`);
        }
      } else {
        notes.push(
          "no WebDriver session was open, so a webview screenshot could not be captured",
        );
      }

      if (!screenshotPath) {
        displayScreenshotPath = captureDisplayScreenshot({
          dir,
          display,
          spawnSyncImpl,
          notes,
        });
      }

      const steps = Array.isArray(error?.steps) ? error.steps : [];
      const lines = [
        "Gridline desktop E2E failure",
        `time: ${now().toISOString()}`,
        `message: ${errorMessage(error)}`,
        "steps:",
        ...(steps.length
          ? steps.map((step) => `  - ${step.name} (${step.durationMs}ms)`)
          : ["  - (none completed)"]),
        "artifacts:",
        "  - launch.log",
        ...(screenshotPath ? ["  - screenshot.png"] : []),
        ...(pageSourcePath ? ["  - page-source.html"] : []),
        ...(displayScreenshotPath ? ["  - display.png"] : []),
        "notes:",
        ...notes.map((note) => `  - ${note}`),
      ];
      const failurePath = join(dir, "failure.txt");
      writeFileSync(failurePath, `${lines.join("\n")}\n`);

      return { failurePath, screenshotPath, pageSourcePath, displayScreenshotPath, notes };
    },
  };
}
