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
