import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DestructiveQueryDialog } from "./DestructiveQueryDialog";

afterEach(() => cleanup());

describe("DestructiveQueryDialog", () => {
  it("renders warning message with the SQL shown", () => {
    render(
      <DestructiveQueryDialog open={true} query="DROP TABLE users" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText(/destructive/i)).toBeInTheDocument();
    expect(screen.getByText(/DROP TABLE users/)).toBeInTheDocument();
  });

  it("exposes stable anchors for the built-product E2E flow", () => {
    // `e2e/destructiveFlow.mjs` finds the dialog and its buttons by these; the
    // flow asserts the confirmation appears for every Execution Entry Point.
    render(
      <DestructiveQueryDialog open={true} query="DELETE FROM products" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByTestId("destructive-query-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("destructive-query-confirm")).toHaveTextContent("Execute");
    expect(screen.getByTestId("destructive-query-cancel")).toHaveTextContent("Cancel");
  });

  it("calls onConfirm when 'Execute' is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <DestructiveQueryDialog open={true} query="DELETE FROM users" onConfirm={onConfirm} onCancel={() => {}} />
    );
    fireEvent.click(screen.getByText("Execute"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    const onCancel = vi.fn();
    render(
      <DestructiveQueryDialog open={true} query="DROP TABLE users" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("truncates long queries in the dialog", () => {
    const longQuery = "DROP TABLE " + "x".repeat(500);
    render(
      <DestructiveQueryDialog open={true} query={longQuery} onConfirm={() => {}} onCancel={() => {}} />
    );
    const displayed = screen.getByText(/DROP TABLE/);
    expect(displayed.textContent!.length).toBeLessThan(longQuery.length + 20);
  });

  it("names the offending statement in a multi-statement script", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="SELECT 1; DROP TABLE demo;"
        statementIndex={2}
        statementCount={2}
        reason="schema"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const detail = screen.getByTestId("destructive-statement-detail");
    expect(detail).toHaveTextContent("Statement 2 of 2");
    expect(detail).toHaveTextContent(/schema-modifying/i);
  });

  it("explains an unverifiable statement", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="CALL refresh_all();"
        statementIndex={1}
        statementCount={1}
        reason="unknown"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const detail = screen.getByTestId("destructive-statement-detail");
    expect(detail).toHaveTextContent(/could not be verified as read-only/i);
    // A single-statement script has no "statement N of M" prefix.
    expect(detail).not.toHaveTextContent(/Statement 1 of 1/);
  });

  it("names the offending statement itself, not just its position", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="SELECT 1; DROP TABLE demo; SELECT 2;"
        statement="DROP TABLE demo"
        statementIndex={2}
        statementCount={3}
        reason="schema"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const offending = screen.getByTestId("destructive-offending-statement");
    expect(offending).toHaveTextContent("DROP TABLE demo");
    expect(offending).toHaveTextContent("Statement 2 of 3");
  });

  it("renders no detail row when no analysis is supplied (backwards compatible)", () => {
    render(
      <DestructiveQueryDialog
        open={true}
        query="DROP TABLE users"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("destructive-statement-detail")).toBeNull();
  });
});
/**
 * Ticket 17: the confirmation is a real modal, not a floating panel over a live
 * editor. A keyboard user must not be able to type into the editor behind it,
 * Tab must not escape it, and Escape must cancel the request.
 */
describe("DestructiveQueryDialog modal behavior", () => {
  function renderDialog(overrides: Partial<Parameters<typeof DestructiveQueryDialog>[0]> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <DestructiveQueryDialog
        open={true}
        query="DELETE FROM users"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...overrides}
      />,
    );
    return { ...view, onConfirm, onCancel };
  }

  it("is an aria-modal dialog and moves focus into it when it opens", () => {
    renderDialog();
    const dialog = screen.getByTestId("destructive-query-dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Focus starts on the safe action, so a stray Enter/Ctrl+Enter cannot
    // confirm an unreviewed destructive request.
    expect(document.activeElement).toBe(
      screen.getByTestId("destructive-query-cancel"),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    renderDialog();
    const dialog = screen.getByTestId("destructive-query-dialog");
    const cancel = screen.getByTestId("destructive-query-cancel");
    const confirm = screen.getByTestId("destructive-query-confirm");

    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("cancels on Escape without reaching the page behind", () => {
    const pageHandler = vi.fn();
    document.addEventListener("keydown", pageHandler);
    try {
      const { onCancel, onConfirm } = renderDialog();
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      // The modal consumes the key: a window-level shortcut behind it (Run,
      // Close Tab, …) never observes it.
      expect(pageHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageHandler);
    }
  });

  it("keeps typed keys inside the dialog so the editor behind receives nothing", () => {
    const editorKeyDown = vi.fn();
    const editor = document.createElement("textarea");
    editor.setAttribute("data-testid", "editor-behind");
    editor.addEventListener("keydown", editorKeyDown);
    document.body.appendChild(editor);
    editor.focus();
    expect(document.activeElement).toBe(editor);
    try {
      renderDialog();
      // Opening the modal took focus away from the editor…
      expect(document.activeElement).not.toBe(editor);
      // …so a keypress while it is open is delivered to the dialog, and the
      // editor's own handler never runs.
      fireEvent.keyDown(document.activeElement!, { key: "Backspace" });
      expect(editorKeyDown).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(editor);
      fireEvent.keyDown(document.activeElement!, { key: "x" });
      expect(editorKeyDown).not.toHaveBeenCalled();
    } finally {
      editor.remove();
    }
  });

  it("returns focus to whatever was focused before the dialog opened", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    try {
      const { rerender } = render(
        <DestructiveQueryDialog
          open={true}
          query="DELETE FROM users"
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(document.activeElement).not.toBe(trigger);
      rerender(
        <DestructiveQueryDialog
          open={false}
          query="DELETE FROM users"
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  });
});
