import { HarnessError } from "./errors.mjs";

/**
 * Pure analysis for the packaged AppImage startup/paint smoke.
 *
 * Gridline is dark-themed (#0A0A0B canvas), so "the window is mostly black"
 * is the *expected* healthy state — a naive black-pixel check would fail every
 * correct build (and would also miss a window that painted a black rectangle).
 * What separates "painted" from "empty" here is therefore colour diversity
 * plus a bright-content floor: real chrome, text and accents put many distinct
 * colours and a small but non-trivial share of bright pixels into the frame,
 * while an unpainted window is one flat colour.
 *
 * Everything in this module is a pure function so the verdict can be unit
 * tested against synthetic frames — including a genuinely blank/dark-empty one
 * that must fail.
 */

/** Sample every Nth row/column; a 1200x800 window still yields ~60k samples. */
export const DEFAULT_SAMPLE_STEP = 3;

/** Luminance (0..1) at or above which a pixel counts as "bright content". */
export const BRIGHT_LUMINANCE = 0.35;

/** Colours are bucketed to 5 bits per channel before counting distinct values. */
export const QUANTISE_BITS = 5;

/**
 * Thresholds for a painted window. They are deliberately loose enough to
 * accept a sparse-but-real dark UI (Gridline shows a sidebar, a toolbar, tree
 * labels and a grid of text) and still reject a flat or near-flat frame.
 */
export const DEFAULT_PAINT_THRESHOLDS = {
  minDistinctColours: 8,
  maxDominantColourShare: 0.9,
  minBrightPixelRatio: 0.0015,
};

/** Window size tolerance, in device pixels, for the "expected size" assertion. */
export const DEFAULT_SIZE_TOLERANCE = 48;

/** Fallback expectations; the real values come from tauri.conf.json. */
export const DEFAULT_EXPECTED_WINDOW = { title: "Gridline", width: 1200, height: 800 };

