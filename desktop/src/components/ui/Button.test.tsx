import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Save</Button>);
    expect(screen.getByText("Save")).toBeInTheDocument();
  });
  it("fires onClick", async () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Click</Button>);
    await userEvent.click(screen.getByText("Click"));
    expect(fn).toHaveBeenCalledOnce();
  });
  it("does not fire onClick when disabled", async () => {
    const fn = vi.fn();
    render(<Button onClick={fn} disabled>Click</Button>);
    await userEvent.click(screen.getByText("Click"));
    expect(fn).not.toHaveBeenCalled();
  });
});