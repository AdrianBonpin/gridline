import { spawnSync as nodeSpawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
 * Environment keys whose values name application state **this harness owns**,
 * because the run plans below point them inside the artifacts directory:
 *
 * - `XDG_DATA_HOME` / `APPDATA` — the app-data directory holding the demo
 *   database and the local SQLite store;
 * - `HOME` — the home directory the packaged AppImage lane gives the app
 *   (its config and cache fall back to `$HOME`).
 *
 * Only values a plan sets itself are pruned. The inherited `HOME` of the
 * developer or CI runner is never in that set, so it is never touched.
 */
export const HARNESS_STATE_ENV_KEYS = ["XDG_DATA_HOME", "HOME", "APPDATA"];

/**
 * The two facts that define the application-state locations this harness owns:
 * the artifacts root every one of them must resolve beneath, and the environment
 * naming them. They only ever travel together — a scope is not useful holding one
 * of the two — so they are passed as one value.
 *
 * @typedef {{artifactsDir: string, env?: Record<string, string | undefined | null>}}
 *   HarnessStateScope
 */

/**
 * Resolve one harness-owned location strictly beneath the scope's artifacts root.
 *
 * Deletion is the destructive half of this harness, so it is only ever allowed
 * on a directory it created: anything that resolves outside the artifacts
 * directory — a `..` segment, another directory entirely — is refused with the
 * path named rather than removed.
 *
 * @param {HarnessStateScope} scope
 * @param {string} location
 * @param {string} [key]
 */
export function resolveOwnedLocation(scope, location, key = "location") {
  const root = resolve(scope.artifactsDir);
  const target = resolve(String(location));
  const beneath = relative(root, target);
  const escapes =
    beneath === "" || // the artifacts directory itself
    isAbsolute(beneath) || // a different root entirely
    beneath === ".." ||
    beneath.startsWith(`..${sep}`);
  if (!escapes) return target;
  if (beneath === "") {
    throw new HarnessError(
      `refusing to delete ${key} at ${target}: it is the artifacts directory itself. ` +
        "The harness only removes the app-data directories it configures inside it, " +
        "never the artifacts directory.",
    );
  }
  throw new HarnessError(
    `refusing to delete ${key} at ${target}: it does not resolve beneath the artifacts ` +
      `directory ${root}. The harness only removes directories it created inside that ` +
      "directory, and will not proceed while a configured location points elsewhere.",
  );
}

/**
 * The application-state locations a plan configures, resolved strictly beneath
 * the artifacts directory. Every location is resolved before any is returned,
 * so an unscopable one refuses the whole run instead of deleting the rest first.
 *
 * @param {HarnessStateScope} scope
 */
export function planHarnessStateRemoval(scope) {
  const locations = [];
  for (const key of HARNESS_STATE_ENV_KEYS) {
    const value = scope.env?.[key];
    if (!value) continue;
    locations.push({ key, path: resolveOwnedLocation(scope, value, key) });
  }
  return locations;
}

/**
 * Remove the application state a previous run left behind, so the run about to
 * start creates the demo database and local store itself.
 *
 * Returns the removed locations (key + path). The artifacts directory and
 * everything else in it — logs, screenshots, reports — are never removed, which
 * is what makes re-running a flow into the same directory useful: reproducing a
 * CI failure locally does not require deleting the directory by hand.
 *
 * @param {HarnessStateScope} scope
 * @param {{remove?: typeof rmSync}} [options]
 */
export function removeHarnessState(scope, { remove = rmSync } = {}) {
  const locations = planHarnessStateRemoval(scope);
  for (const location of locations) {
    remove(location.path, { recursive: true, force: true });
  }
  return locations;
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