export function relativeLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function quantiseColour(r, g, b) {
  const shift = 8 - QUANTISE_BITS;
  return ((r >> shift) << (QUANTISE_BITS * 2)) | ((g >> shift) << QUANTISE_BITS) | (b >> shift);
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Summarise a raw RGB frame: distinct colours, dominant-colour share, bright
 * pixel ratio and mean luminance.
 *
 * @param {{pixels: Uint8Array|Buffer, width: number, height: number,
 *          sampleStep?: number}} frame
 */
export function analyseFrame({ pixels, width, height, sampleStep = DEFAULT_SAMPLE_STEP }) {
  if (!pixels || typeof pixels.length !== "number") {
    throw new HarnessError("frame analysis needs a raw pixel buffer");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new HarnessError(`frame analysis needs positive integer dimensions, got ${width}x${height}`);
  }
  if (!Number.isInteger(sampleStep) || sampleStep <= 0) {
    throw new HarnessError(`sampleStep must be a positive integer, got ${sampleStep}`);
  }
  const needed = width * height * 3;
  if (pixels.length < needed) {
    throw new HarnessError(
      `frame buffer is ${pixels.length} bytes, expected at least ${needed} for ${width}x${height} RGB`,
    );
  }

  const counts = new Map();
  let sampledPixels = 0;
  let brightPixels = 0;
  let luminanceSum = 0;
  let darkestLuminance = 1;
  let brightestLuminance = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 3;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const key = quantiseColour(r, g, b);
      const seen = counts.get(key);
      if (seen) {
        seen.count += 1;
      } else {
        counts.set(key, { count: 1, hex: toHex(r, g, b) });
      }
      const luminance = relativeLuminance(r, g, b);
      luminanceSum += luminance;
      if (luminance >= BRIGHT_LUMINANCE) brightPixels += 1;
      if (luminance < darkestLuminance) darkestLuminance = luminance;
      if (luminance > brightestLuminance) brightestLuminance = luminance;
      sampledPixels += 1;
    }
  }

  let dominant = { count: 0, hex: "#000000" };
  for (const entry of counts.values()) {
    if (entry.count > dominant.count) dominant = entry;
  }

  return {
    width,
    height,
    sampleStep,
    sampledPixels,
    distinctColours: counts.size,
    dominantColour: dominant.hex,
    dominantColourShare: sampledPixels === 0 ? 1 : dominant.count / sampledPixels,
    brightPixels,
    brightPixelRatio: sampledPixels === 0 ? 0 : brightPixels / sampledPixels,
    meanLuminance: sampledPixels === 0 ? 0 : luminanceSum / sampledPixels,
    darkestLuminance: sampledPixels === 0 ? 0 : darkestLuminance,
    brightestLuminance,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Decide whether a frame shows painted content. A blank (or flat dark) window
 * fails: it has almost no distinct colours, one colour covering everything,
 * and no bright pixels.
 */
export function judgePaint(frame, thresholds = DEFAULT_PAINT_THRESHOLDS) {
  const reasons = [];
  if (frame.sampledPixels === 0) {
    reasons.push("the captured frame had no pixels to sample");
  }
  if (frame.distinctColours < thresholds.minDistinctColours) {
    reasons.push(
      `only ${frame.distinctColours} distinct colour(s) sampled ` +
        `(need ${thresholds.minDistinctColours})`,
    );
  }
  if (frame.dominantColourShare > thresholds.maxDominantColourShare) {
    reasons.push(
      `the single colour ${frame.dominantColour} covers ${percent(frame.dominantColourShare)} of the ` +
        `window (max ${percent(thresholds.maxDominantColourShare)})`,
    );
  }
  if (frame.brightPixelRatio < thresholds.minBrightPixelRatio) {
    reasons.push(
      `only ${percent(frame.brightPixelRatio)} of sampled pixels are bright ` +
        `(need ${percent(thresholds.minBrightPixelRatio)})`,
    );
  }
  return { painted: reasons.length === 0, reasons, frame };
}

/** One-line evidence describing what was actually in the frame. */
export function describeFrame(frame) {
  return (
    `${frame.width}x${frame.height}: ${frame.distinctColours} distinct colour(s), ` +
    `dominant ${frame.dominantColour} at ${percent(frame.dominantColourShare)}, ` +
    `bright ${percent(frame.brightPixelRatio)}, mean luminance ${frame.meanLuminance.toFixed(3)}`
  );
}

/**
 * Mount/FUSE diagnostics. These mean the packaged image never got as far as
 * running the application, so they are reported as an AppImage mount problem
 * rather than as a rendering failure.
 */
export const MOUNT_SIGNATURES = [
  ["libfuse missing", /error loading libfuse/i],
  ["AppImage requires FUSE", /appimages? (?:require|need)s? fuse/i],
  ["cannot mount AppImage", /cannot mount appimage/i],
  ["/dev/fuse unavailable", /(?:failed to open|cannot open|permission denied|no such file)[^\n]*\/dev\/fuse/i],
  ["fusermount failure", /fusermount[^\n]*(?:fail|error|denied|not found)/i],
  ["squashfs mount failure", /failed to mount[^\n]*(?:\.appimage|squashfs|squashfs-root)/i],
  ["extraction failure", /failed to extract[^\n]*(?:appimage|squashfs)/i],
];

/**
 * Known-fatal renderer / web-process diagnostics. Any match fails the smoke:
 * these are the signatures of a WebKit web process that died, a GTK/X fatal,
 * or a sandbox that could not start — never a healthy dark window.
 */
export const FATAL_SIGNATURES = [
  ["web process crashed", /WebKitWebProcess\b[^\n]*(?:crash|exited|terminat|killed|died)/i],
  ["web process failed to start", /(?:failed|unable|could not)\b[^\n]*(?:to )?(?:start|launch|create|spawn)[^\n]*WebKitWebProcess/i],
  ["web process internal error", /WebKit encountered an internal error|WebProcess(?:Proxy)?\b[^\n]*(?:crashed|died)/i],
  ["webkit sandbox failure", /bwrap:[^\n]*(?:fail|error|denied)|Failed to fully launch dbus-proxy/i],
  ["GTK fatal", /Gdk-ERROR|Gdk-Message:[^\n]*fatal/i],
  ["X window system fatal", /received an X Window System error/i],
  ["Rust panic", /panicked at\b/i],
  ["process died on a signal", /Segmentation fault|SIGSEGV|SIGABRT|Aborted \(core dumped\)|Illegal instruction/i],
  ["missing shared library", /error while loading shared libraries/i],
];

/**
 * Renderer diagnostics that are not fatal on their own (a software-rendered
 * run can print GBM/EGL warnings and still paint). They are reported as
 * evidence, and the paint assertion decides the outcome.
 */
export const RENDER_WARNING_SIGNATURES = [
  ["GBM buffer failure", /Failed to create GBM buffer/i],
  ["EGL failure", /(?:eglInitialize|eglCreateContext|eglCreateWindowSurface)[^\n]*(?:fail|error)|Could not create default EGL display/i],
  ["DMA-BUF unavailable", /(?:dma-buf|dmabuf)[^\n]*(?:unavailable|not supported|disabled)/i],
  ["no hardware GL", /llvmpipe|swrast|software rendering/i],
];

const MAX_DIAGNOSTIC_LINE = 400;

function collectMatches(lines, signatures, bucket) {
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    for (const [label, pattern] of signatures) {
      if (!pattern.test(text)) continue;
      bucket.push({ label, line: text.slice(0, MAX_DIAGNOSTIC_LINE) });
    }
  }
}

