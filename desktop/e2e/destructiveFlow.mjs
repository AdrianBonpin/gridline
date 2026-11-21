import {
  DEMO_CONNECTION_NAME,
  connectionCardSelector,
  destructiveDialogCancelSelector,
  destructiveDialogEscapeKey,
  destructiveDialogRunShortcut,
  destructiveDialogSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
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

function clock(options) {
  return {
    sleep: options.sleep,
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
  const { connectionName = DEMO_CONNECTION_NAME, script = DESTRUCTIVE_SCRIPT } =
    options;
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
   * Require the open confirmation to survive a key sent to it.
   *
   * A keyboard shortcut must not execute or relocate a pending confirmation, so
   * the dialog has to be exactly where it was afterwards. The poll interval is
   * waited out first: a click/shortcut that consumed the confirmation renders
   * it away asynchronously, so an immediate check could read the stale dialog.
   */
  async function keepDialogOpen(entryPoint, key, label) {
    const dialog = await waitForElement(driver, destructiveDialogSelector(), {
      ...poll,
      label: `${entryPoint} confirmation dialog`,
    });
    await driver.sendKeys(dialog, key);
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
    const dialog = await waitForElement(driver, destructiveDialogSelector(), {
      ...poll,
      label: `${entryPoint} confirmation dialog`,
    });
    await driver.sendKeys(dialog, destructiveDialogEscapeKey());
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

    await step("editor: type a destructive script", async () => {
      const input = await waitForElement(driver, queryEditorInputSelector(), {
        ...poll,
        label: "query editor",
      });
      // Monaco listens on its hidden input area; clicking focuses it first.
      await driver.click(input);
      await driver.sendKeys(input, script);
    });

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
