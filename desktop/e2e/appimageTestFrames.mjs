/**
 * Synthetic frames for the AppImage paint-analysis tests.
 *
 * These exist so the assertions can be exercised without a display: a flat
 * "unpainted" frame and a dark-but-painted frame that looks like Gridline's
 * chrome. Nothing here is a substitute for the real packaged run — it is the
 * fixture set that proves the analyser distinguishes the two.
 */

export const CANVAS = [0x0a, 0x0a, 0x0b];
export const SURFACE = [0x18, 0x18, 0x1b];
export const BORDER = [0x27, 0x27, 0x2a];
export const BORDER_HOVER = [0x3f, 0x3f, 0x46];
export const TEXT = [0xfa, 0xfa, 0xfa];
export const TEXT_MUTED = [0xa1, 0xa1, 0xaa];
export const TEXT_DIM = [0x71, 0x71, 0x7a];
export const ACCENT = [0x25, 0x63, 0xeb];
export const ACCENT_MUTED = [0x60, 0xa5, 0xfa];

/** Allocate a frame and let `paint(x, y, put)` decide each pixel's colour. */
export function createFrame(width, height, paint) {
  const pixels = new Uint8Array(width * height * 3);
  const put = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = colour[0];
    pixels[offset + 1] = colour[1];
    pixels[offset + 2] = colour[2];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      put(x, y, paint(x, y) ?? CANVAS);
    }
  }
  return { pixels, width, height };
}

/** A window that never painted: one flat colour (the canvas colour by default). */
export function blankFrame(width = 1200, height = 800, colour = CANVAS) {
  return createFrame(width, height, () => colour);
}

/** A window that painted nothing at all: pure black, as issue #62 reports it. */
export function blackFrame(width = 1200, height = 800) {
  return createFrame(width, height, () => [0, 0, 0]);
}

/** A blank dark window with a few isolated bright pixels — still not a UI. */
export function nearlyBlankFrame(width = 1200, height = 800, brightPixels = 40) {
  const spots = new Set();
  for (let index = 0; index < brightPixels; index += 1) {
    spots.add(`${(index * 137) % width},${(index * 71) % height}`);
  }
  return createFrame(width, height, (x, y) => (spots.has(`${x},${y}`) ? TEXT : CANVAS));
}

/**
 * A dark-themed window that did paint: sidebar, toolbar, accent, chrome and
 * rows of text, with intermediate greys standing in for antialiasing.
 */
export function paintedFrame(width = 1200, height = 800) {
  const sidebarRight = Math.round(width * 0.2);
  const toolbarBottom = 28;
  const gradient = [SURFACE, [0x14, 0x14, 0x17], [0x1c, 0x1c, 0x20], [0x22, 0x22, 0x26], [0x2b, 0x2b, 0x30], [0x33, 0x33, 0x3a]];

  return createFrame(width, height, (x, y) => {
    // Toolbar band with a raised background.
    if (y < toolbarBottom) {
      if (y === toolbarBottom - 1) return BORDER;
      if (x > 8 && x < 8 + 96 && y > 6 && y < toolbarBottom - 6) return ACCENT;
      if (x > 120 && x < 120 + 140 && y > 10 && y < 14) return TEXT_MUTED;
      return [0x22, 0x22, 0x26];
    }

    // Sidebar panel with a vertical gradient (stands in for antialiasing).
    if (x < sidebarRight) {
      if (x === sidebarRight - 1) return BORDER;
      const band = Math.min(gradient.length - 1, Math.floor(y / Math.max(1, Math.round(height / gradient.length))));
      if (y % 52 > 18 && y % 52 < 42 && x > 12 && x < sidebarRight - 20) {
        // "Connection" labels in the tree.
        return (x + y) % 3 === 0 ? TEXT_MUTED : TEXT_DIM;
      }
      return gradient[band];
    }

    // Data grid area: row separators, then cell text.
    if (y % 26 === 0) return BORDER_HOVER;
    if (y % 26 > 8 && y % 26 < 18) {
      const column = Math.floor((x - sidebarRight) / 180);
      const offset = (x - sidebarRight) % 180;
      if (offset > 10 && offset < 12 + ((column * 37) % 90)) {
        return column % 4 === 0 ? TEXT : column % 3 === 0 ? ACCENT_MUTED : TEXT_MUTED;
      }
    }
    return CANVAS;
  });
}