/**
 * Classify a launch log into mount problems (the packaged image never ran),
 * fatal renderer/web-process diagnostics (the app died), and non-fatal renderer
 * warnings (reported, but the paint assertion is what decides).
 */
export function classifyDiagnostics(logText) {
  const lines = String(logText ?? "").split(/\r?\n/);
  const mountProblems = [];
  const fatal = [];
  const rendererWarnings = [];
  collectMatches(lines, MOUNT_SIGNATURES, mountProblems);
  collectMatches(lines, FATAL_SIGNATURES, fatal);
  collectMatches(lines, RENDER_WARNING_SIGNATURES, rendererWarnings);
  return { mountProblems, fatal, rendererWarnings };
}

export const OUTCOME = {
  pass: "pass",
  mount: "mount",
  fatal: "fatal",
  window: "window",
  geometry: "geometry",
  paint: "paint",
};

/**
 * Reduce every observation into one verdict.
 *
 * Order matters: an AppImage mount problem is reported separately (it never
 * reached the application), then fatal diagnostics, then window presence and
 * mapping, then size, and only then the paint analysis.
 *
 * `window` is a parsed xwininfo record (or null). `found: false` is accepted as
 * an explicit "not found" so a caller can pass its search result straight in.
 *
 * @param {{window?: {found?: boolean, mapped?: boolean, id?: number|string,
 *          width?: number, height?: number} | null,
 *          geometry?: {ok: boolean, reasons?: string[]} | null,
 *          paint?: {painted: boolean, reasons?: string[]} | null,
 *          diagnostics?: {mountProblems?: unknown[], fatal?: unknown[],
 *            rendererWarnings?: unknown[]} | null,
 *          exited?: boolean, exitCode?: number|null}} observations
 */
export function classifyOutcome(observations = {}) {
  const { window = null, geometry = null, paint = null, exited = false, exitCode = null } = observations;
  const diagnostics = observations.diagnostics ?? {};
  const mountProblems = diagnostics.mountProblems ?? [];
  const fatal = diagnostics.fatal ?? [];
  const rendererWarnings = diagnostics.rendererWarnings ?? [];

  const describeMatches = (matches) => matches.map((match) => `${match.label}: ${match.line}`);
  // A mount problem is reported separately from rendering — unless the window
  // demonstrably painted, in which case the image did mount and the line is
  // stale diagnostic noise that belongs in the evidence, not in the verdict.
  const foundWindow = Boolean(window) && window.found !== false;
  const paintedWindow = Boolean(foundWindow && window.mapped && paint?.painted);
  const mountEvidence = mountProblems.length
    ? describeMatches(mountProblems).map((line) => `AppImage mount diagnostic: ${line}`)
    : [];
  const withWarnings = (lines) => [
    ...lines,
    ...mountEvidence,
    ...rendererWarnings.map((match) => `renderer warning (not fatal): ${match.label}: ${match.line}`),
  ];

  if (mountProblems.length > 0 && !paintedWindow) {
    return {
      status: OUTCOME.mount,
      headline:
        "the AppImage could not mount, so the application never started — this is a mount/FUSE " +
        "problem, not a rendering problem",
      details: describeMatches(mountProblems),
      warnings: rendererWarnings.length,
    };
  }

  if (fatal.length > 0) {
    return {
      status: OUTCOME.fatal,
      headline: "the launch log contains fatal renderer/web-process diagnostics",
      details: withWarnings(describeMatches(fatal)),
      warnings: rendererWarnings.length,
    };
  }

  if (!foundWindow) {
    const how = exited
      ? `the application exited (code ${exitCode === null || exitCode === undefined ? "unknown" : exitCode}) without creating a window`
      : "no application window appeared within the budget";
    return {
      status: OUTCOME.window,
      headline: how,
      details: withWarnings([]),
      warnings: rendererWarnings.length,
    };
  }

  if (!window.mapped) {
    return {
      status: OUTCOME.window,
      headline: `window ${window.id} exists but is not mapped (xwininfo map state: ${window.mapState ?? "unknown"})`,
      details: withWarnings([]),
      warnings: rendererWarnings.length,
    };
  }

  // Fail closed: a mapped window whose size or content was never measured has
  // not been verified, so it cannot pass.
  if (!geometry) {
    return {
      status: OUTCOME.geometry,
      headline: `window ${window.id} is mapped but its size was never measured`,
      details: withWarnings([]),
      warnings: rendererWarnings.length,
    };
  }

  if (!geometry.ok) {
    return {
      status: OUTCOME.geometry,
      headline: `window ${window.id} is mapped but not at the expected size`,
      details: withWarnings(geometry.reasons ?? []),
      warnings: rendererWarnings.length,
    };
  }

  if (!paint) {
    return {
      status: OUTCOME.paint,
      headline: "window is mapped at the expected size but its content was never analysed",
      details: withWarnings([]),
      warnings: rendererWarnings.length,
    };
  }

  if (!paint.painted) {
    return {
      status: OUTCOME.paint,
      headline: "window is mapped but its content is not painted (flat/blank frame)",
      details: withWarnings(paint.reasons ?? []),
      warnings: rendererWarnings.length,
    };
  }

  return {
    status: OUTCOME.pass,
    headline: "the packaged AppImage opened a mapped, painted window at the expected size",
    details: withWarnings([]),
    warnings: rendererWarnings.length,
  };
}

