import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAINT_THRESHOLDS,
  OUTCOME,
  analyseFrame,
  assertPackagedLauncher,
  classifyDiagnostics,
  classifyOutcome,
  decideLaunchMode,
  describeFrame,
  exitCodeForOutcome,
  judgePaint,
  outcomeLabel,
  relativeLuminance,
} from "./appimageAnalysis.mjs";
import {
  ACCENT,
  ACCENT_MUTED,
  BORDER,
  BORDER_HOVER,
  TEXT,
  TEXT_DIM,
  TEXT_MUTED,
  blackFrame,
  blankFrame,
  borderOnlyFrame,
  createFrame,
  gradientRuleFrame,
  lightSparsePaintedFrame,
  nearlyBlankFrame,
  paintedFrame,
  solidBlockFrame,
  stripeFrame,
  tinyMulticolourMarkFrame,
} from "./appimageTestFrames.mjs";
import { HarnessError } from "./errors.mjs";

const WIDTH = 1200;
const HEIGHT = 800;

const mappedWindow = (overrides: Record<string, unknown> = {}) => ({
  found: true,
  id: 2097155,
  name: "Gridline",
  mapState: "IsViewable",
  mapped: true,
  width: WIDTH,
  height: HEIGHT,
  x: 0,
  y: 0,
  ...overrides,
});

const okGeometry = { ok: true, reasons: [] };
const okPaint = { painted: true, reasons: [] };

describe("analyseFrame", () => {
  it("collapses a flat, unpainted window to one colour", () => {
    const frame = analyseFrame(blankFrame(WIDTH, HEIGHT));
    expect(frame.sampledPixels).toBeGreaterThan(1000);
    expect(frame.distinctColours).toBe(1);
    expect(frame.dominantColourShare).toBe(1);
    expect(frame.brightPixelRatio).toBe(0);
    expect(frame.meanLuminance).toBeLessThan(0.05);
  });

  it("reports real diversity and content for a painted dark-themed window", () => {
    const frame = analyseFrame(paintedFrame(WIDTH, HEIGHT));
    expect(frame.distinctColours).toBeGreaterThanOrEqual(DEFAULT_PAINT_THRESHOLDS.minDistinctColours);
    expect(frame.inkPixelRatio).toBeGreaterThanOrEqual(DEFAULT_PAINT_THRESHOLDS.minInkPixelRatio);
    expect(frame.inkRows).toBeGreaterThanOrEqual(DEFAULT_PAINT_THRESHOLDS.minInkRows);
    expect(frame.brightPixelRatio).toBeGreaterThan(DEFAULT_PAINT_THRESHOLDS.minBrightPixelRatio);
  });

  it("measures a sparse light-theme window as content on a big background", () => {
    // The real v0.9.2 AppImage frame in CI: complete UI, but the background
    // covers ~97% of an empty workspace because the theme follows the OS. The
    // old "dominant share" rule rejected this, which is why it is gone.
    const frame = analyseFrame(lightSparsePaintedFrame(WIDTH, HEIGHT));
    expect(frame.dominantColourShare).toBeGreaterThan(0.9);
    expect(frame.inkPixelRatio).toBeGreaterThan(DEFAULT_PAINT_THRESHOLDS.minInkPixelRatio);
    expect(frame.inkRows).toBeGreaterThan(DEFAULT_PAINT_THRESHOLDS.minInkRows);
  });

  it("refuses a buffer that cannot cover the claimed dimensions", () => {
    expect(() =>
      analyseFrame({ pixels: new Uint8Array(30), width: 10, height: 10 }),
    ).toThrowError(HarnessError);
  });

  it("refuses non-positive dimensions", () => {
    expect(() => analyseFrame({ pixels: new Uint8Array(30), width: 0, height: 10 })).toThrowError(
      /positive integer dimensions/,
    );
  });
});

