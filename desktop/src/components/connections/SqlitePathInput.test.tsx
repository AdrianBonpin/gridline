import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SqlitePathInput } from "./SqlitePathInput";

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
const createSqliteDatabase = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
  save: (...args: unknown[]) => save(...args),
}));

vi.mock("../../lib/commands", () => ({
  createSqliteDatabase: (...args: unknown[]) => createSqliteDatabase(...args),
}));

vi.mock("../../stores/notificationStore", () => ({
  useNotificationStore: (selector: (s: { notify: typeof notify }) => unknown) =>
    selector({ notify }),
}));

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

  it("creates a database only through the explicit Create database action", async () => {
    const user = userEvent.setup();
    save.mockResolvedValue("/chosen/new.db");
    createSqliteDatabase.mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/chosen" }),
    );
    expect(createSqliteDatabase).toHaveBeenCalledWith("/chosen/new.db");
    expect(onChange).toHaveBeenCalledWith("/chosen/new.db");
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/created/i),
      "success",
    );
  });

  it("reports a creation failure and keeps the path unchanged", async () => {
    const user = userEvent.setup();
    save.mockResolvedValue("/chosen/new.db");
    createSqliteDatabase.mockRejectedValue(new Error("permission denied"));
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/permission denied/),
      "error",
    );
  });

  it("does not create anything when the create dialog is cancelled", async () => {
    const user = userEvent.setup();
    save.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<SqlitePathInput value="/chosen" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /create database/i }));

    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});