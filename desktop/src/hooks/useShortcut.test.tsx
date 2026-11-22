import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { useShortcut } from "./useShortcut";
import { useSettingsStore } from "../stores/settingsStore";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

/**
 * Configurable shortcuts (ticket 39).
 *
 * A window-level shortcut is only safe when the user is not typing and no modal
 * owns the keyboard, and it must fire exactly once per key press no matter how
 * often the owning component re-renders. A duplicated listener would run the
 * action twice — closing two tabs, or committing twice.
 */

function Probe({
  action,
  onFire,
  tick = 0,
}: {
  action: string;
  onFire: () => void;
  tick?: number;
}) {
  // The callback is an inline closure, exactly like the real call sites, so it
  // changes identity on every render.
  useShortcut(action, () => onFire());
  return <span data-testid="probe">{tick}</span>;
}

function textField(tag: "input" | "textarea" | "select" = "input"): HTMLElement {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  useSettingsStore.setState({ settings: null, loading: false, error: null });
  document.body.innerHTML = "";
});

describe("useShortcut", () => {
  it("fires exactly once per key press across re-renders (no duplicate listeners)", () => {
    const onFire = vi.fn();
    const { rerender } = render(<Probe action="close_tab" onFire={onFire} />);

    // Re-rendering with a fresh inline callback identity must not add a second
    // listener for the same combo.
    for (let tick = 1; tick <= 5; tick += 1) {
      rerender(<Probe action="close_tab" onFire={onFire} tick={tick} />);
    }

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire while a text field is being edited", () => {
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);

    fireEvent.keyDown(textField("input"), { key: "k", metaKey: true });
    fireEvent.keyDown(textField("textarea"), { key: "k", metaKey: true });
    fireEvent.keyDown(textField("select"), { key: "k", metaKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });

  it("does not fire while a content-editable element has focus", () => {
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.appendChild(editable);

    fireEvent.keyDown(editable, { key: "k", metaKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });

  it("still fires from a non-text control such as a checkbox", () => {
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.appendChild(checkbox);

    fireEvent.keyDown(checkbox, { key: "k", metaKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire while a modal is open, and fires again once it closes", async () => {
    const onFire = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <>
        <Probe action="command_palette" onFire={onFire} />
        <ConfirmDialog
          open
          title="Delete?"
          message="Are you sure?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onFire).not.toHaveBeenCalled();

    rerender(
      <>
        <Probe action="command_palette" onFire={onFire} />
        <ConfirmDialog
          open={false}
          title="Delete?"
          message="Are you sure?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>,
    );
    await waitFor(() => expect(document.querySelector("[role='dialog']")).toBeNull());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire under a modal that only declares itself in markup", () => {
    // Belt and braces: a dialog that forgets to register modal presence still
    // marks itself `aria-modal`, and that alone must suppress shortcuts.
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });

  it("uses the combo configured in settings", () => {
    useSettingsStore.setState({
      settings: {
        shortcuts: { command_palette: "Meta+Shift+p" },
      } as any,
      loading: false,
      error: null,
    });
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);

    // The default (Meta+K) is no longer bound…
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onFire).not.toHaveBeenCalled();

    // …the configured combo is.
    fireEvent.keyDown(window, { key: "p", metaKey: true, shiftKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the configured combo is cleared", () => {
    useSettingsStore.setState({
      settings: { shortcuts: { command_palette: "" } } as any,
      loading: false,
      error: null,
    });
    const onFire = vi.fn();
    render(<Probe action="command_palette" onFire={onFire} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(onFire).not.toHaveBeenCalled();
  });
});
