import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import { createRunArtifacts, decodePngBase64, removeHarnessState } from "./artifacts.mjs";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUg==";
const pngBytes = Buffer.from(PNG_BASE64, "base64");

const tempDirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridline-e2e-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Seed a file inside `dir`, which is what a previous run leaves behind. */
function seed(dir: string, name: string, contents = "stale") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), contents);
}

describe("removeHarnessState", () => {
  it("removes only the app-data locations the plan configures", () => {
    const dir = tempDir();
    const appData = join(dir, "app-data");
    const home = join(dir, "home");
    seed(appData, "gridline-demo.sqlite", "a previous run's demo database");
    seed(home, "store.sqlite", "a previous run's local store");
    writeFileSync(join(dir, "launch.log"), "previous run\n");

    const removed = removeHarnessState({
      artifactsDir: dir,
      env: { XDG_DATA_HOME: appData, HOME: home },
    });

    expect(removed.map((location) => location.path)).toEqual([appData, home]);
    expect(existsSync(appData)).toBe(false);
    expect(existsSync(home)).toBe(false);
    // The artifacts directory and everything else in it are untouched.
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(dir, "launch.log"), "utf8")).toBe("previous run\n");
  });

  it("removes the Windows local-app-data location the plan configures", () => {
    const dir = tempDir();
    const appData = join(dir, "app-data");
    seed(appData, "gridline-demo.sqlite");

    expect(removeHarnessState({ artifactsDir: dir, env: { APPDATA: appData } })).toEqual([
      { key: "APPDATA", path: appData },
    ]);
    expect(existsSync(appData)).toBe(false);
  });

  it("prunes nothing the harness did not configure", () => {
    const dir = tempDir();
    seed(join(dir, "app-data"), "keep.sqlite");

    expect(removeHarnessState({ artifactsDir: dir, env: {} })).toEqual([]);
    expect(existsSync(join(dir, "app-data", "keep.sqlite"))).toBe(true);
  });

  it("refuses a location outside the artifacts directory and deletes nothing", () => {
    const dir = tempDir();
    const elsewhere = tempDir();
    const outside = join(elsewhere, "app-data");
    const appData = join(dir, "app-data");
    seed(outside, "keep.sqlite", "not the harness's to delete");
    seed(appData, "gridline-demo.sqlite");

    // Every location is resolved before anything is removed, so the in-scope
    // app-data directory survives too rather than being half-applied.
    expect(() =>
      removeHarnessState({
        artifactsDir: dir,
        env: { XDG_DATA_HOME: outside, HOME: appData },
      }),
    ).toThrowError(HarnessError);
    expect(() =>
      removeHarnessState({
        artifactsDir: dir,
        env: { XDG_DATA_HOME: outside, HOME: appData },
      }),
    ).toThrowError(/does not resolve beneath the artifacts directory/);
    expect(() =>
      removeHarnessState({
        artifactsDir: dir,
        env: { XDG_DATA_HOME: outside, HOME: appData },
      }),
    ).toThrowError(new RegExp(outside.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(readFileSync(join(outside, "keep.sqlite"), "utf8")).toBe(
      "not the harness's to delete",
    );
    expect(existsSync(join(appData, "gridline-demo.sqlite"))).toBe(true);
  });

  it("refuses a location that climbs out of the artifacts directory", () => {
    const dir = tempDir();
    const escaped = join(dir, "..", `${basename(dir)}-escaped`);
    seed(escaped, "keep.sqlite", "escaped");

    expect(() =>
      removeHarnessState({ artifactsDir: dir, env: { HOME: escaped } }),
    ).toThrowError(/does not resolve beneath the artifacts directory/);
    expect(readFileSync(join(escaped, "keep.sqlite"), "utf8")).toBe("escaped");
    rmSync(escaped, { recursive: true, force: true });
  });

  it("never removes the artifacts directory itself", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "keep.txt"), "keep");

    expect(() => removeHarnessState({ artifactsDir: dir, env: { HOME: dir } })).toThrowError(
      /the artifacts directory itself/,
    );
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("keep");
  });
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    async screenshot() {
      return PNG_BASE64;
    },
    async pageSource() {
      return "<html><body><div role=\"grid\">GL-MSE-001</div></body></html>";
    },
    ...overrides,
  };
}

