# Desktop end-to-end harness

Built-product coverage for Gridline: the harness launches the **real, built
(non-AppImage) desktop binary**, drives its webview through the supported Tauri
WebDriver path (`tauri-driver` → `WebKitWebDriver`), opens the demo database the
app seeds on first launch, and asserts that demo rows are actually rendered in
the data grid.

It is deliberately not a browser-only mock: the app process, its Tauri commands,
its local store, and the seeded SQLite demo file are all the production code
paths. What it cannot see is packaged-artifact behavior (AppImage) and real
hardware — those stay in the packaged-smoke lane.

## Platform support

| Platform | Status | Why |
| :--- | :--- | :--- |
| Linux | supported | `tauri-driver` + `WebKitWebDriver`, headless via Xvfb |
| Windows | supported | `tauri-driver` + `msedgedriver` |
| macOS | **not supported** | `tauri-driver` itself refuses to run here — there is no WKWebView WebDriver to drive an arbitrary app. The harness fails with that explanation instead of pretending to pass. |

The embedded-WebDriver route that does work on macOS requires a Tauri plugin in
the production build; this repo does not add production automation plugins for
tests.

## Prerequisites (Linux)

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb
cargo install tauri-driver --locked
bun install --frozen-lockfile
```

## Commands

```bash
bun run e2e:desktop:build   # tauri build --no-bundle → src-tauri/target/release/gridline
bun run e2e:desktop         # launch that binary and run the demo-smoke flow
```

`bun run e2e:desktop` is the single documented launch command. Without
`DISPLAY` it re-executes itself under `xvfb-run -a`, so no separate display
setup is needed on a headless Linux box. Useful flags (`bun run e2e:desktop --
--help`):

| Flag | Default | Purpose |
| :--- | :--- | :--- |
| `--binary <path>` | `src-tauri/target/release/gridline` | binary to launch (`GRIDLINE_E2E_BINARY` also works) |
| `--flow <name>` | `demo-smoke` | which registered flow to run |
| `--artifacts <dir>` | `e2e-artifacts` | where logs/screenshots are written |
| `--timeout-ms <ms>` | `30000` | per-step budget |
| `--port` / `--native-port` | `4444` / `4445` | driver ports |

## What the smoke flow asserts

1. `home: Gridline Demo (SQLite) card visible` — the app rendered the Home
   screen with the connection its seeder created.
2. `home: open the demo database` — clicking the card opens the viewer.
3. `explorer: products listed in the table tree` — the introspected demo tables
   reached the UI.
4. `explorer: open products` — a table tab opens.
5. `grid: seeded products rows visible` — the grid's rendered **text** contains
   seeded cell values (`GL-MSE-001`, `Gridline Wireless Mouse`).

Step 5 is the point of the harness: a live process, a mapped window, and even a
mounted grid are not proof. Only rendered seeded data is.

The expected connection name, table and cell values live in
[`expectations.mjs`](./expectations.mjs) and are checked against the seeder
(`commands/demo.rs`, `commands/demo_schema.sql`) by `expectations.test.ts`, so a
fixture rename cannot silently turn the assertion into a no-op.

## Failure evidence

Every run gets a fresh app-data directory inside the artifacts folder
(`XDG_DATA_HOME=<artifacts>/app-data` on Linux), so the demo database and local
store are created by the app itself on each run.

On failure the job keeps, under `e2e-artifacts/`:

- `launch.log` — everything `tauri-driver`/WebKitWebDriver (and the app, through
  them) printed, streamed live;
- `failure.txt` — the failing step's message, the steps that did complete, and
  why anything could not be captured;
- `screenshot.png` — the live webview, when a session existed;
- `page-source.html` — the DOM at failure time;
- `display.png` — a screenshot of the X display via ImageMagick `import`, used
  when the app never produced a window/session.

A failed launch, a missing window, or absent grid content exits non-zero, so the
job fails. CI uploads the folder with `if: failure()`.

## Environment knobs

| Variable | Purpose |
| :--- | :--- |
| `DISPLAY` | drive an existing X display (otherwise `xvfb-run`) |
| `GRIDLINE_E2E_BINARY` | binary to launch instead of `--binary` |
| `WEBKIT_DISABLE_DMABUF_RENDERER` | defaults to `1` in this harness only: the CI runner has no GPU and WebKitGTK otherwise paints nothing under Xvfb. Override to `0` to test the renderer path. |

## Adding a flow (later tickets)

1. Write the flow as an async function `(driver, {timeoutMs, intervalMs}) =>
   { steps, ... }` using the `WebDriverClient` interface and `pollUntil` /
   `waitForElement` (see [`smokeFlow.mjs`](./smokeFlow.mjs)). The driver is
   injected, so the flow itself is unit-testable with a fake.
2. Register a short description in `FLOWS` ([`preflight.mjs`](./preflight.mjs))
   and the runner in `FLOW_RUNNERS` ([`run.mjs`](./run.mjs)).
3. If the flow needs a stable DOM anchor, add a `data-testid`/`data-*` attribute
   to the component and pin it in that component's own test (see
   `ConnectionCard.test.tsx`, `TableTree.test.tsx`).

## Tests

The harness's own logic (waiting, retry budgets, W3C request/error mapping,
driver lifecycle, preflight rules, artifacts, flow orchestration and CI wiring)
is covered by vitest and runs with the normal frontend suite:

```bash
cd desktop && bunx vitest run e2e
```

No test fakes a passing browser run: what is unit-tested is the orchestration
around the driver, and the real browser leg only ever runs on a supported
platform.
