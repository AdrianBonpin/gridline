import { describe, expect, it, vi } from "vitest";
import { HarnessError } from "./errors.mjs";
import {
  DEMO_CONNECTION_NAME,
  READ_ONLY_SCRIPT,
  connectionCardSelector,
  destructiveDialogCancelSelector,
  destructiveDialogConfirmSelector,
  destructiveDialogEscapeKey,
  destructiveDialogRunShortcut,
  destructiveDialogSelector,
  newQueryTabSelector,
  queryEditorInputSelector,
  queryEditorSurfaceSelector,
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
const EDITOR_SURFACE = queryEditorSurfaceSelector();
const RUN = runQuerySelector();
const RERUN = rerunQuerySelector();
const DIALOG = destructiveDialogSelector();
const CANCEL = destructiveDialogCancelSelector();
const CONFIRM = destructiveDialogConfirmSelector();
const ESCAPE = destructiveDialogEscapeKey();
const RUN_SHORTCUT = destructiveDialogRunShortcut();

/** The statement the built app asks about: anything data-modifying. */
const DESTRUCTIVE = /\b(DELETE|UPDATE|INSERT|DROP|ALTER|TRUNCATE|CREATE|REPLACE)\b/i;

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
 * Stand-in for the real webview.
 *
 * It models the three facts the flow depends on, all of them measured on the
 * built app rather than assumed:
 *
 * - the confirmation dialog materializes only after a Run/Re-run click on a
 *   script the guard considers destructive, and only while it has not been
 *   cancelled (`DestructiveQueryDialog` returns `null` while closed);
 * - the toolbar's re-run control only exists once the tab holds a result set
 *   (`DbViewerScreen` renders `TableControls` behind `activeTab?.data`), so a
 *   read has to run before the re-run assertion is reachable;
 * - clicking Monaco's hidden `textarea.inputarea` is *intercepted* by
 *   `div.view-line` (1x1 target at `z-index:-10`), so this fake fails the same
 *   way the real driver does if the flow ever clicks it again.
 */
function fakeDriver(
  options: {
    dialogNeverOpensFor?: "run" | "rerun";
    /** Simulates a bug where a shortcut silently confirms the request. */
    shortcutConsumesDialog?: boolean;
    /** Simulates a dialog that ignores Escape. */
    ignoresEscape?: boolean;
    /** Simulates a viewer that never mounts the result toolbar. */
    toolbarNeverMounts?: boolean;
  } = {},
) {
  const clicks: string[] = [];
  const typed: string[] = [];
  const dialogKeys: string[] = [];
  const {
    dialogNeverOpensFor = null,
    shortcutConsumesDialog = false,
    ignoresEscape = false,
    toolbarNeverMounts = false,
  } = options;
  const state = {
    editorReady: false,
    dialogOpen: false,
    /** The script the editor currently holds (the flow types in two parts). */
    script: "",
    /** A run has returned a result set, so the toolbar is mounted. */
    hasData: false,
  };
  const destructive = () => DESTRUCTIVE.test(state.script);

  return {
    async findElement(selector: string) {
      const found = (elementId: string) => ({ elementId });
      switch (selector) {
        case CARD:
          return found("card");
        case NEW_QUERY:
          return found("new-query");
        case EDITOR:
          return state.editorReady ? found("editor") : null;
        case EDITOR_SURFACE:
          return state.editorReady ? found("editor-surface") : null;
        case RUN:
          return found("run");
        case RERUN:
          return state.hasData && !toolbarNeverMounts ? found("rerun") : null;
        case DIALOG:
          return state.dialogOpen ? found("dialog") : null;
        case CANCEL:
          return state.dialogOpen ? found("dialog-cancel") : null;
        case CONFIRM:
          return state.dialogOpen ? found("confirm") : null;
        default:
          return null;
      }
    },
    async sendKeys(element: { elementId: string }, text: string) {
      if (element.elementId === "dialog") {
        // Keys sent to the modal go to the modal: Escape cancels it, and the
        // editor's run shortcut reaches the editor not at all.
        dialogKeys.push(text);
        if (text === ESCAPE && !ignoresEscape) state.dialogOpen = false;
        if (text === RUN_SHORTCUT && shortcutConsumesDialog) state.dialogOpen = false;
        return;
      }
      typed.push(text);
      state.script += text;
      state.editorReady = true;
    },
    async click(element: { elementId: string }) {
      clicks.push(element.elementId);
      if (element.elementId === "editor") {
        // What WebKitWebDriver answers for Monaco's hidden input area.
        throw new HarnessError(
          "element click intercepted: div.view-line (POST /session/…/element/editor/click)",
        );
      }
      if (element.elementId === "new-query") {
        // The editor mounts once the query tab opens.
        await Promise.resolve();
        state.editorReady = true;
      }
      if (element.elementId === "run") {
        if (destructive()) {
          if (dialogNeverOpensFor !== "run") state.dialogOpen = true;
        } else {
          // A read returns rows: the tab now has a result set.
          state.hasData = true;
        }
      }
      if (element.elementId === "rerun" && dialogNeverOpensFor !== "rerun") {
        state.dialogOpen = true;
      }
      if (element.elementId === "dialog-cancel") {
        state.dialogOpen = false;
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
    state,
    get dialogOpen() {
      return state.dialogOpen;
    },
    closeDialog() {
      state.dialogOpen = false;
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

    // The read is typed and run first, then the destructive statement is added,
    // so both entry points are exercised on a tab that has a result set.
    expect(driver.typed).toEqual([READ_ONLY_SCRIPT, ` ${DESTRUCTIVE_SCRIPT}`]);
    expect(driver.clicks).toEqual([
      "card",
      "new-query",
      "editor-surface",
      "run",
      "editor-surface",
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
    expect(result.steps.map((step) => step.name)).toEqual([
      `home: ${DEMO_CONNECTION_NAME} card visible`,
      "home: open the demo database",
      "workspace: open an ad-hoc query tab",
      "reader: type a harmless read",
      "run: the read executes without a confirmation",
      "editor: type a destructive script",
      "run: initial Run requires confirmation",
      "run: cancel leaves the script unexecuted",
      "rerun: toolbar re-run requires confirmation again",
      "keyboard: the run shortcut cannot execute the pending confirmation",
      "keyboard: Escape cancels the pending confirmation",
    ]);
  });

  it("never clicks Monaco's hidden input area", async () => {
    // The fake rejects a click on `textarea.inputarea` exactly as
    // WebKitWebDriver does, so a reintroduced click fails here instead of only
    // in the built-product lane.
    const driver = fakeDriver();
    const result = await runDestructiveRerunFlow(driver, options());
    expect(result.confirmedEntryPoints).toEqual(["initial Run", "toolbar re-run"]);
    expect(driver.clicks).not.toContain("editor");
    expect(driver.clicks.filter((id) => id === "editor-surface")).toHaveLength(2);
  });

  it("runs a read first, so the re-run control it asserts on actually mounts", async () => {
    // Without a result set the toolbar is not rendered at all; the flow has to
    // create that state instead of asserting on a control that cannot exist.
    const driver = fakeDriver({ toolbarNeverMounts: true });
    await expect(runDestructiveRerunFlow(driver, { ...options(), timeoutMs: 300 })).rejects.toThrow(
      /Re-run query.*never rendered|result toolbar/,
    );
    // It fails at the read step, before claiming anything about re-running.
    expect(driver.state.hasData).toBe(true);
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
