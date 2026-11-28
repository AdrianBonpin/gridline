# Desktop end-to-end harness

Built-product coverage for Gridline. There are two lanes, because they answer
different questions:

- **WebDriver lane** ([`run.mjs`](./run.mjs), this README's main subject) launches
the **real, built (non-AppImage) desktop binary** and drives its webview through
the supported Tauri WebDriver path (`tauri-driver` → `WebKitWebDriver`), opening
the demo database the app seeds on first launch and asserting that demo rows are
actually rendered in the data grid.
- **AppImage lane** ([`appimageSmoke.mjs`](./appimageSmoke.mjs)) launches the
**packaged `Gridline_*.AppImage`** through its normal launcher on a headless X
display and asserts a mapped, painted window. See
[Packaged AppImage smoke](#packaged-appimage-smoke-separate-lane).

Both are deliberately not browser-only mocks: the app process, its Tauri
commands, its local store, and the seeded SQLite demo file are all the production
code paths. What neither can see is the reporter's hardware, session compositor,
or vendor drivers — those stay open in issue #62.

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
| `--flow <name>` | `demo-smoke` | which registered flow to run (`demo-smoke`, `destructive-rerun`, `composite-edit`, `sqlite-rebuild`) |
| `--list-flows` | — | print every registered flow name (one per line) and exit; no binary, display, or driver needed. CI loops over this, so registering a flow gives it a lane |
| `--artifacts <dir>` | `e2e-artifacts` | where logs/screenshots are written |
| `--timeout-ms <ms>` | `30000` | per-step budget |
| `--port` / `--native-port` | `4444` / `4445` | driver ports |

## Flows

`--flow <name>` selects one; `demo-smoke` is the default.

| Flow | Command | What it proves |
| :--- | :--- | :--- |
| `demo-smoke` (default) | `bun run e2e:desktop` | the built app opens the seeded demo database and paints real rows |
| `destructive-rerun` | `bun run e2e:desktop -- --flow destructive-rerun` | a destructive script is confirmed from **both** the initial Run button and the toolbar re-run control, and the pending confirmation survives a run shortcut but is cancelled by Escape — the built-product proof that neither the entry point nor the keyboard can bypass or relocate the guard |
| `composite-edit` | `bun run e2e:desktop -- --flow composite-edit` | editing one row of a composite-primary-key table changes exactly that row |
| `sqlite-rebuild` | `bun run e2e:desktop -- --flow sqlite-rebuild` | a SQLite rebuild is refused before staging for a shape it cannot reproduce, and completes as one change (keeping every row) for a shape it can |

### `sqlite-rebuild` — atomic rebuild or refusal

A SQLite rebuild either completes as one change or changes nothing, and the flow
proves both halves against the built product:

1. **Refused before mutation.** The demo's `order_items` carries a composite
   primary key, a CHECK, foreign keys, and an explicit index. The rebuild script
   now preserves all of them, so a refusal only happens when the edit itself
   breaks a preserved object: the flow drops `product_id` — named by
   `idx_order_items_product_id` — through the editor's
   `[aria-label="Remove column"]`, and the editor must show its refusal banner
   (`[data-testid="rebuild-refusal"]`) naming that index *and the dropped
   column*, keep `[data-testid="table-form-stage"]` **disabled**, and leave the
   changes queue empty. Dropping a column nothing preserved names (`unit_price`)
   is a rebuild the guard legitimately allows, so it cannot be the fixture — the
   backend test `sqlite_rebuild_guard_refuses_dropping_the_demo_index_column`
   pins both halves.
2. **Completed atomically.** The flow creates its own rebuildable table through
   the query workspace (`CREATE TABLE e2e_rebuild (id INTEGER PRIMARY KEY, label
   TEXT NOT NULL, note TEXT)` plus two seeded rows; the `CREATE` goes through the
   destructive confirmation like any other schema change), then drops its last
   column in the editor and stages the rebuild. No refusal appears, **Commit
   All** applies it, and the reopened table must still render both rows'
   remaining values while the dropped column's values are gone.

A table that renders fewer rows after the commit fails the `grid: the rebuilt
table still shows every row` step — which is exactly what a rebuild that is not
one transaction looks like from the outside.

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
3. `reader: type a harmless read` / `run: the read executes without a
   confirmation` — `SELECT count(*) AS n FROM products;` runs first, because the
   toolbar (and with it the re-run control) only mounts for a tab that holds a
   result set (`DbViewerScreen` renders `TableControls` behind
   `activeTab?.data`). Waiting for `button[aria-label="Re-run query"]` here is
   what makes the re-run assertion below reachable instead of asserting on a
   control that cannot exist yet; a read that prompts for confirmation fails.
4. `editor: type a destructive script` — `DELETE FROM products;` is typed as
   real keystrokes into the focused editor, after clicking the rendered editor
   surface. Monaco's hidden input area is never clicked and never the target of
   element-scoped keys — see "Never click Monaco's input area" below.
5. `run: initial Run requires confirmation` — the `Destructive Query` dialog
   (`[data-testid="destructive-query-dialog"]`) must appear.
6. `run: cancel leaves the script unexecuted` — cancelling closes the dialog.
7. `rerun: toolbar re-run requires confirmation again` — the toolbar's re-run
   control (`button[aria-label="Re-run query"]`) must raise the *same* dialog.
   This is the assertion the flow exists for.
8. `keyboard: the run shortcut cannot execute the pending confirmation` —
   Control+Enter (`\uE009` held, then `\uE007`) is pressed as a real **chord** on
   the focused element, and the dialog must still be there afterwards. The modal
   moves focus to its Cancel button when it opens, so a focused keystroke lands
   inside the confirmation, not in the editor behind it: it neither executed the
   script nor replaced the pending request with a different one.
9. `keyboard: Escape cancels the pending confirmation` — Escape (`\uE00C`)
   pressed on the focused element must close it, leaving the script unexecuted.

Every confirmation is cancelled, so the script never executes; each run also
gets a pristine app-data directory. If any entry point executes without the
dialog, the flow fails naming that entry point (`initial Run executed a
destructive script without confirmation` / `toolbar re-run executed …`); if a
shortcut consumes the pending dialog it fails with `a keyboard shortcut
consumed the pending confirmation`; and if Escape does nothing it fails with
`Escape should cancel the … pending confirmation`. A regression therefore names
the behavior that broke instead of being mistaken for a pass.

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

## Packaged AppImage smoke (separate lane)

A packaged AppImage is not a WebDriver target, so this lane is its own entry
point: [`appimageSmoke.mjs`](./appimageSmoke.mjs). It launches the **real
`Gridline_*.AppImage` through its normal launcher** — `./Gridline_*.AppImage`, or
AppImage's documented `--appimage-extract-and-run` path on hosts without FUSE —
and never an inner binary extracted from it
(`assertPackagedLauncher` refuses a `squashfs-root/…` or non-`.AppImage` path,
which is exactly the failure mode where "it starts" would otherwise mean
nothing).

```bash
# from the repo root, against a downloaded release artifact
bun run e2e:appimage -- --appimage ./Gridline_0.8.4_amd64.AppImage

# what it needs on Linux
sudo apt-get install -y xvfb xdotool x11-utils imagemagick libfuse2 \
  libegl1 libgles2 libgl1
```

The GL packages are not optional. The packaged image bundles GTK3 and WebKitGTK
but **not** `libEGL`/`libGL`: linuxdeploy excludes driver-provided GL libraries on
purpose, and the `.deb` declares the same host contract (`Depends:
libwebkit2gtk-4.1-0, libgtk-3-0`), which a desktop install satisfies through its
graphics stack. A bare runner has no GL stack at all, and the app then dies at
startup with `libEGL.so.1: cannot open shared object file` — which the lane
reports as a missing shared library, not as a paint failure.

It is **not** registered in `FLOWS`/`FLOW_RUNNERS` — that registry is the
WebDriver flows, driven by `tauri-driver` and a WebDriver session. Adding this
lane there would make `preflight` claim a driver it never uses.

### What it asserts

1. **A mapped window at the configured size.** The window is found through
   `xdotool search --name <title>` and measured with `xwininfo`; the expected
   title and size come from `desktop/src-tauri/tauri.conf.json` (±48px, so a
   decoration difference does not fail a correct build). A window that never
   appears, never becomes `IsViewable`, or is the wrong size fails.
2. **Painted content, measured against the background.** Gridline is
   dark-themed (`#0A0A0B` canvas), so "mostly black" is the healthy state and a
   naive black-pixel check would false-fail every correct build. A frame passes
   only when it has at least 8 distinct colour buckets, at least 0.4% of its
   pixels are content rather than the dominant background colour, that content
   spans at least 8 sampled rows, and at least 0.15% of pixels are bright. A
   uniform frame, a single stripe, a solid block and a border-only frame all fail
   — with the measured numbers in the failure message.

   There is deliberately **no** ceiling on how much of the window one colour may
   cover. The theme follows the OS, so the real v0.9.2 AppImage on a
   light-preference host renders the complete home screen with `#fafafa` covering
   97.64% of an empty workspace; a share ceiling rejected that painted frame as
   "blank". Content, not background share, is the discriminator.
3. **No known-fatal renderer/web-process diagnostics.** A crashed or
   unstartable `WebKitWebProcess`, a WebKit sandbox (`bwrap`) failure, a GTK/X
   fatal, a Rust panic, a signal death, or a missing shared library fails the
   run even if a window painted. GBM/EGL noise is reported as a warning and left
   to the paint assertion.
4. **A FUSE/container mount problem is reported separately.** If the image could
   not mount, the lane fails with `MOUNT` and exit code **2** instead of being
   recorded as a rendering bug; a rendering failure exits **1**.

### Flags

| Flag | Default | Purpose |
| :--- | :--- | :--- |
| `--appimage <path>` | `GRIDLINE_APPIMAGE` | the packaged `.AppImage` to launch |
| `--artifacts <dir>` | `e2e-artifacts/appimage` | where logs/screenshot/summary go |
| `--timeout-ms <ms>` | `90000` | budget for the window to appear |
| `--paint-timeout-ms <ms>` | `30000` | extra budget for it to paint |
| `--interval-ms <ms>` | `500` | poll interval |
| `--extract-and-run` | auto (FUSE probe) | force AppImage's documented no-FUSE path |
| `--pristine` | off | add **no** graphics flags (informational lane) |

Without `DISPLAY` the smoke re-executes itself under `xvfb-run` with a
`1440x900x24` screen. The blocking run adds `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
`LIBGL_ALWAYS_SOFTWARE=1` and `GDK_BACKEND=x11` **inside the harness only** (a CI
runner has no GPU); `--pristine` is the same check with none of them, which is
closer to a user session and is therefore informational rather than blocking.

### Where it runs

`.github/workflows/appimage-smoke.yml` runs it three ways:

| Trigger | Artifact | Blocking |
| :--- | :--- | :--- |
| nightly `schedule` | latest **published** release's AppImage | yes |
| `workflow_dispatch` | a named release tag, or the latest published release | yes |
| `workflow_run` after **Release** | the `appimage-linux-x86_64` artifact that run built, falling back to the published asset for that run's tag | yes |

Each trigger also runs the pristine (informational) variant and a Fedora
container variant. **The Fedora run is cross-distribution compatibility coverage,
not a reproduction of issue #62**: it is a container on a GitHub runner, with no
FUSE (`--extract-and-run`), no compositor and no GPU, so it can never stand in
for the reporter's Fedora session. It is labelled that way in the workflow and is
`continue-on-error`.

**This lane can never close issue #62.** It is a built-product seam: it catches a
packaged artifact that fails to map or paint under a headless software-rendered
display, and it misses the reporter's hardware, session type, compositor and
vendor drivers. A green run — including a green Fedora run — is not evidence
that #62 is resolved; only the reporter or an equivalent Fedora environment can
confirm that.

### Artifacts and exit codes

Every run writes `launch.log` (the app's own stdout/stderr), and then either
`summary.txt` (with the frame statistics the verdict rested on) or `failure.txt`
(classification, reasons, and the app's last words) plus `window.png`. Exit code
`0` = painted window, `1` = no window / wrong size / unpainted / fatal
diagnostic, `2` = mount/FUSE problem.

## Failure evidence (WebDriver lane)

### Never click Monaco's input area

Monaco listens on a hidden `textarea.inputarea`, but that element is a **1x1
pixel target at `z-index:-10` painted behind `.view-lines`**. Measured on the
built app: its rect is `{x:406, y:76, w:1, h:1}` and the hit target at its
center is `div.view-line`, so a W3C element-targeted click is answered with
`element click intercepted` on every attempt — a flow that clicks it can never
pass. Element-scoped keys (`POST /element/{id}/value`) are refused for the same
element too: WebKit answers `element not interactable: Element is not focusable`.

So both editor flows click the rendered surface
(`[data-testid="query-editor"] .monaco-editor .view-lines`, a real hit target,
which is also what a user clicks) and then type through the W3C actions endpoint
(`WebDriverClient.typeText`), which sends real keystrokes to the focused
element. Keyboard chords go through the same endpoint
(`WebDriverClient.pressChord`), because element-scoped keys cannot hold a
modifier across a second key. Both flows' fakes reject a click on the input area
and reject typing without editor focus, so a regression fails in unit tests too.

Every run gets a fresh app-data directory inside the artifacts folder
(`XDG_DATA_HOME=<artifacts>/app-data` on Linux, `APPDATA=<artifacts>/app-data` on
Windows; the AppImage lane also pins `HOME=<artifacts>/home`), so the demo
database and local store are created by the app itself on each run.

That guarantee is enforced, not assumed: before launching, the harness removes
those app-data locations and nothing else. Running a flow twice into the same
`--artifacts` directory therefore behaves the same both times — reproducing a CI
failure locally does not require deleting the directory first — while the
artifacts directory itself is never removed. A location that does not resolve
strictly beneath the artifacts directory refuses the run with the path named,
instead of deleting something the harness did not create.

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

## CI lane

`.github/workflows/ci.yml` (`desktop-e2e`) runs **every registered flow**, not a
hand-written subset: it asks the harness for the registry
(`bun desktop/e2e/run.mjs --list-flows`), launches the app once per flow with its
own artifacts folder (`e2e-artifacts/<flow>`), and fails the job if any flow
fails while still running the rest — so one red flow cannot hide the others.
An empty registry fails the step rather than looping zero times.

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

> A packaged-artifact check is **not** a flow: it has no WebDriver session, so it
> belongs in [`appimageSmoke.mjs`](./appimageSmoke.mjs) (or a sibling entry point)
> rather than in the `FLOWS`/`FLOW_RUNNERS` registry.
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

The AppImage lane is covered the same way, without a display: the frame analysis
(`appimageAnalysis.test.ts` — colour diversity, bright-pixel ratio, fatal-log
signatures, mount-vs-render classification), the X11 parsing
(`appimageWindow.test.ts`), the launch plan and orchestration
(`appimageSmoke.test.ts`, with fake X tools and a fake app process) and its CI
wiring (`appimageWiring.test.ts`). The blank-window cases are assertions, not
comments: a uniform dark frame, a pure-black frame and a dark frame with a
handful of stray bright pixels must all fail.
