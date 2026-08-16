import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("renders checked state", () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="Enable" />);
    expect(screen.getByRole("switch", { name: "Enable" })).toHaveAttribute("aria-checked", "true");
  });

  it("renders unchecked state", () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Enable" />);
    expect(screen.getByRole("switch", { name: "Enable" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange when clicked", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable" />);
    await userEvent.click(screen.getByRole("switch", { name: "Enable" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});