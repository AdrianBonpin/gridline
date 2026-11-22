# 0002: Production content security policy and least-privilege webview capabilities

**Status:** Accepted
**Date:** 2026-11-21

## Context

Gridline renders its entire UI from a local bundle inside the OS webview, and that renderer drives a large IPC surface: connections, backups, restores, DDL, and file export. The packaged build previously shipped `app.security.csp: null`, so the webview had no content security policy at all, and `capabilities/default.json` granted every plugin's default permission set — including the keyring store's plaintext password export and the opener plugin's ability to launch arbitrary URLs and reveal arbitrary paths. Both were unused by the renderer, but a compromised renderer could reach them.

The policy cannot be copied from a generic template: the SQL editor (monaco-editor 0.56, bundled locally) creates `<style>` elements at runtime and fills them through `textContent`, and it runs on worker modules emitted as same-origin chunks. A policy that blocks either of those produces an editor that renders unstyled or silently fails to load its worker — the exact failure the audit asked us to avoid.

## Decision

The packaged build ships an explicit content security policy:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; media-src 'none'; base-uri 'self'; form-action 'none'
```

Each allowance, and why it cannot be narrower:

| Directive | Allowance | Justification |
| :--- | :--- | :--- |
| `default-src 'self'` | local bundle only | The frontend is a Vite build served from Tauri's custom protocol. No directive below opens a remote origin, so anything unlisted stays same-origin. |
| `script-src 'self'` | app + lazily imported chunks | The app is one external ES module plus dynamic imports. No inline script, no `eval`, no `new Function` (verified against the production bundle). |
| `style-src 'self' 'unsafe-inline'` | Tailwind bundle + runtime styles | monaco-editor injects `<style>` elements at runtime (`esm/vs/base/browser/domStylesheets.js` `createStyleSheet` sets `textContent`), which is an inline-style insertion. Without `'unsafe-inline'` the editor mounts unstyled and unmeasurable. |
| `img-src 'self' data:` | packaged images + inline data URIs | The bundled CSS embeds `data:image/svg+xml` (React Flow's background pattern) and `data:image/png`; the schema-visualizer export (`html-to-image`) produces `data:` images. |
| `font-src 'self'` | `@fontsource` woff2 chunks | Fonts are emitted as hashed files, not data URIs. |
| `connect-src ipc: http://ipc.localhost` | Tauri IPC only | Every `invoke` is a `fetch` to `ipc://localhost` (macOS/Linux) or `http://ipc.localhost` (Windows/Android). No remote host, no websocket in a packaged build. |
| `worker-src 'self' blob:` | Monaco workers | Vite emits the editor worker as a same-origin chunk (`new Worker("/assets/editor.worker-*.js")`); the bundled Monaco code additionally ships a Trusted-Types `createScriptURL` branch that yields a `blob:` URL on engines with Trusted Types (WebView2). |
| `object-src`, `frame-src`, `media-src` = `'none'` | nothing | The app embeds no plugins, frames, or media. |
| `base-uri 'self'`, `form-action 'none'` | nothing | No `<base>` rewriting and no form submissions exist. |

Because `'unsafe-inline'` must stay effective for `style-src`, the packaged HTML must not contain an inline `<style>` block: Tauri rewrites every packaged `<style>` with a per-request nonce and adds `'nonce-…'` to `style-src`, and per CSP a nonce or hash source makes the browser ignore `'unsafe-inline'`. The pre-paint background rule therefore lives in `src/index.css` (emitted as a `<link>` in the head of the production build) instead of an inline block in `index.html`. `desktop/src/lib/production-policy.test.ts` asserts that invariant on the source and on the built `dist/index.html`.

The webview capability file grants only what the renderer calls:

- `core:event:allow-listen`, `core:event:allow-unlisten` — backup/restore/stream-export progress events, SQL open-with notifications.
- `core:window:allow-set-title`, `allow-set-theme`, `allow-set-background-color`, `allow-start-dragging`, `allow-internal-toggle-maximize` — document title sync, appearance sync, and the macOS overlay drag strip plus its double-click maximize.
- `dialog:allow-open`, `dialog:allow-save` — the renderer asks the *backend* to show the native picker (`lib/commands.ts` → `select_file_for_grant`); what comes back is an authorization id plus display metadata, not a path the renderer can act on.

There is no `fs:` permission of any kind, and the `fs` plugin is not registered on the Tauri builder. Earlier revisions granted `fs:allow-read-text-file`, `fs:allow-write-text-file` and `fs:allow-write-file` for connection JSON import/export and the schema-visualizer image export, and tried to bound them with an `fs:scope` deny list (`$HOME/.ssh`, `$HOME/.aws`, `$HOME/.gnupg`, `$HOME/Library/Keychains`). That was the wrong boundary twice over: the deny list only enumerates the credential stores someone thought of (`~/.kube/config`, `~/.docker/config.json`, `~/.npmrc` stayed readable), and the underlying power — "read or write any path I name" — outlived the five-minute, single-use model the rest of the file flows use. Every file touch is now a Rust command that consumes a File Grant (`docs` → spec §"Tool jobs and file authorization": *raw paths are not authorization*): backup, restore, DB sync, data import, streamed export, settings import/export (`settings::export_settings_to_file` / `read_settings_file`), connection transfer (`commands::file_io::export_connections_to_file` / `read_connections_file`) and the schema image (`commands::file_io::save_granted_bytes`). The renderer produces the image bytes, but the *destination* is the grant's, never an argument.

Dropping the permission without dropping the plugin would have left a registered `plugin:fs|*` command surface that any future capability entry could re-enable, and dropping the plugin without dropping the permission would have left a capability pointing at no plugin. Both are removed, and `production-policy.test.ts` asserts each half: no `fs:` entry in the capability file, no `tauri_plugin_fs` in `src-tauri/src/lib.rs`, and no renderer source importing `@tauri-apps/plugin-fs`.

`keyring-store` and `opener` permissions are gone. Passwords are read and written by Rust commands (`save_connection_password` / `get_connection_password`) through the plugin's backend API, so the renderer never needs the keyring store's IPC surface — which includes plaintext export. The opener plugin is not registered on the Tauri builder at all, so even a future capability cannot reopen `open-url` / `reveal-item-in-dir`.

## Development-mode gap

Development is deliberately looser than production, and it is a separate `app.security.devCsp` entry rather than a silent fallback: `tauri dev` serves the page from `http://localhost:1420`, injects the React refresh preamble as an inline script, and pushes HMR updates over a websocket. `devCsp` therefore adds `'unsafe-inline'` to `script-src` and the four loopback HMR origins (`http://localhost:1420`, `http://127.0.0.1:1420`, `ws://localhost:1420`, `ws://127.0.0.1:1420`) to `connect-src`; every other directive is identical to production.

Two consequences follow. First, dev-mode success is not evidence that the packaged policy works — verification belongs to a production build (`bun run --filter gridline-desktop build` and the desktop build). Second, a remote dev host (`TAURI_DEV_HOST`) or a changed dev port needs `devCsp` edited on purpose; it will not work by accident, and it cannot widen the packaged policy.

## Consequences

A compromised renderer can still call the app's own IPC commands (they are how the app works), but it can no longer load remote code, reach a remote origin, evaluate strings, read or export keychain secrets directly, open arbitrary URLs or paths, or read and write files itself at all. The only way a file is touched is a Rust command that consumes a backend-issued File Grant: intent-scoped, single-job, consumed on first use, and five minutes after the user made the selection. Any new renderer dependency or feature that needs a different source — a websocket, a CDN font, a new file command, a plugin permission — now fails at runtime and must be added to `tauri.conf.json` or the capability file with the reasoning recorded here. The pinned policy in `desktop/src/lib/production-policy.test.ts` turns that review into a test failure instead of a silent widening.