/** Log prefix per outcome, so a mount problem can never be read as a render bug. */
export function outcomeLabel(status) {
  switch (status) {
    case OUTCOME.pass:
      return "PASS";
    case OUTCOME.mount:
      return "MOUNT";
    case OUTCOME.fatal:
      return "FATAL";
    case OUTCOME.window:
      return "NO WINDOW";
    case OUTCOME.geometry:
      return "GEOMETRY";
    case OUTCOME.paint:
      return "UNPAINTED";
    default:
      return "FAIL";
  }
}

/** Process exit code: 0 = pass, 2 = mount/FUSE problem (reported separately), 1 = otherwise. */
export function exitCodeForOutcome(status) {
  if (status === OUTCOME.pass) return 0;
  if (status === OUTCOME.mount) return 2;
  return 1;
}

/**
 * Choose how to start the packaged image. `--appimage-extract-and-run` is
 * AppImage's own documented path for hosts without FUSE (containers, Fedora
 * without libfuse2): the image still extracts and launches its AppRun, so the
 * artifact under test is unchanged.
 */
export function decideLaunchMode({ fuseAvailable, forceExtractAndRun = false }) {
  const fuse = fuseAvailable !== false;
  if (forceExtractAndRun || !fuse) {
    return {
      mode: "extract-and-run",
      args: ["--appimage-extract-and-run"],
      note: forceExtractAndRun
        ? "extract-and-run requested (documented AppImage path for hosts without FUSE)"
        : "FUSE is not available, so the documented --appimage-extract-and-run path is used",
    };
  }
  return { mode: "direct", args: [], note: "FUSE is available; launching the AppImage directly" };
}

/**
 * The smoke must exercise the packaged artifact, never an ELF file pulled out
 * of it. This is the guard that keeps that promise honest.
 */
export function assertPackagedLauncher(appimagePath) {
  const path = String(appimagePath ?? "");
  if (!path) throw new HarnessError("no AppImage path was provided");
  if (/squashfs-root|\/usr\/bin\/|\/AppRun$/.test(path)) {
    throw new HarnessError(
      `${JSON.stringify(path)} is an extracted inner binary, not the packaged launcher. ` +
        "Run the .AppImage itself (add --appimage-extract-and-run on hosts without FUSE).",
    );
  }
  if (!/\.AppImage$/i.test(path)) {
    throw new HarnessError(
      `the AppImage smoke must launch a packaged .AppImage, not ${JSON.stringify(path)}. ` +
        "Launch-through-the-launcher is the whole point: an inner binary skips AppRun, the " +
        "bundled resources and the AppImage runtime.",
    );
  }
  return path;
}
