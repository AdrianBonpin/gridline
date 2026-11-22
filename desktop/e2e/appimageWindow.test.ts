import { describe, expect, it } from "vitest";
import {
  describeWindow,
  judgeWindowSize,
  parseXdotoolGeometry,
  parseXdotoolSearchIds,
  parseXwininfo,
  selectWindow,
} from "./appimageWindow.mjs";

// Recorded shapes, not hand-waved ones: `xwininfo -id <id>` on a GTK window
// under Xvfb, and `xdotool getwindowgeometry --shell`.
const XWININFO_MAPPED = `
xwininfo: Window id: 0x1400003 "Gridline"

  Absolute upper-left X:  0
  Absolute upper-left Y:  0
  Relative upper-left X:  0
  Relative upper-left Y:  0
  Width: 1200
  Height: 800
  Depth: 24
  Visual: 0x21
  Visual Class: TrueColor
  Border width: 0
  Class: InputOutput
  Colormap: 0x20 (installed)
  Bit Gravity State: NorthWestGravity
  Window Gravity State: NorthWestGravity
  Backing Store State: NotUseful
  Save Under State: no
  Map State: IsViewable
  Override Redirect State: no
  Corners:  +0+0  -280+0  -0+224  +0-224
  -geometry 1200x800+0+0
`;

const XWININFO_UNMAPPED = XWININFO_MAPPED.replace("Map State: IsViewable", "Map State: IsUnmapped");

describe("parseXdotoolSearchIds", () => {
  it("reads one window id per line and ignores noise", () => {
    expect(parseXdotoolSearchIds("2097155\n6291459\n")).toEqual([2097155, 6291459]);
    expect(parseXdotoolSearchIds("")).toEqual([]);
    expect(parseXdotoolSearchIds("not-an-id\n0\n-5\n")).toEqual([]);
    expect(parseXdotoolSearchIds("12\n12\n")).toEqual([12]);
  });
});

describe("parseXdotoolGeometry", () => {
  it("reads the --shell key=value form", () => {
    const geometry = parseXdotoolGeometry("WINDOW=2097155\nX=0\nY=0\nWIDTH=1200\nHEIGHT=800\nSCREEN=0\n");
    expect(geometry).toEqual({ id: 2097155, x: 0, y: 0, width: 1200, height: 800, screen: 0 });
  });

  it("reports what it could not read instead of inventing numbers", () => {
    expect(parseXdotoolGeometry("nonsense\n")).toEqual({
      id: null,
      x: null,
      y: null,
      width: null,
      height: null,
      screen: null,
    });
  });
});

describe("parseXwininfo", () => {
  it("parses a mapped window's geometry and map state", () => {
    const window = parseXwininfo(XWININFO_MAPPED);
    expect(window).toMatchObject({
      id: 0x1400003,
      name: "Gridline",
      mapState: "IsViewable",
      mapped: true,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
    });
  });

  it("parses a window that has no name", () => {
    // ImageMagick's `display` (and any app that sets no WM_NAME) reports the
    // header without a quoted name; the id and size still have to parse.
    const window = parseXwininfo(
      '\nxwininfo: Window id: 0x200017 (has no name)\n\n  Width: 1200\n  Height: 800\n  Map State: IsViewable\n',
    );
    expect(window).toMatchObject({ id: 0x200017, name: "", mapped: true, width: 1200, height: 800 });
  });

  it("marks an unmapped window as not mapped", () => {
    expect(parseXwininfo(XWININFO_UNMAPPED)).toMatchObject({ mapped: false, mapState: "IsUnmapped" });
  });

  it("returns null when xwininfo did not report a map state or size", () => {
    expect(parseXwininfo("")).toBeNull();
    expect(parseXwininfo('xwininfo: Window id: 0x1 "Gridline"\n  Width: 10\n')).toBeNull();
    expect(parseXwininfo("xwininfo: error: no such window")).toBeNull();
  });
});

describe("selectWindow", () => {
  const base = { name: "Gridline", mapState: "IsViewable", mapped: true, x: 0, y: 0 };

  it("prefers a mapped window at the expected size", () => {
    const selected = selectWindow([
      { ...base, id: 1, width: 200, height: 100 },
      { ...base, id: 2, width: 1200, height: 800 },
    ]);
    expect(selected?.id).toBe(2);
  });

  it("falls back to the largest mapped window when the size is wrong", () => {
    const selected = selectWindow([
      { ...base, id: 3, width: 640, height: 480 },
      { ...base, id: 4, width: 900, height: 700 },
    ]);
    expect(selected?.id).toBe(4);
  });

  it("does not prefer an unmapped window over a mapped one", () => {
    const selected = selectWindow([
      { ...base, id: 5, width: 1200, height: 800, mapped: false, mapState: "IsUnmapped" },
      { ...base, id: 6, width: 300, height: 200 },
    ]);
    expect(selected?.id).toBe(6);
  });

  it("returns the unmapped candidate so the caller can say why it failed", () => {
    const selected = selectWindow([
      { ...base, id: 7, width: 1200, height: 800, mapped: false, mapState: "IsUnmapped" },
    ]);
    expect(selected?.id).toBe(7);
    expect(selected?.mapped).toBe(false);
  });

  it("returns null when nothing was found", () => {
    expect(selectWindow([])).toBeNull();
    expect(selectWindow(undefined)).toBeNull();
    expect(selectWindow([null, undefined])).toBeNull();
  });
});

describe("judgeWindowSize", () => {
  const window = { id: 1, name: "Gridline", mapped: true, mapState: "IsViewable", width: 1200, height: 800 };

  it("accepts the configured size", () => {
    expect(judgeWindowSize(window)).toEqual({ ok: true, reasons: [] });
  });

  it("tolerates a small decoration difference", () => {
    expect(judgeWindowSize({ ...window, width: 1200, height: 830 }).ok).toBe(true);
  });

  it("rejects a window that is the wrong size, naming the numbers", () => {
    const verdict = judgeWindowSize({ ...window, width: 640, height: 480 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/width is 640px, expected 1200px/);
    expect(verdict.reasons.join("\n")).toMatch(/height is 480px, expected 800px/);
  });

  it("rejects an unmapped window outright", () => {
    const verdict = judgeWindowSize({ ...window, mapped: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toMatch(/not mapped/);
  });

  it("rejects a missing measurement", () => {
    expect(judgeWindowSize(null).ok).toBe(false);
  });

  it("follows the configured expectation rather than a hard-coded size", () => {
    expect(judgeWindowSize(window, { expectedWidth: 900, expectedHeight: 600 }).ok).toBe(false);
  });
});

describe("describeWindow", () => {
  it("names the id, title, size and map state", () => {
    const line = describeWindow({ id: 2097155, name: "Gridline", width: 1200, height: 800, mapState: "IsViewable" });
    expect(line).toContain("2097155");
    expect(line).toContain("Gridline");
    expect(line).toContain("1200x800");
    expect(describeWindow(null)).toBe("no window");
  });
});
