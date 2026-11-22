import { describe, it, expect } from "vitest";
import tauriConf from "../../src-tauri/tauri.conf.json";
import capabilityFile from "../../src-tauri/capabilities/default.json";
import sourceIndexHtml from "../../index.html?raw";
import policyAdr from "../../../docs/adr/0002-production-csp-and-webview-capabilities.md?raw";

/**
 * The packaged build's security policy is a configuration contract, so it is
 * pinned here as data: the exact CSP string, the exact directive allow-list,
 * and the exact webview permission list. Any loosening — a wildcard, a remote
 * origin, an eval source, a re-granted broad permission set — fails this file
 * instead of silently shipping.
 *
 * The reasoning for every allowance lives in
 * `docs/adr/0002-production-csp-and-webview-capabilities.md`.
 */

/** The policy Tauri injects into every HTML asset of a packaged build. */
const PRODUCTION_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src ipc: http://ipc.localhost; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "media-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'none'";

/**
 * Development is deliberately looser: the Vite dev server serves the page from
 * `http://localhost:1420`, injects the React refresh preamble as an inline
 * script, and pushes HMR updates over a websocket. Everything else stays as
 * strict as production. See the ADR's "development-mode gap" section.
 */
const DEVELOPMENT_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src ipc: http://ipc.localhost http://localhost:1420 http://127.0.0.1:1420 ws://localhost:1420 ws://127.0.0.1:1420; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "media-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'none'";

/**
 * Every permission the renderer actually exercises. Ordered as reviewed; the
 * comments name the call site that needs it.
 */
const EXPECTED_PERMISSIONS = [
  // @tauri-apps/api/event — backup progress, stream-export progress, SQL
  // open-with notifications (listen + the returned unlisten).
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  // @tauri-apps/api/window — document title, theme + window background sync,
  // the macOS overlay drag strip, and its double-click maximize.
  "core:window:allow-set-title",
  "core:window:allow-set-theme",
  "core:window:allow-set-background-color",
  "core:window:allow-start-dragging",
  "core:window:allow-internal-toggle-maximize",
  // @tauri-apps/plugin-dialog — native file pickers only.
  "dialog:allow-open",
  "dialog:allow-save",
  // @tauri-apps/plugin-fs — connection JSON import+export (src/lib/importExport.ts)
  // and the schema-visualizer image export (SchemaVisualizerPage.tsx). Paths are
  // authorized by the native picker, which is the only thing that extends the fs
  // scope at runtime. Settings import/export no longer uses this plugin: it goes
  // through a Rust File Grant (settings::export_settings_to_file /
  // read_settings_file), so a renderer-supplied path authorizes nothing there.
  "fs:allow-read-text-file",
  "fs:allow-write-text-file",
  "fs:allow-write-file",
  // Deny (not allow) scope: credential material stays out of renderer reach
  // even if a save dialog is pointed at it.
  "fs:scope",
];

/** Credential stores the renderer must not be able to read or overwrite. */
const EXPECTED_DENIED_PATHS = [
  "$HOME/.ssh",
  "$HOME/.ssh/**",
  "$HOME/.aws",
  "$HOME/.aws/**",
  "$HOME/.gnupg",
  "$HOME/.gnupg/**",
  "$HOME/Library/Keychains",
  "$HOME/Library/Keychains/**",
];

type SecurityConfig = { csp?: string | null; devCsp?: string | null };
type PermissionEntry =
  | string
  | { identifier: string; allow?: string[]; deny?: string[] };

const security = tauriConf.app.security as SecurityConfig;
const capability = capabilityFile as {
  identifier?: string;
  windows?: string[];
  permissions?: PermissionEntry[];
};

const permissionEntries = capability.permissions ?? [];
const permissionRefs = permissionEntries.map((entry) =>
  typeof entry === "string" ? entry : entry.identifier,
);

/** `"a 'b' c; d e"` -> `{ a: ["'b'", "c"], d: ["e"] }` */
function parseCsp(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    directives[name] = sources;
  }
  return directives;
}

