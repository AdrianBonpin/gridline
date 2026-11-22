import {
  DEMO_CONNECTION_NAME,
  READ_ONLY_SCRIPT,
  connectionCardSelector,
  destructiveDialogCancelSelector,
  destructiveDialogEscapeKey,
  destructiveDialogRunShortcut,
  destructiveDialogSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
  queryEditorSurfaceSelector,
  rerunQuerySelector,
  runQuerySelector,
} from "./expectations.mjs";
import { HarnessError } from "./errors.mjs";
import { pollUntil } from "./poll.mjs";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_INTERVAL_MS = 250;

/**
 * A real destructive script against a real seeded table.
 *
 * The flow cancels every confirmation, so it never executes; if a bug ever lets
 * it run unreviewed, the run fails loudly instead of quietly deleting demo rows
 * (each run also gets a pristine app-data directory).
 */
export const DESTRUCTIVE_SCRIPT = "DELETE FROM products;";

/**
 * Focus the query editor and type into it.
 *
 * Three measured facts drive this helper:
 *
 * 1. Monaco's real input is a 1x1 `textarea.inputarea` at `z-index:-10`, painted
 *    *behind* `.view-lines`. An element-targeted click on it is intercepted by
 *    `div.view-line` on every attempt (W3C: "element click intercepted"), so the
 *    harness must never click it.
 * 2. Element-targeted keys (`/element/{id}/value`) are refused too — WebKit
 *    answers "element not interactable: Element is not focusable" for that same
 *    hidden textarea.
 * 3. Typing into the *focused* element works, which is what a user does.
 *
 * So: click the rendered editor surface (a real hit target) to focus Monaco,
 * then send real keystrokes to the focused element.
 */
async function typeInEditor(driver, text, waitForElementFn, poll, label) {
  await waitForElementFn(driver, queryEditorInputSelector(), {
    ...poll,
    label: label ?? "query editor",
  });
  const surface = await waitForElementFn(driver, queryEditorSurfaceSelector(), {
    ...poll,
    label: "query editor surface",
  });
  await driver.click(surface);
  await driver.typeText(text);
}

export { typeInEditor };

/**
 * The real clock.
 *
 * `run.mjs` injects only the budget (`timeoutMs`/`intervalMs`), never a clock, so
 * a flow that calls `time.sleep(...)` directly needs a working default: the unit
 * fakes always supply one, which is how the missing default went unnoticed until
 * the built-product lane reached that step.
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clock(options) {
  return {
    sleep: options.sleep ?? defaultSleep,
    now: options.now,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    nowMs: options.now ?? (() => Date.now()),
  };
}

/** Wait for a CSS selector to match, polling while the webview boots. */
export function waitForElement(driver, selector, options) {
  const time = clock(options);
  return pollUntil(() => driver.findElement(selector), {
    timeoutMs: time.timeoutMs,
    intervalMs: time.intervalMs,
    label: options.label ?? `${JSON.stringify(selector)} never rendered`,
    sleep: time.sleep,
    now: time.now,
  });
}

/** Wait for a CSS selector to stop matching (a closed dialog is `null`). */
export function waitForAbsent(driver, selector, options) {
  const time = clock(options);
  return pollUntil(
    async () => ((await driver.findElement(selector)) ? null : true),
    {
      timeoutMs: time.timeoutMs,
      intervalMs: time.intervalMs,
      label: options.label ?? `${JSON.stringify(selector)} never went away`,
      sleep: time.sleep,
      now: time.now,
    },
  );
}

/**
 * Prove that a destructive script is confirmed from **both** the initial Run
 * button and the query tab's toolbar re-run control.
 *
 * This is the built-product counterpart of the viewer unit tests: the same
 * script reaches the database through two different Execution Entry Points, and
 * the confirmation dialog has to appear for each one. A missing prompt is a
 * harness failure with a message naming the entry point that skipped it.
 *
 * The driver is injected, so the whole flow is unit-testable with a fake;
 * `run.mjs` supplies the real WebDriver transport.
 */