/** Raw RGB buffer, which is what ImageMagick hands the smoke (`rgb:-`). */
export function toRgbBuffer(frame) {
  return Buffer.from(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
}

/**
 * A light-theme window that did paint, matching the real v0.9.2 AppImage frame
 * captured in CI: the app follows the OS theme, so on a light-preference host a
 * complete UI — search bar, buttons, a connection card — sits on a #fafafa
 * background that covers ~97.6% of an otherwise empty workspace.
 *
 * Its measurements (120 distinct colours, 2.36% ink over 75 of 267 sampled rows)
 * are the reason the paint gate cannot be "no colour may dominate".
 */
export function lightSparsePaintedFrame(width = 1200, height = 800) {
  const surface = [0xff, 0xff, 0xff];
  const canvas = [0xfa, 0xfa, 0xfa];
  const ink = [0x18, 0x18, 0x1b];
  const muted = [0x6b, 0x6b, 0x74];
  const border = [0xe4, 0xe4, 0xe7];
  const accent = [0x25, 0x63, 0xeb];
  // Rendered text is antialiased, which is where a real frame's colour
  // diversity comes from (the captured v0.9.2 frame has 120 distinct colours).
  const inkTones = [ink, [0x3a, 0x3a, 0x42], [0x55, 0x55, 0x5e], [0x71, 0x71, 0x7a], [0x8c, 0x8c, 0x95]];
  const mutedTones = [muted, [0x8a, 0x8a, 0x94], [0xa4, 0xa4, 0xad], [0xbe, 0xbe, 0xc6], [0xd6, 0xd6, 0xdb]];
  const toneOf = (tones, x, y) => tones[(x + y * 3) % tones.length];

  return createFrame(width, height, (x, y) => {
    // Search field: box near the top centre, with placeholder text.
    if (y > 22 && y < 62 && x > 310 && x < 890) {
      if (y < 26 || y > 58 || x < 314 || x > 886) return border;
      if (y > 38 && y < 45 && x > 350 && x < 730 && Math.floor(x / 9) % 3 !== 0) return toneOf(mutedTones, x, y);
      return surface;
    }
    // Page heading "Saved Connections".
    if (y > 92 && y < 110 && x > 24 && x < 176 && Math.floor(x / 10) % 4 !== 0) return toneOf(inkTones, x, y);
    // Three pill buttons under the heading.
    if (y > 130 && y < 162 && ((x > 24 && x < 84) || (x > 106 && x < 194) || (x > 212 && x < 292))) {
      if (y < 134 || y > 158) return border;
      if (y > 142 && y < 150 && Math.floor(x / 7) % 4 !== 0) return toneOf(mutedTones, x, y);
      return surface;
    }
    // Accent button, top right.
    if (y > 88 && y < 122 && x > 1024 && x < 1176) {
      if (y > 100 && y < 108 && Math.floor(x / 6) % 5 !== 0) return surface;
      return accent;
    }
    // Connection card: title, badge and a path line.
    if (y > 222 && y < 332 && x > 24 && x < 300) {
      if (y < 226 || y > 328 || x < 28 || x > 296) return border;
      if (y > 244 && y < 262 && x > 88 && x < 250 && Math.floor(x / 8) % 5 !== 0) return toneOf(inkTones, x, y);
      if (y > 266 && y < 280 && x > 88 && x < 150) return [0x6f, 0xd6, 0xa8];
      if (y > 266 && y < 280 && x > 160 && x < 214) return toneOf(mutedTones, x, y);
      if (y > 286 && y < 302 && x > 34 && x < 286 && Math.floor(x / 7) % 6 !== 0) return toneOf(mutedTones, x, y);
      return surface;
    }
    return canvas;
  });
}

/** A single full-width stripe on an empty page: many pixels, few rows. */
export function stripeFrame(width = 1200, height = 800) {
  return createFrame(width, height, (_x, y) => (y >= 395 && y < 405 ? ACCENT : [0xfa, 0xfa, 0xfa]));
}

/** Only a window border: every row has ink, but there is no content. */
export function borderOnlyFrame(width = 1200, height = 800) {
  return createFrame(width, height, (x, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? BORDER_HOVER : [0xfa, 0xfa, 0xfa],
  );
}

/** One solid block in a corner — the "a logo painted, nothing else" case. */
export function solidBlockFrame(width = 1200, height = 800) {
  return createFrame(width, height, (x, y) =>
    x > 40 && x < 240 && y > 40 && y < 140 ? ACCENT : [0xfa, 0xfa, 0xfa],
  );
}

/**
 * Colourful but tiny: ten tones in a small corner mark. This one exists to prove
 * the ink-share floor on its own — colour diversity alone would pass it.
 */
export function tinyMulticolourMarkFrame(width = 1200, height = 800) {
  const tones = [ACCENT, ACCENT_MUTED, TEXT, TEXT_MUTED, TEXT_DIM, BORDER_HOVER, BORDER, SURFACE, CANVAS, [0x44, 0x44, 0x4c]];
  return createFrame(width, height, (x, y) =>
    x > 40 && x < 80 && y > 40 && y < 80 ? tones[(x + y) % tones.length] : [0xfa, 0xfa, 0xfa],
  );
}

/**
 * Plenty of pixels and colours, but only a handful of rows: a gradient rule.
 * Proves the ink-row floor, which a "share of the window" measure cannot.
 */
export function gradientRuleFrame(width = 1200, height = 800) {
  const tones = [ACCENT, ACCENT_MUTED, BORDER, BORDER_HOVER, SURFACE, TEXT_DIM, TEXT_MUTED, [0x33, 0x55, 0x99], [0x22, 0x44, 0x88], [0x11, 0x33, 0x77]];
  return createFrame(width, height, (_x, y) =>
    y >= 396 && y < 404 ? tones[(y + Math.floor(_x / 120)) % tones.length] : [0xfa, 0xfa, 0xfa],
  );
}