describe("production content security policy", () => {
  it("ships a policy instead of null", () => {
    expect(security.csp).toBeTruthy();
  });

  it("is exactly the reviewed policy", () => {
    expect(security.csp).toBe(PRODUCTION_CSP);
  });

  it("declares exactly the reviewed directives", () => {
    // Written out independently of the policy string above so a new or changed
    // directive has to be reviewed here as well.
    expect(parseCsp(security.csp as string)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      "connect-src": ["ipc:", "http://ipc.localhost"],
      "worker-src": ["'self'", "blob:"],
      "object-src": ["'none'"],
      "frame-src": ["'none'"],
      "media-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'none'"],
    });
  });

  it("allows no wildcard, eval, or remote source", () => {
    const sources = Object.values(parseCsp(security.csp as string)).flat();
    // The only non-'self' network source is the local Tauri IPC endpoint the
    // webview posts invokes to (Windows/Android host it on http://ipc.localhost).
    const isLocalIpc = (source: string) => source === "http://ipc.localhost";
    for (const source of sources) {
      expect(source).not.toBe("*");
      expect(source).not.toMatch(/'unsafe-eval'/);
      if (isLocalIpc(source)) continue;
      expect(source).not.toMatch(/^(https?|wss?|ftp):/);
    }
    const network = sources.filter((s) => s.includes("//"));
    expect(network).toEqual(["http://ipc.localhost"]);
  });

  it("keeps inline styles (the editor injects them) but never inline scripts", () => {
    const directives = parseCsp(security.csp as string);
    // monaco-editor 0.56 creates <style> elements at runtime and fills them via
    // textContent (esm/vs/base/browser/domStylesheets.js createStyleSheet), which
    // is an inline-style insertion: without 'unsafe-inline' the editor renders
    // unstyled. A nonce or hash source would suppress 'unsafe-inline', which is
    // why the packaged HTML must not contain inline <style> (asserted below).
    expect(directives["style-src"]).toContain("'unsafe-inline'");
    expect(directives["script-src"]).not.toContain("'unsafe-inline'");
    expect(directives["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("keeps Tauri IPC reachable and nothing else", () => {
    const connect = parseCsp(security.csp as string)["connect-src"] ?? [];
    // The webview performs every invoke as a fetch to the IPC protocol:
    // ipc://localhost on macOS/Linux, http://ipc.localhost on Windows.
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
    expect(connect).not.toContain("'self'");
    expect(connect.some((source) => source.startsWith("ws"))).toBe(false);
  });

  it("allows the editor's workers (same-origin chunks plus blob fallback)", () => {
    const directives = parseCsp(security.csp as string);
    // Vite emits the Monaco worker as a same-origin chunk
    // (`new Worker("/assets/editor.worker-*.js")`); the built bundle also ships
    // the Trusted-Types `createScriptURL` branch, which produces a blob: URL.
    expect(directives["worker-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("development-mode policy", () => {
  it("declares a separate dev policy instead of silently reusing production", () => {
    expect(security.devCsp).toBeTruthy();
    expect(security.devCsp).not.toBe(security.csp);
  });

  it("is exactly the reviewed dev policy", () => {
    expect(security.devCsp).toBe(DEVELOPMENT_CSP);
  });

  it("only loosens what the dev server needs", () => {
    const prod = parseCsp(PRODUCTION_CSP);
    const dev = parseCsp(DEVELOPMENT_CSP);
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());

    // Inline scripts: the React refresh preamble is injected by the dev server.
    expect(dev["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);

    // Extra connections are loopback-only HMR (http + websocket).
    const extra = dev["connect-src"].filter(
      (source) => !prod["connect-src"].includes(source),
    );
    expect(extra.sort()).toEqual([
      "http://127.0.0.1:1420",
      "http://localhost:1420",
      "ws://127.0.0.1:1420",
      "ws://localhost:1420",
    ]);
    for (const source of extra) {
      expect(source).toMatch(/^(https?|wss?):\/\/(127\.0\.0\.1|localhost):1420$/);
    }

    // Nothing else is looser: same object/frame/media lockdown, no remote host.
    for (const directive of [
      "default-src",
      "style-src",
      "img-src",
      "font-src",
      "worker-src",
      "object-src",
      "frame-src",
      "media-src",
      "base-uri",
      "form-action",
    ]) {
      expect(dev[directive]).toEqual(prod[directive]);
    }
  });
});

describe("webview capabilities", () => {
  it("is scoped to the main window only", () => {
    expect(capability.identifier).toBe("default");
    expect(capability.windows).toEqual(["main"]);
  });

  it("grants exactly the reviewed permissions", () => {
    expect(permissionRefs).toEqual(EXPECTED_PERMISSIONS);
  });

  it("removes renderer access to the keyring store (plaintext export)", () => {
    // Passwords are read by Rust commands (save/get_connection_password) that
    // use the plugin's backend API; the renderer never talks to it.
    expect(permissionRefs.filter((p) => p.startsWith("keyring-store:"))).toEqual([]);
    expect(permissionRefs.some((p) => p.includes("export-passwords"))).toBe(false);
  });

  it("removes unused opener powers", () => {
    // open-url / reveal-item-in-dir are unused; the opener plugin is not even
    // registered on the Tauri builder.
    expect(permissionRefs.filter((p) => p.startsWith("opener:"))).toEqual([]);
  });

  it("does not fall back to broad default permission sets", () => {
    for (const broad of [
      "core:default",
      "fs:default",
      "fs:read-all",
      "fs:write-all",
      "fs:allow-read-all",
      "dialog:default",
      "core:window:default",
      "core:event:default",
    ]) {
      expect(permissionRefs).not.toContain(broad);
    }
  });

  it("limits filesystem access to the three renderer file commands in use", () => {
    const fsPermissions = permissionRefs.filter((p) => p.startsWith("fs:"));
    expect(fsPermissions).toEqual([
      "fs:allow-read-text-file",
      "fs:allow-write-text-file",
      "fs:allow-write-file",
      "fs:scope",
    ]);
  });

  it("denies credential stores in the fs scope", () => {
    const scope = permissionEntries.find(
      (entry): entry is { identifier: string; allow?: string[]; deny?: string[] } =>
        typeof entry !== "string" && entry.identifier === "fs:scope",
    );
    expect(scope, "fs:scope must be declared with a deny list").toBeDefined();
    expect(scope?.deny).toEqual(EXPECTED_DENIED_PATHS);
    // Allow nothing statically: the native picker is the only path grant.
    expect(scope?.allow).toBeUndefined();
  });
});

describe("source index.html stays compatible with the policy", () => {
  // Markup inside an HTML comment is not parsed, so only real elements count.
  const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

  it("has no inline style element", () => {
    // Tauri rewrites every packaged <style> with a per-request nonce and adds
    // `'nonce-…'` to style-src. A nonce source makes the browser ignore
    // `'unsafe-inline'`, which would break Monaco's runtime stylesheets — so the
    // HTML must stay free of inline style blocks (the CSS bundle is a <link>).
    expect(stripComments(sourceIndexHtml)).not.toMatch(/<style[\s>]/i);
  });

  it("has no inline script", () => {
    // Same nonce reasoning for script-src; the app is a single external module.
    expect(stripComments(sourceIndexHtml)).not.toMatch(
      /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i,
    );
  });

  it("loads only local assets", () => {
    expect(stripComments(sourceIndexHtml)).not.toMatch(
      /(src|href)\s*=\s*["'](?:https?:)?\/\//i,
    );
  });
});

describe("policy documentation", () => {
  it("records the production policy, the capabilities, and the dev gap", () => {
    expect(policyAdr).toContain(PRODUCTION_CSP);
    expect(policyAdr).toContain("devCsp");
    expect(policyAdr).toMatch(/development-mode gap/i);
    expect(policyAdr).toContain("'unsafe-inline'");
    expect(policyAdr).toContain("keyring-store");
    expect(policyAdr).toContain("opener");
  });
});