describe("judgePaint — a blank or dark-empty window must fail", () => {
  it("fails a uniform dark window (Gridline's own canvas colour, nothing painted)", () => {
    const verdict = judgePaint(analyseFrame(blankFrame(WIDTH, HEIGHT)));
    expect(verdict.painted).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/distinct colour/);
    expect(verdict.reasons.join("\n")).toMatch(/content/);
    expect(verdict.reasons.join("\n")).toMatch(/bright/);
  });

  it("fails a pure black window (the symptom issue #62 reports)", () => {
    const verdict = judgePaint(analyseFrame(blackFrame(WIDTH, HEIGHT)));
    expect(verdict.painted).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it("fails a dark window with only a handful of stray bright pixels", () => {
    const verdict = judgePaint(analyseFrame(nearlyBlankFrame(WIDTH, HEIGHT, 40)));
    expect(verdict.painted).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/bright|distinct colour/);
  });

  it("passes a painted dark window", () => {
    const verdict = judgePaint(analyseFrame(paintedFrame(WIDTH, HEIGHT)));
    expect(verdict.painted).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("does not treat black as failure: a black background with painted content passes", () => {
    // The point of the colour-diversity check: the theme is dark, so the rule
    // cannot be "this pixel is black therefore the window is broken".
    const textTones = [TEXT, TEXT_MUTED, TEXT_DIM, BORDER_HOVER, ACCENT_MUTED, [0x5a, 0x5a, 0x62]];
    const frame = createFrame(WIDTH, HEIGHT, (x, y) => {
      if (y % 26 === 0) return BORDER;
      if (x > WIDTH - 220 && y > HEIGHT - 40) return ACCENT;
      if (y % 26 > 8 && y % 26 < 18) return textTones[Math.floor(x / 6) % textTones.length];
      return [0, 0, 0];
    });
    const verdict = judgePaint(analyseFrame(frame));
    expect(verdict.painted).toBe(true);
  });

  it("passes a sparse light-theme window — a real one, not a blank one", () => {
    // Regression for the false failure that this lane hit on the published
    // v0.9.2 AppImage: the frame showed the full Gridline home screen, but
    // #fafafa covered 97.6% of it, so a background-share rule said "unpainted".
    const verdict = judgePaint(analyseFrame(lightSparsePaintedFrame(WIDTH, HEIGHT)));
    expect(verdict.painted).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("fails frames that are flat, striped or single-block", () => {
    // Each decoy is rejected by a different measurement, so no single threshold
    // is carrying the whole gate: a stripe has pixels but no rows, a small
    // multicolour mark has colours but no ink share, a solid block has neither
    // rows nor colours, and a border-only frame has rows but nothing else.
    const decoys: Array<[string, { pixels: Uint8Array; width: number; height: number }]> = [
      ["stripe", stripeFrame(WIDTH, HEIGHT)],
      ["border only", borderOnlyFrame(WIDTH, HEIGHT)],
      ["solid block", solidBlockFrame(WIDTH, HEIGHT)],
      ["tiny multicolour mark", tinyMulticolourMarkFrame(WIDTH, HEIGHT)],
      ["gradient rule", gradientRuleFrame(WIDTH, HEIGHT)],
    ];
    for (const [label, frame] of decoys) {
      const verdict = judgePaint(analyseFrame(frame));
      expect(verdict.painted, `${label} must not count as painted`).toBe(false);
      expect(verdict.reasons.length, `${label} must say why`).toBeGreaterThan(0);
    }
  });

  it("reports the numbers it decided on, so a failure is evidence", () => {
    const frame = analyseFrame(blankFrame(WIDTH, HEIGHT));
    const line = describeFrame(frame);
    expect(line).toContain(`${WIDTH}x${HEIGHT}`);
    expect(line).toContain("distinct colour");
    expect(line).toContain("content");
    expect(line).toContain("bright");
  });

  it("scores luminance the way the thresholds assume", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255));
  });
});

describe("classifyDiagnostics", () => {
  it("classifies a FUSE/libfuse failure as a mount problem, not a render failure", () => {
    const classified = classifyDiagnostics(
      "dlopen(): error loading libfuse.so.2\nAppImages require FUSE to run.\n",
    );
    expect(classified.mountProblems.map((m: { label: string }) => m.label)).toEqual([
      "libfuse missing",
      "AppImage requires FUSE",
    ]);
    expect(classified.fatal).toEqual([]);
  });

  it("classifies container mount failures", () => {
    expect(
      classifyDiagnostics("fusermount: failed to open /dev/fuse: Operation not permitted").mountProblems
        .length,
    ).toBeGreaterThan(0);
    expect(classifyDiagnostics("Cannot mount AppImage, please check your FUSE setup").mountProblems.length).toBe(1);
  });

  it("fails on a crashed web process", () => {
    const classified = classifyDiagnostics(
      "[1234:1234:0101] WebKitWebProcess crashed with signal 11\n",
    );
    expect(classified.fatal.map((m: { label: string }) => m.label)).toContain("web process crashed");
    expect(classified.mountProblems).toEqual([]);
  });

  it("fails on sandbox, panic, GTK fatal and signal deaths", () => {
    const classified = classifyDiagnostics(
      [
        "bwrap: Creating new namespace failed: Operation not permitted",
        "thread 'main' panicked at src/main.rs:10:5",
        "Gdk-ERROR **: The program 'gridline' received an X Window System error",
        "Segmentation fault (core dumped)",
      ].join("\n"),
    );
    const labels = classified.fatal.map((match: { label: string }) => match.label);
    expect(labels).toContain("webkit sandbox failure");
    expect(labels).toContain("Rust panic");
    expect(labels).toContain("GTK fatal");
    expect(labels).toContain("process died on a signal");
  });

  it("treats GBM/EGL noise as a reported renderer warning, not a fatal one", () => {
    const classified = classifyDiagnostics(
      "Failed to create GBM buffer of size 1200x800: Invalid argument\n",
    );
    expect(classified.fatal).toEqual([]);
    expect(classified.rendererWarnings.map((m: { label: string }) => m.label)).toContain(
      "GBM buffer failure",
    );
  });

  it("stays quiet on a healthy launch log", () => {
    const classified = classifyDiagnostics("Gridline started\nlocal store ready\n");
    expect(classified).toEqual({ mountProblems: [], fatal: [], rendererWarnings: [] });
  });

  it("handles a missing log", () => {
    expect(classifyDiagnostics(undefined)).toEqual({
      mountProblems: [],
      fatal: [],
      rendererWarnings: [],
    });
  });
});

describe("classifyOutcome", () => {
  it("passes a mapped, correctly sized, painted window", () => {
    const outcome = classifyOutcome({
      window: mappedWindow(),
      geometry: okGeometry,
      paint: okPaint,
    });
    expect(outcome.status).toBe(OUTCOME.pass);
    expect(exitCodeForOutcome(outcome.status)).toBe(0);
  });

  it("reports a mount problem separately from rendering", () => {
    const outcome = classifyOutcome({
      window: null,
      diagnostics: classifyDiagnostics("dlopen(): error loading libfuse.so.2"),
      exited: true,
      exitCode: 1,
    });
    expect(outcome.status).toBe(OUTCOME.mount);
    expect(outcome.headline).toMatch(/mount\/FUSE problem, not a rendering problem/);
    // A distinct exit code keeps the lane's report separate in CI.
    expect(exitCodeForOutcome(outcome.status)).toBe(2);
    expect(outcomeLabel(outcome.status)).toBe("MOUNT");
  });

  it("ignores a stale mount line when the window actually painted", () => {
    const outcome = classifyOutcome({
      window: mappedWindow(),
      geometry: okGeometry,
      paint: okPaint,
      diagnostics: classifyDiagnostics("dlopen(): error loading libfuse.so.2"),
    });
    expect(outcome.status).toBe(OUTCOME.pass);
    expect(outcome.details.join("\n")).toMatch(/AppImage mount diagnostic/);
  });

  it("fails on fatal renderer diagnostics even when a window exists", () => {
    const outcome = classifyOutcome({
      window: mappedWindow(),
      geometry: okGeometry,
      paint: okPaint,
      diagnostics: classifyDiagnostics("WebKitWebProcess crashed with signal 11"),
    });
    expect(outcome.status).toBe(OUTCOME.fatal);
    expect(exitCodeForOutcome(outcome.status)).toBe(1);
    expect(outcome.details.join("\n")).toMatch(/web process crashed/);
  });

  it("fails when no window appeared", () => {
    const outcome = classifyOutcome({ window: null, exited: true, exitCode: 1 });
    expect(outcome.status).toBe(OUTCOME.window);
    expect(outcome.headline).toMatch(/exited \(code 1\) without creating a window/);
  });

  it("fails when the window exists but is not mapped", () => {
    const outcome = classifyOutcome({
      window: mappedWindow({ mapped: false, mapState: "IsUnmapped" }),
    });
    expect(outcome.status).toBe(OUTCOME.window);
    expect(outcome.headline).toMatch(/not mapped/);
  });

  it("fails when the mapped window is the wrong size", () => {
    const outcome = classifyOutcome({
      window: mappedWindow({ width: 640, height: 480 }),
      geometry: { ok: false, reasons: ["width is 640px, expected 1200px (±48px, off by -560)"] },
    });
    expect(outcome.status).toBe(OUTCOME.geometry);
    expect(outcome.details.join("\n")).toMatch(/expected 1200px/);
  });

  it("fails when the mapped window is not painted", () => {
    const verdict = judgePaint(analyseFrame(blankFrame(WIDTH, HEIGHT)));
    const outcome = classifyOutcome({
      window: mappedWindow(),
      geometry: okGeometry,
      paint: verdict,
    });
    expect(outcome.status).toBe(OUTCOME.paint);
    expect(outcomeLabel(outcome.status)).toBe("UNPAINTED");
    expect(outcome.details.join("\n")).toMatch(/distinct colour/);
  });

  it("fails closed when the size or the content was never measured", () => {
    expect(
      classifyOutcome({ window: mappedWindow(), geometry: null, paint: okPaint }).status,
    ).toBe(OUTCOME.geometry);
    expect(classifyOutcome({ window: mappedWindow(), geometry: okGeometry }).status).toBe(
      OUTCOME.paint,
    );
  });
});

describe("how the packaged image is launched", () => {
  it("launches the AppImage directly when FUSE is available", () => {
    expect(decideLaunchMode({ fuseAvailable: true })).toMatchObject({
      mode: "direct",
      args: [],
    });
  });

  it("falls back to the documented extract-and-run path without FUSE", () => {
    const launch = decideLaunchMode({ fuseAvailable: false });
    expect(launch.mode).toBe("extract-and-run");
    expect(launch.args).toEqual(["--appimage-extract-and-run"]);
  });

  it("accepts an explicit extract-and-run request", () => {
    expect(decideLaunchMode({ fuseAvailable: true, forceExtractAndRun: true }).mode).toBe(
      "extract-and-run",
    );
  });

  it("accepts a packaged AppImage path", () => {
    expect(assertPackagedLauncher("/tmp/Gridline_0.8.4_amd64.AppImage")).toBe(
      "/tmp/Gridline_0.8.4_amd64.AppImage",
    );
  });

  it("refuses to launch an inner binary instead of the packaged image", () => {
    expect(() => assertPackagedLauncher("/tmp/squashfs-root/AppRun")).toThrowError(
      /extracted inner binary/,
    );
    expect(() => assertPackagedLauncher("/tmp/squashfs-root/usr/bin/gridline")).toThrowError(
      /extracted inner binary/,
    );
    expect(() => assertPackagedLauncher("/usr/lib/gridline/gridline")).toThrowError(
      /packaged \.AppImage/,
    );
    expect(() => assertPackagedLauncher("")).toThrowError(/no AppImage path/);
  });
});