function noDisplayCapture() {
  return vi.fn(() => ({ status: 1, error: new Error("spawnSync import ENOENT") }));
}

describe("createRunArtifacts", () => {
  it("always keeps a launch log", () => {
    const dir = tempDir();
    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: noDisplayCapture() });
    artifacts.appendLaunchLog("tauri-driver: listening on 127.0.0.1:4444\n");
    artifacts.appendLaunchLog("WebKitWebDriver: session created\n");
    expect(readFileSync(join(dir, "launch.log"), "utf8")).toBe(
      "tauri-driver: listening on 127.0.0.1:4444\nWebKitWebDriver: session created\n",
    );
  });

  it("retains a screenshot, the page source and the failure report", async () => {
    const dir = tempDir();
    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: noDisplayCapture() });
    const error = new HarnessError("grid never showed \"GL-MSE-001\"");
    error.steps = [{ name: "home: open the demo database", durationMs: 12 }];

    const result = await artifacts.captureFailure({ error, client: fakeClient() });

    expect(readFileSync(result.screenshotPath)).toEqual(pngBytes);
    expect(readFileSync(result.pageSourcePath, "utf8")).toContain('role="grid"');
    const report = readFileSync(result.failurePath, "utf8");
    expect(report).toContain('grid never showed "GL-MSE-001"');
    expect(report).toContain("home: open the demo database (12ms)");
    expect(report).toContain("screenshot.png");
    expect(readdirSync(dir)).toEqual(
      expect.arrayContaining(["launch.log", "failure.txt", "screenshot.png", "page-source.html"]),
    );
  });

  it("strips a data URI prefix before writing the PNG", async () => {
    const dir = tempDir();
    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: noDisplayCapture() });
    const result = await artifacts.captureFailure({
      error: new HarnessError("boom"),
      client: fakeClient({
        async screenshot() {
          return `data:image/png;base64,${PNG_BASE64}`;
        },
      }),
    });
    expect(readFileSync(result.screenshotPath)).toEqual(pngBytes);
  });

  it("records why a screenshot could not be captured instead of masking the failure", async () => {
    const dir = tempDir();
    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: noDisplayCapture() });
    const result = await artifacts.captureFailure({
      error: new HarnessError("app never started"),
      client: fakeClient({
        async screenshot() {
          throw new Error("no such session");
        },
      }),
    });
    expect(result.screenshotPath).toBeNull();
    const report = readFileSync(result.failurePath, "utf8");
    expect(report).toContain("app never started");
    expect(report).toContain("no such session");
    expect(report).toContain("display screenshot");
  });

  it("falls back to a display screenshot when there is no WebDriver session", async () => {
    const dir = tempDir();
    const spawnSyncImpl = vi.fn((command: string, args: string[]) => {
      if (command === "import" && args.includes("-window")) {
        writeFileSync(args[args.length - 1], "XWD-PNG");
        return { status: 0 };
      }
      return { status: 1 };
    });

    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: spawnSyncImpl as never });
    const result = await artifacts.captureFailure({
      error: new HarnessError("session could not be created"),
      client: null,
      display: ":99",
    });

    expect(result.displayScreenshotPath).toBe(join(dir, "display.png"));
    expect(spawnSyncImpl.mock.calls[0][0]).toBe("import");
    expect(spawnSyncImpl.mock.calls[0][1]).toEqual([
      "-display",
      ":99",
      "-window",
      "root",
      join(dir, "display.png"),
    ]);
    expect(readFileSync(join(dir, "display.png"), "utf8")).toBe("XWD-PNG");
    const report = readFileSync(result.failurePath, "utf8");
    expect(report).toContain("session could not be created");
    expect(report).toContain("display.png");
  });

  it("writes a summary on success", () => {
    const dir = tempDir();
    const artifacts = createRunArtifacts({ dir, spawnSyncImpl: noDisplayCapture() });
    artifacts.writeSummary(["flow: demo-smoke", "home: open the demo database (8ms)", "PASS"]);
    expect(readFileSync(join(dir, "summary.txt"), "utf8")).toContain("PASS");
  });

  it("decodes base64 PNG payloads", () => {
    expect(decodePngBase64("iVBORw0KGgo=")).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(() => decodePngBase64("")).toThrow(/empty/);
  });
});
