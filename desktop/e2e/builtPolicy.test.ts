import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Built-product seam for ticket 42: the packaged policy has to survive the
 * production bundle, not just the source template. These assertions read the
 * real `desktop/dist` output (`bun run --filter gridline-desktop build`), which
 * is what Tauri embeds into the app.
 *
 * CI runs `bun run test` *before* the frontend build, so a missing `dist` skips
 * this file instead of failing; any flow that builds first (the desktop build,
 * the release pipeline, `bun run build && bun run test`) runs it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const builtIndexPath = join(dist, "index.html");
const built = existsSync(builtIndexPath);
const builtIndexHtml = built ? readFileSync(builtIndexPath, "utf8") : "";

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

function cssBundle(): string {
  const assets = join(dist, "assets");
  if (!existsSync(assets)) return "";
  return readdirSync(assets)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(assets, name), "utf8"))
    .join("\n");
}

describe.skipIf(!built)("built index.html stays compatible with the policy", () => {
  it("has no inline style element", () => {
    // Tauri rewrites packaged <style> blocks with a nonce and adds `'nonce-…'`
    // to style-src; a nonce source suppresses `'unsafe-inline'`, which the SQL
    // editor needs for its runtime stylesheets.
    expect(stripComments(builtIndexHtml)).not.toMatch(/<style[\s>]/i);
  });

  it("has no inline script", () => {
    expect(stripComments(builtIndexHtml)).not.toMatch(
      /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i,
    );
  });

  it("loads the bundle and the stylesheet from the app itself", () => {
    const cleaned = stripComments(builtIndexHtml);
    expect(cleaned).not.toMatch(/(src|href)\s*=\s*["'](?:https?:)?\/\//i);
    expect(cleaned).toMatch(/<script[^>]+src="\/assets\/[^"]+\.js"/i);
    expect(cleaned).toMatch(/<link[^>]+rel=["']stylesheet["'][^>]*href="\/assets\//i);
  });

  it("keeps the pre-paint canvas colour in the CSS bundle", () => {
    // The rule moved out of index.html (see the source test) so the packaged
    // HTML stays nonce-free; it must still reach the page through the
    // render-blocking stylesheet.
    expect(cssBundle()).toMatch(/html,body,#root\{[^}]*background-color/);
  });

  it("emits the editor worker as a same-origin chunk", () => {
    // worker-src 'self' is only sufficient if the worker is not remote.
    const assets = readdirSync(join(dist, "assets"));
    expect(assets.some((name) => name.startsWith("editor.worker-"))).toBe(true);
    const bundle = assets
      .filter((name) => /^index-.*\.js$/.test(name))
      .map((name) => readFileSync(join(dist, "assets", name), "utf8"))
      .join("\n");
    expect(bundle).toContain('new Worker("/assets/editor.worker-');
  });
});
