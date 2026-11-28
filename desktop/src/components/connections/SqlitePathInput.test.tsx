import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SqlitePathInput } from "./SqlitePathInput";
import { FILE_GRANT_CODES, FILE_GRANT_STATE } from "../../lib/fileGrant";
import type { FileGrant, FileGrantErrorKind } from "../../lib/fileGrant";

function StatefulInput(props: Omit<React.ComponentProps<typeof SqlitePathInput>, "onChange"> & {
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(props.value ?? "");
  return (
    <SqlitePathInput
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

const open = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const selectFileForGrant = vi.hoisted(() => vi.fn());
const createSqliteDatabase = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
  save: (...args: unknown[]) => save(...args),
}));

vi.mock("../../lib/commands", () => ({
  selectFileForGrant: (...args: unknown[]) => selectFileForGrant(...args),
  createSqliteDatabase: (...args: unknown[]) => createSqliteDatabase(...args),
}));

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: (selector: (s: { notify: typeof notify }) => unknown) =>
    selector({ notify }),
}));

/** What the backend hands back for a write selection: an id, plus display-only path. */
function grant(id: string, path: string): FileGrant {
  return {
    id,
    path,
    displayName: path.split("/").pop() ?? path,
    intent: "write",
    expiresInSeconds: 300,
  };
}

function grantRejection(kind: FileGrantErrorKind, message: string): Error {
  return new Error(`${FILE_GRANT_CODES[kind]}: ${message}`);
}

describe("SqlitePathInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits typed path changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulInput value="" onChange={onChange} />);
    const input = screen.getByLabelText(/file path/i);
    await user.type(input, "/Users/me/data.db");
    expect(onChange).toHaveBeenLastCalledWith("/Users/me/data.db");
    expect(input).toHaveValue("/Users/me/data.db");
  });

  it("opens the file dialog on Browse and emits the chosen path", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue("/chosen/path.db");
    const onChange = vi.fn();
    render(<SqlitePathInput value="" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /browse/i }));
    expect(open).toHaveBeenCalledWith({ multiple: false, directory: false });
    expect(onChange).toHaveBeenCalledWith("/chosen/path.db");
  });

  it("does not emit when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<SqlitePathInput value="/existing.db" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /browse/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks the backend for a write grant instead of opening a save dialog itself", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockResolvedValue(grant("grant-new", "/chosen/new.db"));
    createSqliteDatabase.mockResolvedValue("/chosen/new.db");
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen/mytyped.db" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalledTimes(1));
    const request = selectFileForGrant.mock.calls[0][0] as Record<string, unknown>;
    expect(request.intent).toBe("write");
    // The request carries no destination: the webview only names the operation.
    expect(request).not.toHaveProperty("path");
    expect(request).not.toHaveProperty("defaultPath");
    expect(request.defaultName).toBe("mytyped.db");
    // The renderer never opens its own save dialog for this flow.
    expect(save).not.toHaveBeenCalled();
  });

  it("creates the database with the grant identifier and shows the created destination", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockResolvedValue(grant("grant-new", "/chosen/new.db"));
    createSqliteDatabase.mockResolvedValue("/chosen/new.db");
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/chosen/new.db"));
    // The identifier authorizes; the path is not an argument anywhere.
    expect(createSqliteDatabase).toHaveBeenCalledWith("grant-new");
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/created sqlite database at \/chosen\/new\.db/i),
      "success",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates nothing and reports nothing when the selection is cancelled", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalledTimes(1));
    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["expired", "consumed", "wrong-intent", "invalid"] as FileGrantErrorKind[])(
    "shows the %s selection state with a recovery action that picks the file again",
    async (kind) => {
      const user = userEvent.setup();
      selectFileForGrant.mockResolvedValue(grant("grant-stale", "/chosen/stale.db"));
      createSqliteDatabase.mockRejectedValueOnce(
        grantRejection(kind, "the selection is no longer usable."),
      );
      const onChange = vi.fn();
      render(<SqlitePathInput value="/chosen" onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: /create database/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(FILE_GRANT_STATE[kind].title);
      expect(onChange).not.toHaveBeenCalled();

      // The recovery action asks for a fresh selection and completes the job.
      selectFileForGrant.mockClear();
      selectFileForGrant.mockResolvedValue(grant("grant-fresh", "/chosen/fresh.db"));
      createSqliteDatabase.mockResolvedValue("/chosen/fresh.db");
      await user.click(screen.getByRole("button", { name: /choose file again/i }));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith("/chosen/fresh.db"));
      expect(selectFileForGrant).toHaveBeenCalledTimes(1);
      expect(createSqliteDatabase).toHaveBeenLastCalledWith("grant-fresh");
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("refuses to open a second save dialog while one is pending", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockResolvedValue(grant("grant-stale", "/chosen/stale.db"));
    createSqliteDatabase.mockRejectedValueOnce(
      grantRejection("expired", "the selection is no longer usable."),
    );
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));
    await screen.findByRole("alert");

    // The recovery action asks for a fresh selection that never settles, which is
    // exactly the window in which a second native dialog could be opened.
    let settleSelection: (value: unknown) => void = () => {};
    selectFileForGrant.mockClear();
    createSqliteDatabase.mockClear();
    selectFileForGrant.mockImplementation(
      () =>
        new Promise((resolveSelection) => {
          settleSelection = resolveSelection;
        }),
    );

    const retry = screen.getByRole("button", { name: /choose file again/i });
    await user.click(retry);
    await waitFor(() => expect(selectFileForGrant).toHaveBeenCalledTimes(1));
    expect(retry).toBeDisabled();

    // Clicking it again while the first dialog is pending opens nothing.
    await user.click(retry);
    expect(selectFileForGrant).toHaveBeenCalledTimes(1);

    // Cancelling the pending selection leaves nothing to report and re-enables it.
    settleSelection(null);
    await waitFor(() => expect(retry).not.toBeDisabled());
    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports an ordinary creation failure and keeps the path unchanged", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockResolvedValue(grant("grant-existing", "/chosen/keep.db"));
    createSqliteDatabase.mockRejectedValue(
      new Error("a file already exists at /chosen/keep.db; refusing to overwrite it"),
    );
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringMatching(/already exists/i),
        "error",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    // Not a grant rejection, so no grant recovery panel is shown.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a dialog failure without creating anything", async () => {
    const user = userEvent.setup();
    selectFileForGrant.mockRejectedValue(new Error("the file dialog could not be shown"));
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringMatching(/file dialog could not be shown/i),
        "error",
      ),
    );
    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
