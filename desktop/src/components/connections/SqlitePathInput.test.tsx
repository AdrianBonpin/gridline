import { describe, it, expect, vi } from "vitest";
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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

describe("SqlitePathInput", () => {
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
});