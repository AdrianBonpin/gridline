import { describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  DEMO_CONNECTION_NAME,
  connectionCardSelector,
  destructiveDialogCancelSelector,
  destructiveDialogConfirmSelector,
  destructiveDialogEscapeKey,
  destructiveDialogRunShortcut,
  destructiveDialogSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
  rerunQuerySelector,
  runQuerySelector,
} from "./expectations.mjs";
import {
  DESTRUCTIVE_SCRIPT,
  runDestructiveRerunFlow,
} from "./destructiveFlow.mjs";

const CARD = connectionCardSelector();
const NEW_QUERY = newQueryTabSelector();
const EDITOR = queryEditorInputSelector();
const RUN = runQuerySelector();
const RERUN = rerunQuerySelector();
const DIALOG = destructiveDialogSelector();
const CANCEL = destructiveDialogCancelSelector();
const CONFIRM = destructiveDialogConfirmSelector();
const ESCAPE = destructiveDialogEscapeKey();
const RUN_SHORTCUT = destructiveDialogRunShortcut();

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

const flush = () => Promise.resolve();

/**
 * Stand-in for the real webview: the confirmation dialog materializes only
 * after a Run/Re-run click, and only while it has not been cancelled, exactly
 * like `DestructiveQueryDialog` (which returns `null` while closed).
 */
function fakeDriver(
  options: {
    dialogNeverOpensFor?: "run" | "rerun";
    /** Simulates a bug where a shortcut silently confirms the request. */
    shortcutConsumesDialog?: boolean;
    /** Simulates a dialog that ignores Escape. */
    ignoresEscape?: boolean;
  } = {},
) {
  const clicks: string[] = [];
  const typed: string[] = [];
  const dialogKeys: string[] = [];
  const {
    dialogNeverOpensFor = null,
    shortcutConsumesDialog = false,
    ignoresEscape = false,
  } = options;
  let dialogOpen = false;
  let editorReady = false;

  return {
    async findElement(selector: string) {
      const found = (elementId: string) => ({ elementId });
      switch (selector) {
        case CARD:
          return found("card");
        case NEW_QUERY:
          return found("new-query");
        case EDITOR:
          return editorReady ? found("editor") : null;
        case RUN:
          return found("run");
        case RERUN:
          return found("rerun");
        case DIALOG:
          return dialogOpen ? found("dialog") : null;
        case CANCEL:
          return dialogOpen ? found("dialog-cancel") : null;
        case CONFIRM:
          return dialogOpen ? found("confirm") : null;
        default:
          return null;
      }
    },
    async sendKeys(element: { elementId: string }, text: string) {
      if (element.elementId === "dialog") {
        // Keys sent to the modal go to the modal: Escape cancels it, and the
        // editor's run shortcut reaches the editor not at all.
        dialogKeys.push(text);
        if (text === ESCAPE && !ignoresEscape) dialogOpen = false;
        if (text === RUN_SHORTCUT && shortcutConsumesDialog) dialogOpen = false;
        return;
      }
      typed.push(text);
      editorReady = true;
    },
    async click(element: { elementId: string }) {
      clicks.push(element.elementId);
      if (element.elementId === "new-query") {
        // The editor mounts once the query tab opens.
        await Promise.resolve();
        editorReady = true;
      }
      if (element.elementId === "run" && dialogNeverOpensFor !== "run") {
        dialogOpen = true;
      }
      if (element.elementId === "rerun" && dialogNeverOpensFor !== "rerun") {
        dialogOpen = true;
      }
      if (element.elementId === "dialog-cancel") {
        dialogOpen = false;
      }
    },
    async elementText() {
      return "";
    },
    async getAttribute() {
      return null;
    },
    async screenshot() {
      return "iVBORw0KGgo=";
    },
    async pageSource() {
      return "<html><body>fake</body></html>";
    },
    async deleteSession() {},
    clicks,
    typed,
    dialogKeys,
    get dialogOpen() {
      return dialogOpen;
    },
    closeDialog() {
      dialogOpen = false;
    },
  };
}

