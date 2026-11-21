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
| `--flow <name>` | `demo-smoke` | which registered flow to run (`demo-smoke`, `destructive-rerun`, `composite-edit`) |
| `--artifacts <dir>` | `e2e-artifacts` | where logs/screenshots are written |
| `--timeout-ms <ms>` | `30000` | per-step budget |
| `--port` / `--native-port` | `4444` / `4445` | driver ports |

## Flows

`--flow <name>` selects one; `demo-smoke` is the default.

| Flow | Command | What it proves |
| :--- | :--- | :--- |
| `demo-smoke` (default) | `bun run e2e:desktop` | the built app opens the seeded demo database and paints real rows |
| `destructive-rerun` | `bun run e2e:desktop -- --flow destructive-rerun` | a destructive script is confirmed from **both** the initial Run button and the toolbar re-run control — the built-product proof that the entry point cannot bypass the guard |
| `composite-edit` | `bun run e2e:desktop -- --flow composite-edit` | editing one row of a composite-primary-key table changes exactly that row |

### `composite-edit` — Row Identity

`order_items` is keyed by `(order_id, product_id)`, and its first two rendered
rows share `order_id`. The flow therefore proves the thing a single-column key
would break:

1. open the demo database and `order_items`;
2. assert the precondition that the first two rendered rows share the first key
   column (without a sibling row the run would prove nothing and fails);
3. snapshot every rendered cell;
4. double-click the `quantity` cell of the first row, clear it, type the next
   value, press Enter (a real cell edit, staged in the changes queue);
5. open the changes queue and click **Commit All** (the real commit path —
   `[data-testid="changes-queue-toggle"]` → `[data-testid="commit-all"]`);
6. re-snapshot the grid and require **exactly one rendered cell to have
   changed**, and that cell to be the edited one.

A commit that also rewrote the sibling row that shares `order_id` changes two
cells, so step 6 fails with both diffs named. A commit that changed nothing, or
changed the wrong cell, fails too.

## What the smoke flow asserts

1. `home: Gridline Demo (SQLite) card visible` — the app rendered the Home
   screen with the connection its seeder created.
2. `home: open the demo database` — clicking the card opens the viewer.
3. `explorer: products listed in the table tree` — the introspected demo tables
   reached the UI.
4. `explorer: open products` — a table tab opens.
5. `grid: seeded products rows visible` — rendered **cells of data rows** expose
   the seeded values (`GL-MSE-001`, `Gridline Wireless Mouse`) through the
   WebDriver attribute endpoint.

Step 5 is the point of the harness: a live process, a mapped window, and even a
mounted grid are not proof. Only rendered seeded data is. A passing run prints
what it saw, so the job log is evidence on its own rather than just the word
`PASS`:

```
e2e: ok grid: seeded products rows visible (260ms)
e2e: grid observed 288 rendered cell(s), e.g. "3", "GL-HUB-001", "Gridline 7-in-1 USB-C Hub", …
e2e: fixture values rendered in the grid: "GL-MSE-001", "Gridline Wireless Mouse"
e2e: PASS the built app rendered the seeded demo rows
```

## What the destructive re-run flow asserts

1. `home: Gridline Demo (SQLite) card visible` / `home: open the demo database`
2. `workspace: open an ad-hoc query tab` — the tab bar's *Query* button.
3. `editor: type a destructive script` — `DELETE FROM products;` typed through
   Monaco's hidden input area (`[data-testid="query-editor"] textarea.inputarea`),
   which is the element the editor listens on. The editor is clicked first for
   focus.
4. `run: initial Run requires confirmation` — the `Destructive Query` dialog
   (`[data-testid="destructive-query-dialog"]`) must appear.
5. `run: cancel leaves the script unexecuted` — cancelling closes the dialog.
6. `rerun: toolbar re-run requires confirmation again` — the toolbar's re-run
   control (`button[aria-label="Re-run query"]`) must raise the *same* dialog.
   This is the assertion the flow exists for.
7. `rerun: cancel leaves the script unexecuted`.

Every confirmation is cancelled, so the script never executes; each run also
gets a pristine app-data directory. If any entry point executes without the
dialog, the flow fails naming that entry point (`initial Run executed a
destructive script without confirmation` / `toolbar re-run executed …`), so a
regression cannot be mistaken for a pass.

### Why the grid assertion reads attributes, not text

`WebKitWebDriver`'s `GET /element/{id}/text` returns inline content only. Every
cell in `VirtualDataGrid` renders its value as a bare text node inside a block
`<div>`, so `/text` answers `""` for a perfectly rendered grid (header labels,
which are wrapped in a `<span>`, do report text — which is why a text-based
assertion looked plausible and then failed forever). The cell's own `title`
attribute carries exactly what the user sees, and
`GET /element/{id}/attribute/title` reports it:

```
[role="grid"] /text:        len=377  contains sku=false
[data-index="1"] /text:     len=10   "{ 4 keys }"
[title="GL-MSE-001"] /text: len=0    ""
      .../attribute/title = "GL-MSE-001"
```

So [`gridContent.mjs`](./gridContent.mjs) scope-asserts on cells of data rows
(`[role="grid"] [data-index] > div`, header cells excluded), reads each cell's
`title` (falling back to `/text` for cells without one), and requires every
expected fixture value to appear on a rendered cell. Page source is **never** an
assertion path — a value can sit in the DOM without being painted — it is only
quoted in the failure message to distinguish "not painted" from "not loaded".

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
   `waitForElement` (see [`smokeFlow.mjs`](./smokeFlow.mjs)). For grid content
   use `waitForRenderedCells` ([`gridContent.mjs`](./gridContent.mjs)) instead of
   `elementText`. The driver is injected, so the flow itself is unit-testable
   with a fake.
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