export async function runDestructiveRerunFlow(driver, options = {}) {
  const {
    connectionName = DEMO_CONNECTION_NAME,
    script = DESTRUCTIVE_SCRIPT,
    readScript = READ_ONLY_SCRIPT,
  } = options;
  const time = clock(options);
  /** @type {Array<{name: string, durationMs: number}>} */
  const steps = [];
  const confirmedEntryPoints = [];
  const poll = { timeoutMs: time.timeoutMs, intervalMs: time.intervalMs, sleep: time.sleep, now: time.now };

  async function step(name, action) {
    const startedAt = time.nowMs();
    const value = await action();
    steps.push({ name, durationMs: time.nowMs() - startedAt });
    return value;
  }

  /** Click an entry point and require the destructive confirmation to appear. */
  async function confirmFor(entryPoint, selector) {
    const control = await waitForElement(driver, selector, {
      ...poll,
      label: `${entryPoint} control`,
    });
    await driver.click(control);
    try {
      await waitForElement(driver, destructiveDialogSelector(), {
        ...poll,
        label: "destructive-query confirmation dialog",
      });
    } catch (error) {
      throw new HarnessError(
        `${entryPoint} executed a destructive script without confirmation: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    confirmedEntryPoints.push(entryPoint);
  }

  /**
   * Require the open confirmation to survive a key sent while it is focused.
   *
   * A keyboard shortcut must not execute or relocate a pending confirmation, so
   * the dialog has to be exactly where it was afterwards. The keys are pressed
   * on the focused element (not element-targeted: the modal is a `div` and is
   * not focusable — the button inside it holds focus), which is exactly what a
   * user's keystroke is. The poll interval is waited out first: a shortcut that
   * consumed the confirmation renders it away asynchronously, so an immediate
   * check could read the stale dialog.
   */
  async function keepDialogOpen(entryPoint, keys, label) {
    await waitForElement(driver, destructiveDialogSelector(), {
      ...poll,
      label: `${entryPoint} confirmation dialog`,
    });
    // Pressed globally: the keys land on whatever holds focus, which — with the
    // confirmation up — must be inside the modal, never the editor behind it.
    await driver.pressChord(keys.key, keys.modifiers);
    await time.sleep(time.intervalMs);
    const stillOpen = await driver.findElement(destructiveDialogSelector());
    if (!stillOpen) {
      throw new HarnessError(
        `${label}: a keyboard shortcut consumed the pending confirmation — ` +
          `a shortcut must never execute or relocate it`,
      );
    }
  }

  /** Cancel the open confirmation with Escape and require it to close. */
  async function escapeFor(entryPoint) {
    await waitForElement(driver, destructiveDialogSelector(), {
      ...poll,
      label: `${entryPoint} confirmation dialog`,
    });
    await driver.pressChord(destructiveDialogEscapeKey().key);
    await waitForAbsent(driver, destructiveDialogSelector(), {
      ...poll,
      label: `Escape should cancel the ${entryPoint} pending confirmation`,
    });
  }

  /** Dismiss the open confirmation and require it to actually close. */
  async function cancelFor(entryPoint) {
    const cancel = await waitForElement(driver, destructiveDialogCancelSelector(), {
      ...poll,
      label: `${entryPoint} confirmation cancel button`,
    });
    await driver.click(cancel);
    await waitForAbsent(driver, destructiveDialogSelector(), {
      ...poll,
      label: `the ${entryPoint} confirmation should close on cancel`,
    });
  }

  try {
    const card = await step(`home: ${connectionName} card visible`, () =>
      waitForElement(driver, connectionCardSelector(connectionName), {
        ...poll,
        label: "demo connection card",
      }),
    );
    await step("home: open the demo database", () => driver.click(card));

    const newQuery = await step("workspace: open an ad-hoc query tab", () =>
      waitForElement(driver, newQueryTabSelector(), {
        ...poll,
        label: "New query tab button",
      }),
    );
    await driver.click(newQuery);

    // A result set has to exist before the toolbar — and with it the re-run
    // control — mounts (`DbViewerScreen` renders `TableControls` only for a tab
    // with data). A harmless read runs first, so the re-run assertion below is
    // reachable instead of silently skipping over a control that is not there.
    await step("reader: type a harmless read", () =>
      typeInEditor(driver, readScript, waitForElement, poll),
    );
    await step("run: the read executes without a confirmation", async () => {
      const run = await waitForElement(driver, runQuerySelector(), {
        ...poll,
        label: "Run query button",
      });
      await driver.click(run);
      // The re-run control only renders once the tab holds a result set, so
      // waiting for it proves the run completed and the toolbar is mounted.
      await waitForElement(driver, rerunQuerySelector(), {
        ...poll,
        label: "the result toolbar (Re-run query) after a successful read",
      });
      if (await driver.findElement(destructiveDialogSelector())) {
        throw new HarnessError(
          "a read-only script asked for destructive confirmation: only " +
            "data-modifying statements may prompt",
        );
      }
    });

    // The destructive statement is typed after the read, so the editor holds a
    // script the guard must stop — and the tab keeps its result set, which is
    // what makes the toolbar re-run reachable.
    await step("editor: type a destructive script", () =>
      typeInEditor(driver, ` ${script}`, waitForElement, poll),
    );

    await step("run: initial Run requires confirmation", async () => {
      await confirmFor("initial Run", runQuerySelector());
    });
    await step("run: cancel leaves the script unexecuted", () =>
      cancelFor("initial Run"),
    );

    await step("rerun: toolbar re-run requires confirmation again", async () => {
      await confirmFor("toolbar re-run", rerunQuerySelector());
    });

    // The built-product keyboard proof: with the confirmation open, the
    // editor's own run shortcut must reach neither the database nor a
    // different request…
    await step(
      "keyboard: the run shortcut cannot execute the pending confirmation",
      () =>
        keepDialogOpen(
          "toolbar re-run",
          destructiveDialogRunShortcut(),
          "run shortcut while a destructive confirmation is pending",
        ),
    );
    // …and Escape cancels the request it was raised for.
    await step("keyboard: Escape cancels the pending confirmation", () =>
      escapeFor("toolbar re-run"),
    );

    return {
      steps,
      confirmedEntryPoints,
      // What the run actually observed, so a passing log is evidence on its own.
      evidence: [
        `confirmation required from: ${confirmedEntryPoints
          .map((name) => JSON.stringify(name))
          .join(", ")}`,
        "keyboard: the run shortcut left the pending confirmation untouched",
        "keyboard: Escape cancelled the pending confirmation",
      ],
      passMessage:
        "both execution entry points required confirmation, the run shortcut could not execute the pending confirmation, and Escape cancelled it",
      script,
    };
  } catch (error) {
    // Attach completed steps so the failure report shows how far the app got.
    if (error && typeof error === "object") error.steps = steps;
    throw error;
  }
}