const options = () => {
  const clock = fakeClock();
  return {
    intervalMs: 100,
    timeoutMs: 5_000,
    sleep: clock.sleep,
    now: clock.now,
  };
};

describe("runDestructiveRerunFlow", () => {
  it("confirms the initial run and then confirms the toolbar re-run again", async () => {
    const driver = fakeDriver();
    const flowOptions = options();

    // `flush` keeps the fake honest about async click handlers.
    const result = await runDestructiveRerunFlow(driver, flowOptions);
    await flush();

    expect(driver.typed).toEqual([DESTRUCTIVE_SCRIPT]);
    expect(driver.clicks).toEqual([
      "card",
      "new-query",
      "editor",
      "run",
      "dialog-cancel",
      "rerun",
    ]);
    expect(result.confirmedEntryPoints).toEqual(["initial Run", "toolbar re-run"]);
    expect(result.evidence).toEqual([
      'confirmation required from: "initial Run", "toolbar re-run"',
      "keyboard: the run shortcut left the pending confirmation untouched",
      "keyboard: Escape cancelled the pending confirmation",
    ]);
    expect(result.passMessage).toMatch(/both execution entry points/);
    // The keys went to the modal, never to the editor.
    expect(driver.dialogKeys).toEqual([RUN_SHORTCUT, ESCAPE]);
    expect(driver.typed).toEqual([DESTRUCTIVE_SCRIPT]);
    expect(result.steps.map((step) => step.name)).toEqual([
      `home: ${DEMO_CONNECTION_NAME} card visible`,
      "home: open the demo database",
      "workspace: open an ad-hoc query tab",
      "editor: type a destructive script",
      "run: initial Run requires confirmation",
      "run: cancel leaves the script unexecuted",
      "rerun: toolbar re-run requires confirmation again",
      "keyboard: the run shortcut cannot execute the pending confirmation",
      "keyboard: Escape cancels the pending confirmation",
    ]);
  });

  it("fails when a keyboard shortcut consumes the pending confirmation", async () => {
    const driver = fakeDriver({ shortcutConsumesDialog: true });
    await expect(runDestructiveRerunFlow(driver, options())).rejects.toThrow(
      /keyboard shortcut .*(executed|relocated|consumed)/i,
    );
  });

  it("fails when Escape does not cancel the pending confirmation", async () => {
    const driver = fakeDriver({ ignoresEscape: true });
    await expect(runDestructiveRerunFlow(driver, options())).rejects.toThrow(
      /Escape .*pending confirmation/i,
    );
  });

  it("fails with a specific message when the initial run never prompts", async () => {
    const driver = fakeDriver({ dialogNeverOpensFor: "run" });
    await expect(runDestructiveRerunFlow(driver, options())).rejects.toThrow(
      /initial Run executed a destructive script without confirmation/,
    );
  });

  it("fails with a specific message when the toolbar re-run never prompts", async () => {
    const driver = fakeDriver({ dialogNeverOpensFor: "rerun" });
    await expect(runDestructiveRerunFlow(driver, options())).rejects.toThrow(
      /toolbar re-run executed a destructive script without confirmation/,
    );
  });

  it("attaches the completed steps to a failure so the report shows how far it got", async () => {
    const driver = fakeDriver({ dialogNeverOpensFor: "rerun" });
    await expect(runDestructiveRerunFlow(driver, options())).rejects.toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          name: "run: cancel leaves the script unexecuted",
        }),
      ]),
    });
  });

  it("reports a missing editor instead of typing into nothing", async () => {
    const driver = fakeDriver();
    driver.sendKeys = vi.fn(async () => {
      throw new HarnessError("no editor");
    });
    driver.findElement = (async (selector: string) => {
      if (selector === EDITOR) return null;
      if (selector === CARD) return { elementId: "card" };
      if (selector === NEW_QUERY) return { elementId: "new-query" };
      return null;
    }) as typeof driver.findElement;

    await expect(runDestructiveRerunFlow(driver, options())).rejects.toThrow(
      /query editor/,
    );
  });
});
